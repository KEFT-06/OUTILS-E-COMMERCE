import { and, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { reportDocuments, reports, users } from '@server/db/schema';
import { env, isServerless, providers } from '@server/env';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { debitCredits, effectiveLimits, refundDebit } from '@server/services/accounts';
import { generateJsonWithPerplexity, generateTextWithPerplexity } from '@server/services/ai/perplexity';
import { checkText } from '@server/services/compliance';
import { getActionCost } from '@server/services/credits';
import { conversionHints, currencyForCountry, getRates } from '@server/services/currency';
import { ensureReady } from '@server/services/preflight';
import type {
  MarketAnalysisReport,
  ReportDocument,
  ReportDocumentCompliance,
  ReportDocumentSource,
  WebGroundingSource,
} from '@server/shared/analysis';
import { runInBackground } from '@server/shared/backgroundWork';
import { countryName } from '@server/shared/countries';
import { REPORT_WORDS_PER_PAGE } from '@server/shared/reportLength';
import { neutralizeMessage } from '@server/shared/whiteLabel';
import { todayLabel } from '@server/services/analysis';

/**
 * Rapport rédigé à la demande, après l'analyse (décision du propriétaire du 29/09/2026).
 *
 * L'analyse ne rédige plus de rapport d'elle-même : elle produit la fiche, l'utilisateur la lit,
 * puis clique sur « Rédiger le rapport ». Le rédacteur (Perplexity) choisit librement le plan ;
 * le serveur garantit le reste :
 *  - aucun taux : les niveaux et scores de la fiche ne lui sont même pas transmis ;
 *  - aucun renvoi inventé : un [n] qui ne correspond à aucune source est retiré ;
 *  - la bibliographie est construite ici, à partir des sites réellement consultés, et toute
 *    liste de sources écrite par le rédacteur est écartée ;
 *  - conformité contrôlée avant que le rapport soit proposé au téléchargement.
 *
 * La rédaction tourne en arrière-plan ; le navigateur suit l'avancement. Échec ou délai
 * dépassé : points rendus, une seule fois.
 */

const SERVICE = { name: 'service de rédaction', code: 'REPORT', log: 'rapport rédigé' };
export const REPORT_DOCUMENT_ACTION = 'market_report_write';
const MIN_CHARS = 1_200;
const MAX_MEMO_CHARS = 30_000;

type DocumentRow = typeof reportDocuments.$inferSelect;

const reportIdSchema = z.string().uuid();
const reportNotFound = () => new AppError(404, 'Rapport introuvable sur votre compte.', 'REPORT_NOT_FOUND');

/* -------------------------------------------------------------------------- */
/*  Consigne et matière transmises au rédacteur                                */
/* -------------------------------------------------------------------------- */

/** Longueurs proposées à l'utilisateur, en pages A4 (plafonnées par le palier). */
export const REPORT_PAGES = { min: 1, max: 250, default: 10 } as const;
/** Mots par page A4, à la mise en page du PDF : mesuré, voir server/shared/reportLength.ts. */
const WORDS_PER_PAGE = REPORT_WORDS_PER_PAGE;
/** Jusque-là, un seul appel suffit ; au-delà, le rapport s'écrit partie par partie. */
const SINGLE_CALL_MAX_PAGES = 6;
/** Au-delà, les parties se regroupent en chapitres. */
const CHAPTER_THRESHOLD_PAGES = 40;
/** Parties rédigées en même temps. */
const SECTION_CONCURRENCY = 5;

const COMMON_RULES = [
  '2. Aucun taux : pas de score, de note sur 100, de pourcentage ni de niveau (faible, moyen, élevé…) attribué à la demande, la saturation, la rentabilité, l’opportunité ou la viralité.',
  '3. Chaque fait (chiffre, prix, concurrent, tendance, citation) vient des sources fournies et porte son renvoi entre crochets, au numéro de la source : [2], ou [1][4]. N’invente ni chiffre, ni concurrent, ni source.',
  '4. Quand les sources ne tranchent pas, prends position : une recommandation argumentée (comparables, raisonnement, prudence assumée), présentée comme telle. Ne renvoie jamais le lecteur à des « points à vérifier » ou à valider lui-même.',
  '5. N’écris pas de bibliographie, de liste de sources ni d’annexe de références : elle est ajoutée automatiquement à la fin.',
  '6. Ne nomme aucun outil d’analyse, moteur de recherche ni intelligence artificielle, et ne parle pas de toi.',
];

const ROLE = [
  'Tu es un analyste e-commerce senior, spécialiste de la vente de produits digitaux (ebooks, formations, modèles, outils).',
  'Tu rédiges en français un rapport d’étude de marché pour un créateur qui décide s’il se lance sur cette niche, et comment.',
];

/** Consigne d'un rapport écrit d'un seul tenant. */
function wholeReportInstructions(words: number): string {
  return [
    ...ROLE,
    '',
    'Plan : tu le choisis librement, selon ce que la matière rend le plus utile. Aucun plan n’est imposé ; donne à chaque partie un titre parlant plutôt qu’un intitulé générique.',
    '',
    'Règles impératives :',
    '1. Format Markdown : un titre principal (# …), des parties (## …), au besoin des sous-parties (### …). Des paragraphes rédigés ; des listes quand elles aident ; un tableau seulement pour comparer des offres.',
    ...COMMON_RULES,
    `7. Environ ${words} mots, soit la longueur demandée par l’utilisateur. Termine par des recommandations concrètes et datées dans le temps (semaines, mois).`,
  ].join('\n');
}

/** Consigne d'une partie d'un rapport long, écrite à côté des autres. */
function sectionInstructions(words: number, level: '##' | '###'): string {
  return [
    ...ROLE,
    'Le rapport est long : il est rédigé partie par partie. Tu rédiges UNE partie, dont le titre et le contenu attendu te sont donnés, en tenant compte du plan complet pour ne rien répéter des autres parties.',
    '',
    'Règles impératives :',
    `1. Format Markdown : commence par le titre de ta partie (${level} …), puis des sous-parties si utile (${level}# …). Pas de titre de niveau supérieur. Des paragraphes rédigés ; des listes quand elles aident ; un tableau seulement pour comparer des offres.`,
    ...COMMON_RULES,
    `7. Environ ${words} mots pour cette partie.`,
  ].join('\n');
}

interface OutlineSection {
  /** Chapitre de rattachement, pour les rapports de plus de 40 pages. */
  chapter?: string;
  heading: string;
  focus: string;
  pages: number;
}

/** Chapitre d'un rapport long, et ses parties une fois planifiées. */
interface ChapterPlan {
  title: string;
  focus: string;
  pages: number;
  parts?: OutlineSection[];
}

interface ReportOutline {
  title: string;
  sections: OutlineSection[];
  /**
   * Rapport long en cours de planification : ses chapitres, dont les parties s'écrivent une à une.
   * Absent une fois le plan complet (les parties sont alors toutes dans `sections`).
   */
  chapters?: ChapterPlan[];
}

const OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { chapter: { type: 'string' }, heading: { type: 'string' }, focus: { type: 'string' }, pages: { type: 'number' } },
        required: ['heading', 'focus', 'pages'],
      },
    },
  },
  required: ['title', 'sections'],
} as const;

const outlineSchema = z.object({
  title: z.string().trim().min(3).max(200),
  sections: z
    .array(
      z.object({
        chapter: z.string().trim().max(160).optional(),
        heading: z.string().trim().min(2).max(160),
        focus: z.string().trim().min(2).max(600),
        pages: z.number().positive(),
      }),
    )
    .min(2)
    .max(110),
});

const CHAPTERS_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, focus: { type: 'string' }, pages: { type: 'number' } },
        required: ['title', 'focus', 'pages'],
      },
    },
  },
  required: ['title', 'chapters'],
} as const;

const chaptersSchema = z.object({
  title: z.string().trim().min(3).max(200),
  chapters: z
    .array(z.object({ title: z.string().trim().min(2).max(160), focus: z.string().trim().min(2).max(600), pages: z.number().positive() }))
    .min(2)
    .max(20),
});

const PARTS_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { heading: { type: 'string' }, focus: { type: 'string' }, pages: { type: 'number' } },
        required: ['heading', 'focus', 'pages'],
      },
    },
  },
  required: ['sections'],
} as const;

const partsSchema = z.object({
  sections: z
    .array(z.object({ heading: z.string().trim().min(2).max(160), focus: z.string().trim().min(2).max(600), pages: z.number().positive() }))
    .min(1)
    .max(14),
});

/** Nombre de parties (et de chapitres) d'un rapport de `pages` pages. */
function outlineShape(pages: number): { parts: number; chapters: number | null } {
  return {
    parts: Math.min(100, Math.max(3, Math.round(pages / 2.5))),
    chapters: pages > CHAPTER_THRESHOLD_PAGES ? Math.min(16, Math.max(3, Math.round(pages / 15))) : null,
  };
}

const line = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const refs = (ids: number[] | undefined) => (ids && ids.length > 0 ? ` ${ids.map((id) => `[${id}]`).join('')}` : '');

/**
 * Matière du rapport : les sources numérotées, les notes de l'étude et la fiche d'analyse —
 * sans ses taux, ses scores ni ses marges estimées, que le rapport ne doit pas reprendre.
 */
export function buildDocumentPrompt(input: {
  report: MarketAnalysisReport;
  memo: string | null;
  today: string;
  /** Devise du pays de l'utilisateur, et taux pour y convertir les prix des sources. */
  currency?: { code: string; conversions: string };
}): string {
  const { report } = input;
  const market = report.market ? countryName(report.market) : null;
  const sources = report.groundingSources ?? [];
  const out: string[] = [
    `Niche étudiée : « ${report.nicheName} » (recherche de l’utilisateur : « ${line(report.query)} »).`,
    `Marché visé : ${market ?? 'tous marchés francophones'}. Date du rapport : ${input.today}.`,
    ...(input.currency
      ? [`Devise : tout montant s’écrit en ${input.currency.code}, la devise de l’utilisateur, et dans aucune autre. Convertis les prix des sources avec ces taux (${input.currency.conversions}), arrondis simplement, sans rappeler le montant d’origine.`]
      : []),
    '',
    '## Sources numérotées (les seules que tu peux citer)',
    ...sources.map((source) => `[${source.id}] ${line(source.title)} — ${source.url}${source.publishedAt ? ` (${source.publishedAt})` : ''}`),
  ];

  const memo = input.memo?.trim();
  if (memo) {
    out.push('', '## Notes de l’étude du web', memo.length > MAX_MEMO_CHARS ? `${memo.slice(0, MAX_MEMO_CHARS)}…` : memo);
  }

  out.push('', '## Fiche d’analyse déjà établie', `Synthèse : ${line(report.executiveSummary)}${refs(report.summarySourceIds)}`);
  if (report.overallVerdict) out.push(`Verdict : ${report.overallVerdict}. ${line(report.verdictRationale)}`);

  if (report.competitors.length > 0) {
    out.push('', 'Concurrents relevés :');
    for (const competitor of report.competitors) {
      out.push(
        `- ${line(competitor.name)} (${line(competitor.urlOrHandle)}) — prix : ${line(competitor.priceRange) || 'non relevé'} ; positionnement : ${line(competitor.positioning)}` +
          `${competitor.strengths.length ? ` ; forces : ${competitor.strengths.map(line).join(' / ')}` : ''}` +
          `${competitor.weaknesses.length ? ` ; faiblesses : ${competitor.weaknesses.map(line).join(' / ')}` : ''}` +
          `${competitor.exploitableGaps.length ? ` ; failles : ${competitor.exploitableGaps.map(line).join(' / ')}` : ''}` +
          refs(competitor.sourceIds),
      );
    }
  }

  if (report.digitalProducts.length > 0) {
    out.push('', 'Produits digitaux proposés (idées, pas des faits) :');
    for (const product of report.digitalProducts) {
      const price = product.recommendedPrice !== null ? ` ; prix envisagé : ${product.recommendedPrice} ${product.currency}` : '';
      out.push(`- ${line(product.title)} — ${line(product.subtitle)} ; pour : ${line(product.targetAudience)} ; promesse : ${line(product.transformationPromise)}${price}`);
    }
  }

  if (report.searchTrends.length > 0) {
    out.push('', `Expressions de recherche envisagées (volumes non mesurés) : ${report.searchTrends.map((trend) => line(trend.keyword)).join(', ')}.`);
  }

  const decisions = report.decisions ?? [];
  if (decisions.length > 0) {
    out.push('', 'Points non établis par les sources, et décision proposée :');
    for (const decision of decisions) out.push(`- ${line(decision.gap)} → ${line(decision.proposal)} (appui : ${line(decision.basis)})${refs(decision.sourceIds)}`);
  }

  if (report.strategicActionPlan.length > 0) {
    out.push('', 'Plan d’action proposé :');
    for (const phase of report.strategicActionPlan) out.push(`- ${line(phase.phase)} — ${line(phase.title)} : ${phase.steps.map(line).join(' ; ')}`);
  }

  if (report.keyFindings?.length) {
    out.push('', 'Constats clés :');
    for (const finding of report.keyFindings) out.push(`- ${line(finding.title)} : ${line(finding.detail)}${refs(finding.sourceIds)}`);
  }
  if (report.audience) {
    const a = report.audience;
    out.push('', `Acheteur : ${line(a.profile)}${refs(a.sourceIds)}`, `Difficultés : ${a.pains.map(line).join(' ; ')}`, `Motivations : ${a.motivations.map(line).join(' ; ')}`, `Freins et réponses : ${a.objections.map(line).join(' ; ')}`);
  }
  if (report.pricing) {
    out.push('', `Prix constatés : ${line(report.pricing.observed)}${refs(report.pricing.sourceIds)}`, `Prix conseillés : ${line(report.pricing.recommendation)}`, `Paiement : ${report.pricing.paymentMethods.map(line).join(', ')}`);
  }
  if (report.channels?.length) {
    out.push('', 'Canaux :');
    for (const channel of report.channels) out.push(`- ${line(channel.channel)} : ${line(channel.why)}`);
  }
  if (report.risks?.length) {
    out.push('', 'Risques et parades :');
    for (const risk of report.risks) out.push(`- ${line(risk.risk)} → ${line(risk.mitigation)}${refs(risk.sourceIds)}`);
  }

  return out.join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Contrôle du texte rendu                                                    */
/* -------------------------------------------------------------------------- */

/** Titre d'une liste de sources écrite par le rédacteur malgré la consigne : on coupe à partir de là. */
const BIBLIOGRAPHY_HEADING = /^#{1,4}\s*(?:\d+[.)]?\s*)?(?:annexes?\b.*)?(?:bibliographie|sources|références|webographie|liens utiles)\b.*$/im;
const CITATION_LINK = /\[(\d{1,3})\]\([^)\s]*\)/g;
const CITATION = /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g;

/**
 * Nettoie le texte rendu : enveloppe de code retirée, bibliographie du rédacteur écartée,
 * renvois vers des sources inexistantes supprimés. Renvoie aussi les numéros réellement cités.
 */
export function finalizeDocument(text: string, sourceIds: ReadonlySet<number>, fallbackTitle: string): { title: string; markdown: string; cited: Set<number> } {
  let body = text.trim().replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/, '');

  const heading = BIBLIOGRAPHY_HEADING.exec(body);
  if (heading && heading.index > body.length / 3) body = body.slice(0, heading.index);

  const cited = new Set<number>();
  body = body
    .replace(CITATION_LINK, '[$1]')
    .replace(CITATION, (_match, list: string) => {
      const kept = list
        .split(/[,;]/)
        .map((part) => Number(part.trim()))
        .filter((id) => sourceIds.has(id));
      for (const id of kept) cited.add(id);
      return kept.map((id) => `[${id}]`).join('');
    })
    // Un renvoi retiré laisse parfois une espace avant la ponctuation.
    .replace(/[ \t]+([.,;:!?])/g, (match, mark: string) => (mark === ':' || mark === ';' || mark === '!' || mark === '?' ? match : mark))
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const titleLine = /^#\s+(.+)$/m.exec(body);
  const title = titleLine ? titleLine[1]!.replace(/[*_`]/g, '').trim() : fallbackTitle;
  if (!titleLine) body = `# ${fallbackTitle}\n\n${body}`;
  return { title, markdown: body, cited };
}

const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Annexe : tous les sites consultés par l'étude, ceux que le texte cite en premier. */
export function bibliographyOf(sources: readonly WebGroundingSource[], markdown: string | null): ReportDocumentSource[] {
  const cited = new Set<number>();
  if (markdown) for (const match of markdown.matchAll(/\[(\d{1,3})\]/g)) cited.add(Number(match[1]));
  return sources
    .filter((source): source is WebGroundingSource & { id: number } => typeof source.id === 'number')
    .map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      site: siteOf(source.url),
      publishedAt: source.publishedAt ?? null,
      cited: cited.has(source.id),
    }))
    .sort((a, b) => a.id - b.id);
}

/* -------------------------------------------------------------------------- */
/*  Lecture, lancement, rédaction                                              */
/* -------------------------------------------------------------------------- */

async function ownedReport(auth: RequestAuth, reportId: string | undefined) {
  const parsed = reportIdSchema.safeParse(reportId);
  if (!parsed.success) throw reportNotFound();
  const [row] = await getDb()
    .select({ id: reports.id, report: reports.report })
    .from(reports)
    .where(and(eq(reports.id, parsed.data), eq(reports.userId, auth.account.user.id)))
    .limit(1);
  if (!row) throw reportNotFound();
  return { id: row.id, report: row.report as unknown as MarketAnalysisReport };
}

function viewOf(row: DocumentRow, report: MarketAnalysisReport): ReportDocument {
  const ready = row.status === 'ready';
  return {
    reportId: row.reportId,
    status: row.status as ReportDocument['status'],
    title: ready ? row.title : null,
    markdown: ready ? row.markdown : null,
    bibliography: ready ? bibliographyOf(report.groundingSources ?? [], row.markdown) : [],
    compliance: ready ? ((row.compliance as unknown as ReportDocumentCompliance | null) ?? null) : null,
    error: row.status === 'failed' ? { code: row.errorCode ?? 'REPORT_FAILED', message: row.errorMessage ?? 'La rédaction n’a pas abouti.' } : null,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    targetPages: row.targetPages ?? null,
    progress:
      row.status === 'writing' && Array.isArray(row.sections) && row.sections.length > 0
        ? { done: row.sections.filter(Boolean).length, total: row.sections.length }
        : null,
  };
}

/** Échec enregistré une seule fois, avec remboursement dans la même transaction. */
async function failDocument(reportId: string, error: unknown): Promise<void> {
  const known = error instanceof AppError;
  const code = known ? error.code : 'REPORT_FAILED';
  const message = neutralizeMessage(known ? error.message : 'La rédaction du rapport a échoué sur le serveur : vos points ont été rendus.');
  if (!known) console.error(`[${SERVICE.log}] échec inattendu`, error);

  await getDb().transaction(async (tx) => {
    const [claimed] = await tx
      .update(reportDocuments)
      .set({ status: 'failed', errorCode: code, errorMessage: message, refunded: true, updatedAt: new Date(), completedAt: new Date() })
      .where(and(eq(reportDocuments.reportId, reportId), eq(reportDocuments.status, 'writing'), eq(reportDocuments.refunded, false)))
      .returning();
    if (claimed?.debitTransactionId && claimed.creditsCharged > 0) {
      await refundDebit({ debitTransactionId: claimed.debitTransactionId, generationId: null, note: 'Le rapport rédigé n’a pas abouti : points rendus.' }, tx);
    }
  });
}

/** Plan d'un rapport long : titre, parties (et chapitres), pages réparties pour atteindre la longueur. */
async function outlineOf(material: string, pages: number, timeoutMs: number): Promise<ReportOutline> {
  const { parts, chapters } = outlineShape(pages);
  const structure = chapters
    ? `${chapters} chapitres (champ « chapter », le même pour toutes les parties d’un chapitre, parties d’un même chapitre à la suite) regroupant ${parts} parties au total`
    : `${parts} parties (entre 3 et 14), sans champ « chapter »`;
  const outline = await generateJsonWithPerplexity({
    service: SERVICE,
    instructions: [...ROLE, 'Tu prépares le PLAN du rapport ; les parties seront rédigées ensuite, chacune à part.'].join('\n'),
    prompt: `${material}\n\nPLAN DU RAPPORT : propose un titre parlant et ${structure}, pour un rapport d’environ ${pages} pages. Pour chaque partie : un titre parlant (« heading »), ce qu’elle doit couvrir sans empiéter sur les autres (« focus »), et son nombre de pages (« pages »). La somme des pages fait ${pages}. Aucune partie « sources », « bibliographie » ni « annexe » : elle est ajoutée automatiquement. Termine par des recommandations concrètes et datées.`,
    responseSchema: OUTLINE_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => outlineSchema.parse(value),
    maxOutputTokens: Math.min(16_000, 800 + parts * 120),
    timeoutMs,
  });
  // Pages rééquilibrées : la somme proposée ne tombe pas toujours juste.
  const total = outline.sections.reduce((sum, section) => sum + section.pages, 0) || 1;
  return {
    title: outline.title,
    sections: outline.sections.map((section) => ({
      ...(chapters && section.chapter ? { chapter: section.chapter } : {}),
      heading: section.heading,
      focus: section.focus,
      pages: (section.pages / total) * pages,
    })),
  };
}

/*
  Plan d'un rapport de plus de quarante pages, en deux temps.

  Demandé d'un seul tenant, le plan d'un rapport de 250 pages est une réponse d'une centaine de
  parties : assez longue pour être coupée avant sa fin, et tout le rapport échouait alors sur son
  plan. Les chapitres sont donc demandés d'abord (une quinzaine de lignes), puis les parties de
  chaque chapitre, à part : chaque réponse est courte, et un chapitre qui échoue se redemande seul.
*/

/** Premier temps : le titre et les chapitres, avec leur nombre de pages. */
async function chaptersOf(material: string, pages: number, timeoutMs: number): Promise<ReportOutline> {
  const count = outlineShape(pages).chapters ?? 3;
  const planned = await generateJsonWithPerplexity({
    service: SERVICE,
    instructions: [...ROLE, 'Tu prépares le PLAN du rapport ; les chapitres seront détaillés puis rédigés ensuite, chacun à part.'].join('\n'),
    prompt: `${material}\n\nPLAN DES CHAPITRES : propose un titre parlant et ${count} chapitres, pour un rapport d’environ ${pages} pages. Pour chaque chapitre : un titre parlant (« title »), ce qu’il doit couvrir sans empiéter sur les autres (« focus », deux phrases au plus), et son nombre de pages (« pages »). La somme des pages fait ${pages}. Aucun chapitre « sources », « bibliographie » ni « annexe » : elle est ajoutée automatiquement. Le dernier chapitre porte les recommandations concrètes et datées.`,
    responseSchema: CHAPTERS_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => chaptersSchema.parse(value),
    maxOutputTokens: Math.min(6_000, 800 + count * 220),
    timeoutMs,
  });
  const total = planned.chapters.reduce((sum, chapter) => sum + chapter.pages, 0) || 1;
  return {
    title: planned.title,
    sections: [],
    chapters: planned.chapters.map((chapter) => ({ title: chapter.title, focus: chapter.focus, pages: (chapter.pages / total) * pages })),
  };
}

/** Second temps : les parties d'un chapitre, avec la liste des chapitres sous les yeux. */
async function partsOfChapter(material: string, outline: ReportOutline, index: number, timeoutMs: number): Promise<OutlineSection[]> {
  const chapters = outline.chapters ?? [];
  const chapter = chapters[index]!;
  const count = Math.min(12, Math.max(2, Math.round(chapter.pages / 2.5)));
  const plan = chapters.map((entry, position) => `${position + 1}. ${entry.title} — ${entry.focus}`).join('\n');
  const planned = await generateJsonWithPerplexity({
    service: SERVICE,
    instructions: [...ROLE, 'Tu détailles le plan d’UN chapitre du rapport ; ses parties seront rédigées ensuite, chacune à part.'].join('\n'),
    prompt: `${material}\n\n## Chapitres du rapport « ${outline.title} »\n${plan}\n\nPLAN DU CHAPITRE ${index + 1} : « ${chapter.title} » — ${chapter.focus}. Propose ${count} parties pour ce chapitre d’environ ${Math.max(1, Math.round(chapter.pages))} pages. Pour chaque partie : un titre parlant (« heading »), ce qu’elle doit couvrir sans empiéter sur les autres parties ni sur les autres chapitres (« focus », une phrase), et son nombre de pages (« pages »).`,
    responseSchema: PARTS_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => partsSchema.parse(value),
    maxOutputTokens: Math.min(4_000, 600 + count * 180),
    timeoutMs,
  });
  const total = planned.sections.reduce((sum, section) => sum + section.pages, 0) || 1;
  return planned.sections.map((section) => ({ chapter: chapter.title, heading: section.heading, focus: section.focus, pages: (section.pages / total) * chapter.pages }));
}

/** Tous les chapitres sont planifiés : leurs parties, à la suite, deviennent le plan du rapport. */
function flattenChapters(outline: ReportOutline): ReportOutline {
  return { title: outline.title, sections: (outline.chapters ?? []).flatMap((chapter) => chapter.parts ?? []) };
}

/** Rédige une partie d'un rapport long, avec le plan complet sous les yeux. */
async function writeSection(material: string, outline: ReportOutline, index: number, timeoutMs: number): Promise<string> {
  const section = outline.sections[index]!;
  const level = section.chapter ? '###' : '##';
  const words = Math.max(250, Math.round(section.pages * WORDS_PER_PAGE));
  const plan = outline.sections
    .map((entry, position) => `${position + 1}. ${entry.chapter ? `[${entry.chapter}] ` : ''}${entry.heading} — ${entry.focus}`)
    .join('\n');
  const written = await generateTextWithPerplexity({
    service: SERVICE,
    instructions: sectionInstructions(words, level),
    prompt: `${material}\n\n## Plan complet du rapport « ${outline.title} »\n${plan}\n\nRÉDIGE LA PARTIE ${index + 1} : « ${section.heading} » — ${section.focus}. Environ ${words} mots. Commence par « ${level} ${section.heading} ».`,
    maxOutputTokens: Math.min(8_000, Math.round(words * 2.2)),
    minChars: Math.min(MIN_CHARS, words * 3),
    timeoutMs,
  });
  // Une partie ne porte pas de titre de niveau supérieur : un « # » égaré redevient une partie.
  const body = written.text.trim().replace(/^#{1,2}\s+/gm, `${level} `);
  return body.startsWith(`${level} `) ? body : `${level} ${section.heading}\n\n${body}`;
}

/** Assemble le rapport : titre, chapitres (rapports longs), parties dans l'ordre du plan. */
function assemble(outline: ReportOutline, sections: string[]): string {
  const out = [`# ${outline.title}`];
  let chapter: string | undefined;
  outline.sections.forEach((section, index) => {
    if (section.chapter && section.chapter !== chapter) {
      chapter = section.chapter;
      out.push(`## ${chapter}`);
    }
    out.push(sections[index] ?? '');
  });
  return out.join('\n\n');
}

/**
 * Rédaction d'un rapport court, d'un seul appel, contrôle compris : sans base de données.
 * Sert aussi aux essais réels du rédacteur.
 */
export async function composeDocument(input: {
  report: MarketAnalysisReport;
  memo: string | null;
  today: string;
  pages?: number;
  currency?: { code: string; conversions: string };
}): Promise<{ title: string; markdown: string; model: string | null }> {
  const { report } = input;
  const pages = Math.min(SINGLE_CALL_MAX_PAGES, Math.max(REPORT_PAGES.min, Math.round(input.pages ?? SINGLE_CALL_MAX_PAGES)));
  const words = pages * WORDS_PER_PAGE;
  const { text, model } = await generateTextWithPerplexity({
    service: SERVICE,
    instructions: wholeReportInstructions(words),
    prompt: `${buildDocumentPrompt(input)}\n\nRédige maintenant le rapport complet, selon les règles.`,
    maxOutputTokens: Math.min(12_000, Math.max(1_500, Math.round(words * 2.2))),
    minChars: Math.min(MIN_CHARS, words * 3),
    timeoutMs: SLICE_BUDGET_MS,
  });
  const { title, markdown } = finalizeDocument(text, sourceIdsOf(report), fallbackTitleOf(report));
  return { title, markdown, model };
}

const sourceIdsOf = (report: MarketAnalysisReport) =>
  new Set((report.groundingSources ?? []).flatMap((source) => (typeof source.id === 'number' ? [source.id] : [])));
const fallbackTitleOf = (report: MarketAnalysisReport) => `Rapport d’étude de marché : ${report.nicheName}`;

/*
  Rapport long, écrit sur plusieurs passages du serveur.

  Une fonction dispose de 300 s. Un rapport de 250 pages, c'est une centaine de parties : bien
  plus qu'un passage. Le plan puis chaque partie sont donc enregistrés au fur et à mesure ; un
  passage s'arrête avant d'être coupé, libère sa réservation, et le suivi de l'écran lance le
  passage suivant, qui reprend là où le précédent s'est arrêté. Rien d'écrit n'est perdu.
*/

/** Temps de travail d'un passage, sous les 300 s accordés à une fonction. */
const SLICE_BUDGET_MS = 200_000;
/** Réservation d'un passage : au-delà, un passage coupé en route est considéré perdu et relancé. */
const LEASE_MS = 280_000;
/** Un nouvel essai programmé à moins de ce délai est attendu par le passage enchaîné lui-même. */
const PAUSE_WAIT_MS = 150_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());
/** Passages en cours dans cette instance : un même rapport n'est pas écrit deux fois en parallèle. */
const running = new Set<string>();

/** Refus passagers : le fournisseur est saturé, trop lent ou momentanément absent. */
const TRANSIENT = /_(OVERLOADED|RATE_LIMITED|TIMEOUT|UNAVAILABLE)$/;
/** Attentes avant chaque nouvel essai ; au-delà, la rédaction échoue et rend les points. */
const RETRY_WAITS_MS = [15_000, 45_000, 2 * 60_000, 5 * 60_000];

/** Mise à jour valable seulement pour CETTE rédaction : une réécriture lancée entre-temps garde la main. */
const sameWriting = (reportId: string, startedAt: Date) =>
  and(eq(reportDocuments.reportId, reportId), eq(reportDocuments.status, 'writing'), eq(reportDocuments.startedAt, startedAt));

/**
 * Demande au site de lancer lui-même le passage suivant, sans attendre que l'écran le réclame.
 *
 * L'écran promet « Vous pouvez quitter cette page : la rédaction continue ». Ce n'était vrai que
 * tant qu'un écran restait ouvert pour relancer chaque passage ; un rapport de 250 pages, qui en
 * demande une dizaine, s'arrêtait dès qu'on le quittait. Même mécanisme que pour les ebooks.
 */
async function chainNext(reportId: string): Promise<void> {
  if (!env.CRON_SECRET) return;
  try {
    const response = await fetch(`${env.APP_URL.replace(/\/+$/, '')}/api/cron/rapport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) console.warn(`[${SERVICE.log}] relance de ${reportId} refusée (${response.status})`);
  } catch (error) {
    console.warn(`[${SERVICE.log}] relance de ${reportId} non partie :`, error instanceof Error ? error.message : error);
  }
}

async function runSlice(reportId: string, startedAt: Date, today: string): Promise<void> {
  if (running.has(reportId)) return;
  running.add(reportId);
  const db = getDb();
  /** Vrai quand il reste du travail après ce passage : le suivant est alors demandé. */
  let more = false;
  try {
    const [row] = await db
      .select({
        report: reports.report,
        memo: reports.researchMemo,
        country: users.country,
        pages: reportDocuments.targetPages,
        outline: reportDocuments.outline,
        sections: reportDocuments.sections,
      })
      .from(reports)
      .innerJoin(users, eq(users.id, reports.userId))
      .innerJoin(reportDocuments, eq(reportDocuments.reportId, reports.id))
      .where(eq(reports.id, reportId))
      .limit(1);
    if (!row) return;
    const report = row.report as unknown as MarketAnalysisReport;
    const pages = row.pages ?? REPORT_PAGES.default;
    // Devise du pays de l'utilisateur : chacun ne lit que la sienne.
    const rates = await getRates();
    const code = currencyForCountry(row.country, rates);
    const currency = { code, conversions: conversionHints(code, rates) };
    const budgetEnd = Date.now() + SLICE_BUDGET_MS;

    if (pages <= SINGLE_CALL_MAX_PAGES) {
      const { title, markdown, model } = await composeDocument({ report, memo: row.memo, today, pages, currency });
      await complete(reportId, startedAt, title, markdown, model);
      return;
    }

    const material = buildDocumentPrompt({ report, memo: row.memo, today, currency });
    let outline = row.outline as unknown as ReportOutline | null;
    let sections = row.sections ?? [];
    const waveLimit = env.REPORT_SLICE_WAVES;
    let waves = 0;
    /** Plus assez de temps pour une vague entière : la main passe au passage suivant. */
    const outOfTime = () => budgetEnd - Date.now() < 60_000 || (waveLimit > 0 && waves >= waveLimit);
    const handOver = async () => {
      await db.update(reportDocuments).set({ leaseUntil: null }).where(sameWriting(reportId, startedAt));
      more = true;
    };
    const waveTimeout = () => Math.max(30_000, Math.min(150_000, budgetEnd + 60_000 - Date.now()));
    /** Enregistre une avancée ; faux quand une réécriture lancée entre-temps a repris la main. */
    const save = async (changes: { outline?: ReportOutline; sections?: (string | null)[] }) => {
      const [saved] = await db
        .update(reportDocuments)
        .set({
          ...(changes.outline ? { outline: changes.outline as unknown as Record<string, unknown> } : {}),
          ...(changes.sections ? { sections: changes.sections } : {}),
          // Une avancée efface les refus passés : seuls des refus à la suite, sans rien d'écrit, mènent à l'échec.
          retryCount: 0,
          errorCode: null,
          updatedAt: new Date(),
        })
        .where(sameWriting(reportId, startedAt))
        .returning({ reportId: reportDocuments.reportId });
      return Boolean(saved);
    };

    if (!outline) {
      const timeoutMs = Math.min(120_000, budgetEnd - Date.now());
      outline = pages > CHAPTER_THRESHOLD_PAGES ? await chaptersOf(material, pages, timeoutMs) : await outlineOf(material, pages, timeoutMs);
      if (!outline.chapters) sections = new Array<string | null>(outline.sections.length).fill(null);
      if (!(await save({ outline, ...(outline.chapters ? {} : { sections }) }))) return;
    }

    // Rapport long : les parties de chaque chapitre sont planifiées par vagues, chacune gardée dès qu'elle est prête.
    while (outline.chapters) {
      const todo = outline.chapters.flatMap((chapter, index) => (chapter.parts ? [] : [index]));
      if (todo.length === 0) {
        outline = flattenChapters(outline);
        sections = new Array<string | null>(outline.sections.length).fill(null);
        if (!(await save({ outline, sections }))) return;
        break;
      }
      if (outOfTime()) return await handOver();
      const wave = todo.slice(0, SECTION_CONCURRENCY);
      const timeoutMs = waveTimeout();
      const settled = await Promise.allSettled(wave.map((index) => partsOfChapter(material, outline!, index, timeoutMs)));
      let planned = false;
      settled.forEach((result, position) => {
        if (result.status !== 'fulfilled') return;
        outline!.chapters![wave[position]!]!.parts = result.value;
        planned = true;
      });
      waves += 1;
      if (planned && !(await save({ outline }))) return;
      const refused = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (refused) throw refused.reason;
    }

    for (;;) {
      const pending = sections.flatMap((text, index) => (text ? [] : [index]));
      if (pending.length === 0) break;
      if (outOfTime()) return await handOver();
      const wave = pending.slice(0, SECTION_CONCURRENCY);
      const timeoutMs = waveTimeout();
      /*
        Chaque partie écrite est gardée, même quand une autre de la même vague est refusée : une
        seule réponse perdue faisait jeter les quatre autres, déjà payées au rédacteur, et sur une
        centaine de parties cela finissait par épuiser les essais.
      */
      const settled = await Promise.allSettled(wave.map((index) => writeSection(material, outline!, index, timeoutMs)));
      let wrote = false;
      settled.forEach((result, position) => {
        if (result.status !== 'fulfilled') return;
        sections[wave[position]!] = result.value;
        wrote = true;
      });
      waves += 1;
      if (wrote && !(await save({ sections }))) return;
      const refused = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (refused) throw refused.reason;
    }

    const { title, markdown } = finalizeDocument(assemble(outline, sections as string[]), sourceIdsOf(report), fallbackTitleOf(report));
    await complete(reportId, startedAt, title, markdown, env.PERPLEXITY_WRITER);
  } catch (error) {
    // Refus passager : la rédaction garde sa place et ses parties, et reprendra seule.
    if (error instanceof AppError && TRANSIENT.test(error.code)) {
      const scheduled = await scheduleRetry(reportId, startedAt, error.code).catch(() => false);
      if (scheduled) {
        more = true;
        return;
      }
    }
    await failDocument(reportId, error).catch((failure: unknown) => console.error(`[${SERVICE.log}] échec non enregistré`, failure));
  } finally {
    running.delete(reportId);
    // Hors hébergement sans serveur et sans déclencheur, c'est le suivi de l'écran qui relance.
    if (more) await chainNext(reportId);
  }
}

/** Fin de la rédaction : contrôle de conformité, puis rapport proposé à la lecture. */
async function complete(reportId: string, startedAt: Date, title: string, markdown: string, model: string | null): Promise<void> {
  const verdict = await checkText(markdown);
  await getDb()
    .update(reportDocuments)
    .set({
      status: 'ready',
      title,
      markdown,
      compliance: verdict as unknown as Record<string, unknown>,
      model,
      errorCode: null,
      errorMessage: null,
      outline: null,
      sections: null,
      leaseUntil: null,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(sameWriting(reportId, startedAt));
}

/** Programme le prochain essai ; false quand les essais sont épuisés. */
async function scheduleRetry(reportId: string, startedAt: Date, code: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db.select({ retryCount: reportDocuments.retryCount }).from(reportDocuments).where(eq(reportDocuments.reportId, reportId)).limit(1);
  if (!row || row.retryCount >= RETRY_WAITS_MS.length) return false;
  const [updated] = await db
    .update(reportDocuments)
    .set({ retryCount: row.retryCount + 1, retryAfter: new Date(Date.now() + RETRY_WAITS_MS[row.retryCount]!), leaseUntil: null, errorCode: code })
    .where(sameWriting(reportId, startedAt))
    .returning({ reportId: reportDocuments.reportId });
  if (updated) console.warn(`[${SERVICE.log}] ${reportId} : refus passager (${code}), essai ${row.retryCount + 2} programmé`);
  return Boolean(updated);
}

/**
 * Réserve le passage suivant : nouvel essai arrivé à échéance, passage précédent terminé
 * (réservation libérée) ou perdu (réservation expirée). Un seul demandeur l'obtient ; null sinon.
 *
 * Un passage perdu — coupé sans avoir rendu la main — compte comme un essai : plusieurs à la suite,
 * sans rien d'écrit entre-temps, et la rédaction est abandonnée, points rendus. C'est la seule
 * limite : une rédaction que personne ne suit n'est jamais abandonnée pour autant, elle attend
 * simplement d'être reprise (par l'enchaînement, par la veille du serveur ou par son auteur).
 */
async function claim(row: DocumentRow): Promise<DocumentRow | null> {
  if (row.status !== 'writing') return null;
  const now = new Date();
  const due = row.retryAfter ? row.retryAfter.getTime() <= now.getTime() : !row.leaseUntil || row.leaseUntil.getTime() < now.getTime();
  if (!due) return null;
  const lost = !row.retryAfter && Boolean(row.leaseUntil);
  if (lost && row.retryCount >= RETRY_WAITS_MS.length) {
    await failDocument(row.reportId, new AppError(504, 'La rédaction du rapport n’a pas pu aboutir. Vos points ont été rendus.', 'REPORT_TIMEOUT'));
    return null;
  }
  const [claimed] = await getDb()
    .update(reportDocuments)
    .set({ retryAfter: null, leaseUntil: new Date(now.getTime() + LEASE_MS), ...(lost ? { retryCount: row.retryCount + 1 } : {}) })
    .where(
      and(
        eq(reportDocuments.reportId, row.reportId),
        eq(reportDocuments.status, 'writing'),
        eq(reportDocuments.startedAt, row.startedAt),
        row.retryAfter ? eq(reportDocuments.retryAfter, row.retryAfter) : isNull(reportDocuments.retryAfter),
        row.leaseUntil && !row.retryAfter ? eq(reportDocuments.leaseUntil, row.leaseUntil) : row.retryAfter ? undefined : isNull(reportDocuments.leaseUntil),
      ),
    )
    .returning();
  return claimed ?? null;
}

/** Passage suivant, réclamé par le suivi de l'écran : lancé en arrière-plan s'il est obtenu. */
async function claimNextSlice(row: DocumentRow): Promise<DocumentRow> {
  const claimed = await claim(row);
  if (!claimed) {
    // La réservation a pu échouer parce que la rédaction vient d'être abandonnée : on rend son état réel.
    if (row.status !== 'writing') return row;
    const [current] = await getDb().select().from(reportDocuments).where(eq(reportDocuments.reportId, row.reportId)).limit(1);
    return current ?? row;
  }
  runInBackground(() => runSlice(claimed.reportId, claimed.startedAt, todayLabel(new Date())), `rapport rédigé ${claimed.reportId}`);
  return claimed;
}

/**
 * Passage demandé par le site lui-même (enchaînement) : répond tout de suite, travaille ensuite.
 * Un nouvel essai programmé à courte échéance est attendu ici, plutôt que de repartir bredouille.
 */
export function continueReportInBackground(reportId: string): void {
  runInBackground(async () => {
    const db = getDb();
    let [row] = await db.select().from(reportDocuments).where(eq(reportDocuments.reportId, reportId)).limit(1);
    if (!row || row.status !== 'writing') return;
    const wait = (row.retryAfter?.getTime() ?? 0) - Date.now();
    if (wait > 0 && wait <= PAUSE_WAIT_MS) {
      await sleep(wait + 500);
      [row] = await db.select().from(reportDocuments).where(eq(reportDocuments.reportId, reportId)).limit(1);
      if (!row) return;
    }
    const claimed = await claim(row);
    if (claimed) await runSlice(claimed.reportId, claimed.startedAt, todayLabel(new Date()));
  }, `passage enchaîné du rapport ${reportId}`);
}

/**
 * Rédactions restées en chemin — enchaînement non parti, essai programmé que personne n'est venu
 * réclamer : elles repartent sans attendre leur auteur. Appelé par les passages programmés du
 * serveur. Rend le nombre de rédactions en cours.
 */
export async function resumeReportDocuments(): Promise<number> {
  const writing = await getDb().select().from(reportDocuments).where(eq(reportDocuments.status, 'writing'));
  for (const row of writing) {
    if (isServerless) await chainNext(row.reportId);
    else await claimNextSlice(row);
  }
  return writing.length;
}

/** Rapport rédigé d'une analyse, ou null s'il n'a jamais été demandé. */
export async function getReportDocument(auth: RequestAuth, reportId: string | undefined): Promise<ReportDocument | null> {
  const owned = await ownedReport(auth, reportId);
  const [row] = await getDb().select().from(reportDocuments).where(eq(reportDocuments.reportId, owned.id)).limit(1);
  if (!row) return null;
  return viewOf(await claimNextSlice(row), owned.report);
}

/**
 * Lance la rédaction (ou la réécriture) du rapport. Une rédaction déjà en cours est renvoyée
 * telle quelle, sans nouveau débit.
 */
export async function startReportDocument(
  auth: RequestAuth,
  reportId: string | undefined,
  today: string,
  requestedPages: number = REPORT_PAGES.default,
): Promise<{ document: ReportDocument; created: boolean }> {
  const pages = Math.min(REPORT_PAGES.max, Math.max(REPORT_PAGES.min, Math.round(requestedPages)));
  const owned = await ownedReport(auth, reportId);
  if (!providers.webSearch) {
    throw new AppError(503, 'La rédaction des rapports n’est pas branchée sur ce serveur : l’administrateur doit la configurer. Aucun point n’a été retiré.', 'REPORT_NOT_CONFIGURED');
  }
  if ((owned.report.groundingSources ?? []).length === 0) {
    throw new AppError(409, 'Cette analyse ne s’appuie sur aucune source : il n’y a pas matière à un rapport. Relancez l’analyse de la niche.', 'REPORT_NO_SOURCES');
  }
  // Même plafond que les ebooks : la longueur suit le palier.
  const ceiling = Math.min(REPORT_PAGES.max, effectiveLimits(auth.account).ebookPages);
  if (pages > ceiling) {
    throw new AppError(403, `Votre palier permet des rapports de ${ceiling} pages au plus.`, 'REPORT_PAGES_PLAN', { ceiling });
  }
  ensureReady(['webSearch', 'database']);

  const db = getDb();
  const current = await getReportDocument(auth, owned.id);
  if (current?.status === 'writing') return { document: current, created: false };

  const userId = auth.account.user.id;
  const debit = await debitCredits({
    userId,
    cost: await getActionCost(REPORT_DOCUMENT_ACTION, pages),
    actionId: REPORT_DOCUMENT_ACTION,
    unlimited: auth.account.plan.monthlyCredits === null,
  });

  const startedAt = new Date();
  const fresh = {
    userId,
    status: 'writing',
    markdown: null,
    title: null,
    compliance: null,
    errorCode: null,
    errorMessage: null,
    model: null,
    targetPages: pages,
    retryCount: 0,
    retryAfter: null,
    outline: null,
    sections: null,
    leaseUntil: new Date(startedAt.getTime() + LEASE_MS),
    creditsCharged: debit.charged,
    debitTransactionId: debit.transactionId,
    refunded: false,
    startedAt,
    completedAt: null,
    updatedAt: startedAt,
  };
  const [row] = await db
    .insert(reportDocuments)
    .values({ reportId: owned.id, ...fresh })
    .onConflictDoUpdate({
      target: reportDocuments.reportId,
      set: fresh,
      // Deux clics simultanés : un seul lance la rédaction, l'autre rend ses points.
      setWhere: ne(reportDocuments.status, 'writing'),
    })
    .returning();

  if (!row) {
    await refundDebit({ debitTransactionId: debit.transactionId, generationId: null, note: 'Rapport déjà en cours de rédaction : points rendus.' });
    const concurrent = await getReportDocument(auth, owned.id);
    if (concurrent) return { document: concurrent, created: false };
    throw new AppError(409, 'Le rapport est déjà en cours de rédaction.', 'REPORT_BUSY');
  }

  runInBackground(() => runSlice(owned.id, startedAt, today), `rapport rédigé ${owned.id}`);
  return { document: viewOf(row, owned.report), created: true };
}
