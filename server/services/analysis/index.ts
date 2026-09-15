import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { reports } from '@server/db/schema';
import { env, providers } from '@server/env';
import { AppError, marketSchema, nicheQuerySchema, providerUnavailable } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { generateJson } from '@server/services/ai/gemini';
import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_RESPONSE_SCHEMA,
  FRAMEWORK_PHASES,
  LEVELS,
  VERDICTS,
  buildAnalysisPrompt,
  parseAnalysisResponse,
  type AnalysisResponse,
} from '@server/services/analysis/prompt';
import { searchWeb, type WebSource } from '@server/services/analysis/webSearch';
import { currencyForCountry, getRates } from '@server/services/currency';
import { runBilledGeneration } from '@server/services/generations';
import { getActiveAdapter, type IngestionResult } from '@server/services/ingestion';
import { computeCompetitiveScore, type ScoreResult } from '@server/services/scoring';
import type {
  CompetitorInsight,
  DigitalProductIdea,
  MarketAnalysisReport,
  MarketRate,
  MetaAdCampaign,
  OverallVerdict,
  ReportSummary,
  TauxLevel,
} from '@server/shared/analysis';
import { countryName } from '@server/shared/countries';

/**
 * Analyse de niche (module 2) : recherche web, collecte publicitaire, rédaction
 * par Gemini, puis contrôle par le serveur de tout ce qui se présente comme un fait.
 *
 * Le modèle reçoit la consigne de citer ses sources ; le serveur ne s'en contente
 * pas. Un concurrent sans source existante est écarté, un niveau de taux sans
 * source redevient « non évalué », et aucun prix, volume ou marge n'est gardé
 * s'il ne vient pas d'une mesure. Le rapport dit en clair ce qu'il n'a pas pu établir.
 */

const SERVICE = { name: 'service d’analyse', code: 'ANALYSIS', log: 'analyse' };
const TIMEOUT_MS = 240_000;
/** Rapports gardés par compte : les plus anciens au-delà sont effacés. */
export const REPORTS_KEPT = 50;

export const analysisRequestSchema = z.object({
  query: nicheQuerySchema,
  market: marketSchema.nullish(),
});

export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

const RATE_LABELS: Record<MarketRate['key'], string> = {
  demand: 'Taux de demande',
  saturation: 'Taux de saturation concurrentielle',
  profitability: 'Taux de rentabilité',
  opportunity: 'Taux d’opportunité',
  virality: 'Taux de viralité',
};

const TYPE_NAMES: Record<DigitalProductIdea['type'], string> = {
  ebook: 'Ebook',
  template: 'Template',
  masterclass: 'Masterclass',
  bundle: 'Pack',
  micro_tool: 'Mini-outil',
};

const FRAMEWORK_NAMES = {
  AIDA: 'Attention, Intérêt, Désir, Action',
  PAS: 'Problème, Agitation, Solution',
  BAB: 'Avant, Après, Pont',
} as const;

export interface AdMeasure {
  ingestion: IngestionResult;
  score: ScoreResult;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Mesure publicitaire décrite en une phrase, pour la consigne du modèle. */
export function describeMeasure(measure: AdMeasure): string {
  const { signals, sourceLabel, isDemonstration } = measure.ingestion;
  return (
    `${signals.uniqueAdvertisers} annonceurs distincts, ${signals.activeAds} publicités actives, ` +
    `durée de diffusion moyenne de ${Math.round(signals.averageLifetimeDays)} jours, ` +
    `${signals.establishedAds} publicités diffusées depuis plus de 14 jours ` +
    `(source : ${sourceLabel}${isDemonstration ? ', jeu de démonstration' : ''}).`
  );
}

/**
 * Assemble le rapport à partir de la réponse du modèle, en ne gardant comme fait
 * que ce que les sources ou la mesure établissent. Fonction pure.
 */
export function assembleReport(input: {
  id: string;
  query: string;
  market: string | null;
  now: Date;
  timeZone: string;
  sources: readonly WebSource[];
  webSearchConfigured: boolean;
  measure: AdMeasure | null;
  measureFailed: boolean;
  response: AnalysisResponse;
  model: string;
  currency: string;
}): MarketAnalysisReport {
  const { id, sources, measure, response } = input;
  const validIds = new Set(sources.map((source) => source.id));
  const cite = (ids: readonly number[]) => ids.filter((sourceId) => validIds.has(sourceId));
  const noSource =
    sources.length > 0
      ? 'aucune source consultée ne documente ce point'
      : input.webSearchConfigured
        ? 'la recherche web n’a trouvé aucune page sur cette niche'
        : 'aucune recherche web n’est branchée sur ce serveur';

  const assessed = (key: Exclude<MarketRate['key'], 'saturation'>): MarketRate => {
    const assessment = response[key];
    const sourceIds = cite(assessment.sourceIds);
    const level = (LEVELS as readonly string[]).includes(assessment.level) ? (assessment.level as TauxLevel) : null;
    if (level && sourceIds.length > 0 && assessment.rationale) {
      return { key, label: RATE_LABELS[key], level, score: null, trend: null, basis: 'assessment', sourceIds, description: assessment.rationale };
    }
    return { key, label: RATE_LABELS[key], level: null, score: null, trend: null, basis: 'unavailable', description: `Non évalué : ${noSource}.` };
  };

  const saturation: MarketRate = measure
    ? {
        key: 'saturation',
        label: RATE_LABELS.saturation,
        level: measure.score.level,
        score: measure.score.score,
        trend: null,
        basis: 'measured',
        description:
          `${measure.ingestion.signals.uniqueAdvertisers} annonceurs et ${measure.ingestion.signals.activeAds} publicités actives relevés` +
          (measure.ingestion.isDemonstration ? ' dans le jeu de démonstration.' : ` dans ${measure.ingestion.sourceLabel}.`),
        trace: { ...measure.score, source: measure.ingestion.isDemonstration ? 'demonstration' : 'live' },
      }
    : {
        key: 'saturation',
        label: RATE_LABELS.saturation,
        level: null,
        score: null,
        trend: null,
        basis: 'unavailable',
        description: input.measureFailed
          ? 'Non mesuré : la collecte publicitaire a échoué pendant l’analyse.'
          : 'Non mesuré : la bibliothèque publicitaire Meta n’est pas branchée sur ce serveur.',
      };

  const rates = {
    demand: assessed('demand'),
    saturation,
    profitability: assessed('profitability'),
    opportunity: assessed('opportunity'),
    virality: assessed('virality'),
  };

  const evaluatedRates = Object.values(rates).filter((rate) => rate.basis !== 'unavailable').length;
  const verdictAllowed = (VERDICTS as readonly string[]).includes(response.verdict) && sources.length > 0 && evaluatedRates >= 2;
  const overallVerdict = verdictAllowed ? (response.verdict as OverallVerdict) : null;
  const verdictRationale = overallVerdict
    ? response.verdictRationale
    : `Verdict non établi : ${sources.length === 0 ? noSource : 'trop peu de taux ont pu être évalués à partir des sources'}.`;

  const competitors: CompetitorInsight[] = response.competitors
    .flatMap((competitor) => {
      const sourceIds = cite(competitor.sourceIds);
      if (!competitor.name || sourceIds.length === 0) return [];
      const cited = sources.filter((source) => sourceIds.includes(source.id));
      const citedHosts = new Set(cited.map((source) => hostOf(source.url)));
      // Un lien absent des sources citées est remplacé par la première d'entre elles : aucun lien inventé.
      const given = competitor.urlOrHandle;
      const isHandle = given.startsWith('@') && !given.includes(' ');
      const givenHost = /^https?:\/\//i.test(given) ? hostOf(given) : null;
      const urlOrHandle = isHandle || (givenHost && citedHosts.has(givenHost)) ? given : cited[0]!.url;
      return [
        {
          name: competitor.name,
          urlOrHandle,
          priceRange: competitor.priceRange || 'Prix non indiqué dans les sources',
          positioning: competitor.positioning,
          strengths: competitor.strengths,
          weaknesses: competitor.weaknesses,
          exploitableGaps: competitor.exploitableGap ? [competitor.exploitableGap] : [],
          sourceIds,
        },
      ];
    })
    .slice(0, 4)
    .map((competitor, index) => ({ id: `${id}-c${index + 1}`, ...competitor }));

  const pricingFallback =
    sources.length > 0
      ? 'Aucun prix constaté dans les sources : fixez le vôtre dans le simulateur.'
      : 'Aucun prix constaté, faute de recherche web : fixez le vôtre dans le simulateur.';

  const digitalProducts: DigitalProductIdea[] = response.products
    .filter((product) => product.title)
    .slice(0, 3)
    .map((product, index) => ({
      id: `${id}-p${index + 1}`,
      title: product.title,
      subtitle: product.subtitle,
      type: product.type,
      typeName: TYPE_NAMES[product.type],
      recommendedPrice: null,
      currency: input.currency,
      estimatedProductionDays: null,
      estimatedMarginPercent: null,
      pricingNote: sources.length > 0 && product.pricingNote ? product.pricingNote : pricingFallback,
      targetAudience: product.targetAudience,
      transformationPromise: product.transformationPromise,
      tableOfContents: product.modules
        .filter((module) => module.title)
        .slice(0, 12)
        .map((module, moduleIndex) => ({ moduleNumber: moduleIndex + 1, title: module.title, details: module.details })),
      leadMagnet: product.leadMagnet,
      imageUrl: '',
    }));

  const nicheName = response.nicheName || input.query;

  const adCampaigns: MetaAdCampaign[] = response.adScripts
    .filter((script) => script.hookHeadline && script.scenes.length > 0)
    .slice(0, 2)
    .map((script, index) => {
      const duration = script.durationSeconds <= 20 ? 15 : 30;
      const phases: readonly string[] = FRAMEWORK_PHASES[script.framework];
      const scenes = script.scenes.slice(0, 8);
      // Minutage recalculé ici : il doit tomber juste sur la durée annoncée, quoi que propose le modèle.
      const weights = scenes.map((scene) => (Number.isFinite(scene.seconds) && scene.seconds > 0 ? scene.seconds : 1));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let elapsed = 0;
      return {
        id: `${id}-a${index + 1}`,
        framework: script.framework,
        frameworkFullName: FRAMEWORK_NAMES[script.framework],
        targetProductTitle: digitalProducts[0]?.title ?? nicheName,
        hookHeadline: script.hookHeadline,
        metaPrimaryText: script.primaryText,
        metaHeadline: script.headline,
        callToAction: script.callToAction,
        aspectRatio: script.aspectRatio,
        durationSeconds: duration,
        scenes: scenes.map((scene, sceneIndex) => {
          const start = Math.round(elapsed);
          elapsed += (weights[sceneIndex]! / total) * duration;
          const end = sceneIndex === scenes.length - 1 ? duration : Math.round(elapsed);
          const phase = phases.includes(scene.phase) ? scene.phase : phases[Math.min(sceneIndex, phases.length - 1)]!;
          return {
            sceneNumber: sceneIndex + 1,
            timing: `${clock(start)} - ${clock(end)}`,
            phase: phase as MetaAdCampaign['scenes'][number]['phase'],
            visualDescription: scene.visualDescription,
            onScreenText: scene.onScreenText,
            spokenVoiceover: scene.voiceover,
            soundAndVibe: scene.soundAndVibe,
          };
        }),
        complianceCheck: [],
        metaTargeting: { interests: script.interests, demographics: script.demographics, placements: script.placements },
      };
    });

  const seenKeywords = new Set<string>();
  const searchTrends = response.keywords
    .filter((keyword) => {
      const key = keyword.keyword.toLowerCase();
      if (!key || seenKeywords.has(key)) return false;
      seenKeywords.add(key);
      return true;
    })
    .slice(0, 8)
    .map((keyword) => ({ keyword: keyword.keyword, intent: keyword.intent, volume: null, growthRate: null, growthType: null }));

  const limitations = [
    ...(sources.length === 0
      ? [
          input.webSearchConfigured
            ? 'La recherche web n’a trouvé aucune page sur cette niche : concurrents, prix et demande n’ont pas pu être étudiés.'
            : 'Aucune recherche web n’est branchée : concurrents, prix et demande n’ont pas été étudiés.',
        ]
      : []),
    ...(measure
      ? measure.ingestion.isDemonstration
        ? ['La saturation est calculée sur un jeu de publicités de démonstration, pas sur le marché réel.']
        : []
      : [
          input.measureFailed
            ? 'La collecte publicitaire a échoué : la saturation concurrentielle n’a pas été mesurée.'
            : 'La bibliothèque publicitaire Meta n’est pas branchée : la saturation concurrentielle n’a pas été mesurée.',
        ]),
    'Aucune source de volumes de recherche n’est branchée : les mots-clés sont des pistes, sans volume ni croissance.',
    'Idées de produits, scripts et plan d’action sont des propositions de l’IA, à relire avant usage.',
    ...response.limitations,
  ];

  const collectedAt = input.now.toISOString();

  return {
    id,
    query: input.query,
    nicheName,
    market: input.market,
    dateCreated: input.now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: input.timeZone }),
    executiveSummary: response.executiveSummary,
    summarySourceIds: cite(response.summarySourceIds),
    overallVerdict,
    verdictRationale,
    rates,
    searchTrends,
    competitors,
    digitalProducts,
    adCampaigns,
    illustrativeImages: [],
    strategicActionPlan: response.actionPlan
      .filter((phase) => phase.title && phase.steps.length > 0)
      .slice(0, 4)
      .map((phase) => ({ phase: phase.phase, title: phase.title, steps: phase.steps })),
    groundingSources: sources.map((source) => ({ id: source.id, title: source.title, url: source.url, publishedAt: source.publishedAt })),
    dataProvenance: {
      ...(sources.length > 0
        ? {
            rates: {
              source: 'Recherche web (Brave Search), synthèse Gemini',
              collectedAt,
              sampleSize: sources.length,
              sampleUnit: 'pages web consultées',
              isDemonstration: false,
            },
          }
        : measure
          ? {
              rates: {
                source: measure.ingestion.sourceLabel,
                collectedAt: measure.ingestion.collectedAt,
                sampleSize: measure.ingestion.ads.length,
                sampleUnit: 'publicités',
                isDemonstration: measure.ingestion.isDemonstration,
                ...(measure.ingestion.sourceUrl ? { sourceUrl: measure.ingestion.sourceUrl } : {}),
              },
            }
          : {}),
      ...(adCampaigns.length > 0
        ? { adCampaigns: { source: `Scripts proposés par Gemini (${input.model})`, collectedAt, isDemonstration: false } }
        : {}),
    },
    limitations: [...new Set(limitations)].slice(0, 8),
    generator: {
      provider: 'Gemini',
      model: input.model,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      webSearch: sources.length > 0 ? 'Brave Search' : null,
      generatedAt: collectedAt,
    },
  };
}

/** Collecte publicitaire quand une source est branchée ; son échec n'arrête pas l'analyse, il est dit. */
async function measureAds(niche: string, market: string | null): Promise<{ measure: AdMeasure | null; measureFailed: boolean }> {
  const adapter = getActiveAdapter();
  if (!adapter.isAvailable().available) return { measure: null, measureFailed: false };
  try {
    const ingestion = await adapter.fetchAds({ niche, ...(market ? { market } : {}), limit: 500 });
    return { measure: { ingestion, score: computeCompetitiveScore(ingestion.signals, new Date(ingestion.collectedAt)) }, measureFailed: false };
  } catch (error) {
    console.error('[analyse] collecte publicitaire impossible :', error instanceof Error ? error.message : error);
    return { measure: null, measureFailed: true };
  }
}

async function produceReport(auth: RequestAuth, request: AnalysisRequest): Promise<MarketAnalysisReport> {
  const now = new Date();
  const market = request.market ?? null;
  const marketName = market ? countryName(market) : null;

  const sources = providers.webSearch ? await searchWeb({ query: request.query, marketName }) : [];
  const { measure, measureFailed } = await measureAds(request.query, market);

  const response = await generateJson({
    service: SERVICE,
    prompt: buildAnalysisPrompt({
      query: request.query,
      marketName,
      today: now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: env.REPORTING_TIMEZONE }),
      sources,
      webSearchConfigured: providers.webSearch,
      adMeasure: measure ? describeMeasure(measure) : null,
    }),
    responseSchema: ANALYSIS_RESPONSE_SCHEMA,
    parse: parseAnalysisResponse,
    timeoutMs: TIMEOUT_MS,
  });

  const report = assembleReport({
    id: randomUUID(),
    query: request.query,
    market,
    now,
    timeZone: env.REPORTING_TIMEZONE,
    sources,
    webSearchConfigured: providers.webSearch,
    measure,
    measureFailed,
    response,
    model: env.GEMINI_MODEL,
    currency: currencyForCountry(market ?? auth.account.user.country, await getRates()),
  });

  const userId = auth.account.user.id;
  const db = getDb();
  await db.insert(reports).values({
    id: report.id,
    userId,
    query: report.query,
    nicheName: report.nicheName,
    market,
    report: report as unknown as Record<string, unknown>,
    createdAt: now,
  });

  const overflow = await db
    .select({ id: reports.id })
    .from(reports)
    .where(eq(reports.userId, userId))
    .orderBy(desc(reports.createdAt))
    .offset(REPORTS_KEPT);
  if (overflow.length > 0) {
    await db.delete(reports).where(and(eq(reports.userId, userId), inArray(reports.id, overflow.map((row) => row.id))));
  }

  return report;
}

/** Analyse facturée : points réservés au lancement, rendus si une étape échoue. */
export async function analyzeNiche(auth: RequestAuth, request: AnalysisRequest): Promise<MarketAnalysisReport> {
  if (!providers.gemini) throw providerUnavailable('Gemini');
  const { result } = await runBilledGeneration({
    auth,
    actionId: 'niche_analysis',
    kind: 'niche_analysis',
    provider: 'gemini',
    run: () => produceReport(auth, request),
    describe: () => ({ providerRef: null, state: 'completed' }),
  });
  return result;
}

const reportIdSchema = z.string().uuid();
const reportNotFound = () => new AppError(404, 'Rapport introuvable sur votre compte.', 'REPORT_NOT_FOUND');

export async function listReports(auth: RequestAuth): Promise<ReportSummary[]> {
  const rows = await getDb()
    .select({ id: reports.id, query: reports.query, nicheName: reports.nicheName, market: reports.market, createdAt: reports.createdAt })
    .from(reports)
    .where(eq(reports.userId, auth.account.user.id))
    .orderBy(desc(reports.createdAt))
    .limit(REPORTS_KEPT);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function getReport(auth: RequestAuth, reportId: string | undefined): Promise<MarketAnalysisReport> {
  const parsed = reportIdSchema.safeParse(reportId);
  if (!parsed.success) throw reportNotFound();
  const [row] = await getDb()
    .select({ report: reports.report })
    .from(reports)
    .where(and(eq(reports.id, parsed.data), eq(reports.userId, auth.account.user.id)))
    .limit(1);
  if (!row) throw reportNotFound();
  return row.report as unknown as MarketAnalysisReport;
}

export async function deleteReport(auth: RequestAuth, reportId: string | undefined): Promise<void> {
  const parsed = reportIdSchema.safeParse(reportId);
  if (!parsed.success) throw reportNotFound();
  const deleted = await getDb()
    .delete(reports)
    .where(and(eq(reports.id, parsed.data), eq(reports.userId, auth.account.user.id)))
    .returning({ id: reports.id });
  if (deleted.length === 0) throw reportNotFound();
}
