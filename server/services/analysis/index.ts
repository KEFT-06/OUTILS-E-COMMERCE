import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { reports } from '@server/db/schema';
import { env } from '@server/env';
import { AppError, marketSchema, nicheQuerySchema } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { generateJsonWithPerplexity } from '@server/services/ai/perplexity';
import { sharpenProductTitles } from '@server/services/analysis/productAngles';
import {
  ANALYSIS_PROMPT_VERSION,
  FRAMEWORK_PHASES,
  LEVELS,
  VERDICTS,
  analysisResponseSchemaFor,
  buildAnalysisPrompt,
  parseAnalysisResponse,
  type AnalysisResponse,
} from '@server/services/analysis/prompt';
import type { ResearchEngine, ResearchOutcome } from '@server/services/analysis/research';
import { nicheSignalsSource } from '@server/services/analysis/signals';
import type { WebSource } from '@server/services/analysis/webSearch';
import { conversionHints, currencyForCountry, getRates } from '@server/services/currency';
import type { DataProvenance } from '@server/shared/provenance';
import type {
  AnalysisSubject,
  AuthorWorkReview,
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
import { deriveVerdict } from '@server/shared/verdict';

/**
 * Analyse de niche (module 2) : étude de marché ET rédaction de la fiche par Perplexity (décision
 * du propriétaire du 28/09/2026 : Google n'intervient plus dans l'analyse),
 * puis contrôle par le serveur de tout ce qui se présente comme un fait. L'enchaînement en
 * arrière-plan (suivi, reprise, facturation) est dans server/services/analysis/jobs.ts.
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

const ligne = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value.replace(/\s+/g, ' '));

/**
 * Ouvrage de l'auteur pour lequel l'étude est menée. Sa FICHE seulement — quelques lignes —,
 * jamais son texte : l'étude porte sur le marché, et le texte n'a rien à faire dans une recherche.
 */
export const analysisSubjectSchema = z.object({
  productId: z.string().trim().min(1).max(120),
  title: ligne(200).pipe(z.string().min(2)),
  subtitle: ligne(300).optional(),
  audience: ligne(600).optional(),
  promise: ligne(600).optional(),
  chapters: z.array(ligne(160)).max(40).default([]),
});

export const analysisRequestSchema = z.object({
  query: nicheQuerySchema,
  market: marketSchema.nullish(),
  subject: analysisSubjectSchema.nullish(),
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

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Assemble le rapport à partir de la réponse du modèle, en ne gardant comme fait
 * que ce que les sources établissent. Fonction pure.
 */
export function assembleReport(input: {
  id: string;
  query: string;
  market: string | null;
  now: Date;
  timeZone: string;
  sources: readonly WebSource[];
  webSearchConfigured: boolean;
  /** Étude qui a fourni les sources ; null : aucune. */
  research: ResearchEngine | null;
  response: AnalysisResponse;
  model: string;
  currency: string;
  /** Ouvrage que l'auteur a déjà écrit : le rapport prend position sur lui. */
  subject?: AnalysisSubject | null;
}): MarketAnalysisReport {
  const { id, sources, response } = input;
  const subject = input.subject ?? null;
  const validIds = new Set(sources.map((source) => source.id));
  const cite = (ids: readonly number[]) => ids.filter((sourceId) => validIds.has(sourceId));
  const noSource =
    sources.length > 0
      ? 'aucune source consultée ne documente ce point'
      : input.webSearchConfigured
        ? 'la recherche web n’a trouvé aucune page sur cette niche'
        : 'aucune recherche web n’est branchée sur ce serveur';

  const assessed = (key: MarketRate['key']): MarketRate => {
    const assessment = response[key];
    const sourceIds = cite(assessment.sourceIds);
    const level = (LEVELS as readonly string[]).includes(assessment.level) ? (assessment.level as TauxLevel) : null;
    if (level && sourceIds.length > 0 && assessment.rationale) {
      return { key, label: RATE_LABELS[key], level, score: null, trend: null, basis: 'assessment', sourceIds, description: assessment.rationale };
    }
    return { key, label: RATE_LABELS[key], level: null, score: null, trend: null, basis: 'unavailable', description: `Non évalué : ${noSource}.` };
  };

  const rates = {
    demand: assessed('demand'),
    saturation: assessed('saturation'),
    profitability: assessed('profitability'),
    opportunity: assessed('opportunity'),
    virality: assessed('virality'),
  };

  /*
    Un verdict, toujours. Celui du rédacteur d'abord, qui a lu les sources ; à défaut, celui que
    donnent les niveaux relevés. « Non établi — trop peu de taux ont pu être évalués » rendait la
    question à celui qui la posait (vu par un client le 04/10/2026) : une niche dont rien ne
    mesure la demande est un pari, et le dire est une réponse.
  */
  const stated = sources.length > 0 && (VERDICTS as readonly string[]).includes(response.verdict) ? (response.verdict as OverallVerdict) : null;
  const derived = deriveVerdict(rates);
  const overallVerdict: OverallVerdict = stated ?? derived.verdict;
  const verdictRationale =
    stated && response.verdictRationale
      ? response.verdictRationale
      : sources.length === 0
        ? `Niche non documentée (${noSource}) : traitez-la comme un pari, et validez-la par un test à petit budget avant de produire.`
        : derived.rationale;

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

  /*
    Jusqu'à huit idées, et non trois.

    Le nombre suit le potentiel de la niche : la consigne demande au modèle d'en proposer 3 sur
    une niche saturée ou à demande faible, et 6 à 8 sur une niche forte. Ce plafond était la
    vraie limite — le modèle pouvait en rendre davantage, le serveur les jetait.
  */
  const digitalProducts: DigitalProductIdea[] = response.products
    .filter((product) => product.title)
    .slice(0, 8)
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
      ...(product.targetProblem ? { targetProblem: product.targetProblem } : {}),
      ...(product.angle ? { angle: product.angle } : {}),
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
        // L'étude d'un ouvrage déjà écrit vend CET ouvrage, pas la première idée qui le prolonge.
        targetProductTitle: subject?.title ?? digitalProducts[0]?.title ?? nicheName,
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

  /*
    Des décisions, pas des devoirs rendus à l'auteur.

    Le rapport prend position sur ce que les sources n'ont pas établi, et dit sur quoi il
    s'appuie. Il n'invente jamais un chiffre de marché : quand rien ne le fonde, il propose une
    méthode pour l'obtenir.

    L'absence totale de sources reste elle aussi une décision, et la plus importante de toutes :
    ne rien produire sur ce rapport. La formuler ainsi vaut mieux que de la taire.
  */
  const decisions = [
    ...(sources.length === 0
      ? [
          {
            gap: input.webSearchConfigured
              ? 'La recherche web n’a trouvé aucune page sur cette niche : concurrents, prix et demande n’ont pas pu être étudiés.'
              : 'Aucune recherche web n’est branchée : concurrents, prix et demande n’ont pas été étudiés.',
            proposal:
              'Ne lancez aucune production à partir de ce rapport. Relancez l’analyse avec une formulation plus large, ou mettez deux boutiques concurrentes sous radar pendant une semaine.',
            basis: 'Règle de prudence : aucune source ne fonde ce qui suit.',
          },
        ]
      : []),
    ...response.decisions
      .filter((decision) => decision.gap && decision.proposal)
      // Un renvoi vers une source inexistante serait pire que pas de renvoi du tout.
      .map((decision) => ({
        ...decision,
        sourceIds: decision.sourceIds.filter((id) => sources.some((source) => source.id === id)),
      })),
  ];

  const collectedAt = input.now.toISOString();
  const research = input.research;
  // Les moteurs ne sont jamais nommés dans un rapport : ils peuvent changer d'une version à
  // l'autre, et le lecteur a besoin de savoir d'où vient un chiffre, pas quel fournisseur l'a
  // produit. Le modèle exact reste tracé côté serveur (table « generations » et journaux).
  const study =
    research?.mode === 'deep_research'
      ? `Étude approfondie du web (${research.searches} recherches, ${research.pagesConsulted} pages lues)`
      : 'Recherche web';
  // Marque blanche : la provenance affichée nomme le service, jamais un moteur ni « l'IA ».
  const writer = 'Smart Creator';
  const cited = (source: string): DataProvenance => ({
    source,
    collectedAt,
    sampleSize: sources.length,
    sampleUnit: 'sources citées',
    isDemonstration: false,
  });
  const proposed = (source: string): DataProvenance => ({ source, collectedAt, isDemonstration: false });

  /*
    Ce que l'étude dit de l'ouvrage de l'auteur. Un prix n'y figure que s'il vient d'une source :
    la règle est celle des idées de produits, et elle ne s'assouplit pas parce que l'ouvrage existe.
  */
  const review = subject ? response.authorWork : null;
  /*
    Toujours présent quand l'étude est menée pour un ouvrage, même si le rédacteur n'a rien dit de
    lui : c'est ce bloc qui rattache le rapport à l'ouvrage. Sans lui, la fiche du Studio resterait
    vide après une étude payée, et proposerait de la relancer.
  */
  const authorWork: AuthorWorkReview | null = subject
    ? {
        productId: subject.productId,
        title: subject.title,
        positioning: review?.positioning ?? '',
        targetProblem: review?.targetProblem ?? '',
        angle: review?.angle ?? '',
        pricingNote: (sources.length > 0 && (review?.pricingNote || response.pricing.recommendation)) || pricingFallback,
        strengths: review?.strengths ?? [],
        missingChapters: (review?.missingChapters ?? []).filter((chapter) => chapter.title).slice(0, 4),
        sourceIds: cite(review?.sourceIds ?? []),
      }
    : null;

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
    ...(authorWork ? { authorWork } : {}),
    illustrativeImages: [],
    strategicActionPlan: response.actionPlan
      .filter((phase) => phase.title && phase.steps.length > 0)
      .slice(0, 4)
      .map((phase) => ({ phase: phase.phase, title: phase.title, steps: phase.steps })),
    groundingSources: sources.map((source) => ({ id: source.id, title: source.title, url: source.url, publishedAt: source.publishedAt })),
    dataProvenance: {
      ...(sources.length > 0
        ? {
            rates: cited(`${study}, niveaux fixés par ${writer} d’après les sources citées`),
            competitors: cited(`${study} ; seuls les concurrents présents dans les sources sont retenus`),
          }
        : {}),
      ...(searchTrends.length > 0
        ? { searchTrends: proposed(`Expressions proposées par ${writer}${sources.length > 0 ? ' d’après l’étude' : ''} ; volumes de recherche non mesurés`) }
        : {}),
      ...(digitalProducts.length > 0
        ? { digitalProducts: proposed(`Idées proposées par ${writer}${sources.length > 0 ? ' d’après l’étude ; prix repris des seules sources citées' : ''}`) }
        : {}),
      ...(adCampaigns.length > 0 ? { adCampaigns: proposed(`Scripts proposés par ${writer}`) } : {}),
      ...(response.actionPlan.length > 0 ? { strategicActionPlan: proposed(`Plan proposé par ${writer}${sources.length > 0 ? ' d’après l’étude' : ''}`) } : {}),
    },
    decisions: decisions.slice(0, 8),
    keyFindings: response.keyFindings
      .filter((finding) => finding.title && finding.detail)
      .slice(0, 6)
      .map((finding) => ({ ...finding, sourceIds: cite(finding.sourceIds) })),
    audience: response.audience.profile ? { ...response.audience, sourceIds: cite(response.audience.sourceIds) } : null,
    pricing:
      response.pricing.observed || response.pricing.recommendation ? { ...response.pricing, sourceIds: cite(response.pricing.sourceIds) } : null,
    channels: response.channels.filter((channel) => channel.channel && channel.why).slice(0, 5),
    risks: response.risks
      .filter((risk) => risk.risk && risk.mitigation)
      .slice(0, 5)
      .map((risk) => ({ ...risk, sourceIds: cite(risk.sourceIds) })),
    generator: {
      provider: 'Smart Creator',
      model: ANALYSIS_PROMPT_VERSION,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      webSearch: sources.length > 0 ? 'Recherche web' : null,
      ...(research && sources.length > 0 ? { research: { ...research, sourcesCited: sources.length } } : {}),
      generatedAt: collectedAt,
    },
  };
}

/**
 * Rédige le rapport à partir de l'étude, le contrôle et l'enregistre sur le compte. Au-delà de
 * REPORTS_KEPT rapports, les plus anciens sont effacés.
 */
export async function writeReport(input: {
  userId: string;
  userCountry: string | null;
  request: AnalysisRequest;
  now: Date;
  research: ResearchOutcome;
}): Promise<MarketAnalysisReport> {
  const { request, now, research } = input;
  const subject = request.subject ?? null;
  const market = request.market ?? null;
  const marketName = market ? countryName(market) : null;

  let model = env.PERPLEXITY_WRITER;
  // Devise du pays de l'UTILISATEUR, et non du marché étudié : chacun ne lit que la sienne.
  const rates = await getRates();
  const currency = currencyForCountry(input.userCountry ?? market, rates);
  // Nos propres relevés (ventes affichées, prix, publicités en cours) rejoignent les sources de
  // l'étude : c'est ce que le web ne publie pas, et ce qui permet de trancher sur la demande.
  const own = await nicheSignalsSource(request.query, Math.max(0, ...research.sources.map((source) => source.id)) + 1, now).catch((error: unknown) => {
    console.warn('[analyse] relevés internes indisponibles :', error instanceof Error ? error.message : error);
    return null;
  });
  const sources = own ? [...research.sources, own] : research.sources;

  const response = await generateJsonWithPerplexity({
    service: SERVICE,
    prompt: buildAnalysisPrompt({
      query: request.query,
      marketName,
      today: todayLabel(now),
      sources,
      webSearchConfigured: true,
      memo: research.memo,
      currency: { code: currency, conversions: conversionHints(currency, rates) },
      subject,
    }),
    responseSchema: analysisResponseSchemaFor(Boolean(subject)),
    parse: parseAnalysisResponse,
    timeoutMs: TIMEOUT_MS,
    onModel: (used) => {
      model = used;
    },
  });

  // Les titres restés génériques sont précisés avant l'enregistrement : un sujet ne se vend pas, un angle si.
  response.products = await sharpenProductTitles(response.products, {
    niche: request.query,
    marketName,
    memo: research.memo,
    service: SERVICE,
    timeoutMs: 60_000,
  });

  const report = assembleReport({
    id: randomUUID(),
    query: request.query,
    market,
    now,
    timeZone: env.REPORTING_TIMEZONE,
    sources,
    webSearchConfigured: true,
    research: research.engine,
    response,
    model,
    currency,
    subject,
  });

  const db = getDb();
  await db.insert(reports).values({
    id: report.id,
    userId: input.userId,
    query: report.query,
    nicheName: report.nicheName,
    market,
    report: report as unknown as Record<string, unknown>,
    researchMemo: research.memo.trim() || null,
    createdAt: now,
  });

  const overflow = await db
    .select({ id: reports.id })
    .from(reports)
    .where(eq(reports.userId, input.userId))
    .orderBy(desc(reports.createdAt))
    .offset(REPORTS_KEPT);
  if (overflow.length > 0) {
    await db.delete(reports).where(and(eq(reports.userId, input.userId), inArray(reports.id, overflow.map((row) => row.id))));
  }

  return report;
}

/** Date lisible du jour, dans le fuseau des rapports. */
export function todayLabel(now: Date): string {
  return now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: env.REPORTING_TIMEZONE });
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

/** Efface tout l'historique des niches analysées du compte, et rend le nombre de rapports supprimés. */
export async function deleteAllReports(auth: RequestAuth): Promise<number> {
  const deleted = await getDb().delete(reports).where(eq(reports.userId, auth.account.user.id)).returning({ id: reports.id });
  return deleted.length;
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
