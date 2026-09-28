import { and, eq, lt, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { reportDocuments, reports } from '@server/db/schema';
import { providers } from '@server/env';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { debitCredits, refundDebit } from '@server/services/accounts';
import { generateTextWithPerplexity } from '@server/services/ai/perplexity';
import { checkText } from '@server/services/compliance';
import { getActionCost } from '@server/services/credits';
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
import { neutralizeMessage } from '@server/shared/whiteLabel';

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
/** Sous les 300 s accordés à une fonction : la rédaction doit finir dans la même instance. */
const WRITE_TIMEOUT_MS = 240_000;
/** Au-delà, une rédaction restée « en cours » est abandonnée (instance coupée) et remboursée. */
const DOCUMENT_DEADLINE_MS = 6 * 60_000;
const MIN_CHARS = 1_200;
const MAX_MEMO_CHARS = 30_000;

type DocumentRow = typeof reportDocuments.$inferSelect;

const reportIdSchema = z.string().uuid();
const reportNotFound = () => new AppError(404, 'Rapport introuvable sur votre compte.', 'REPORT_NOT_FOUND');

/* -------------------------------------------------------------------------- */
/*  Consigne et matière transmises au rédacteur                                */
/* -------------------------------------------------------------------------- */

const INSTRUCTIONS = [
  'Tu es un analyste e-commerce senior, spécialiste de la vente de produits digitaux (ebooks, formations, modèles, outils).',
  'Tu rédiges en français un rapport d’étude de marché pour un créateur qui décide s’il se lance sur cette niche, et comment.',
  '',
  'Plan : tu le choisis librement, selon ce que la matière rend le plus utile. Aucun plan n’est imposé ; donne à chaque partie un titre parlant plutôt qu’un intitulé générique.',
  '',
  'Règles impératives :',
  '1. Format Markdown : un titre principal (# …), des parties (## …), au besoin des sous-parties (### …). Des paragraphes rédigés ; des listes quand elles aident ; un tableau seulement pour comparer des offres.',
  '2. Aucun taux : pas de score, de note sur 100, de pourcentage ni de niveau (faible, moyen, élevé…) attribué à la demande, la saturation, la rentabilité, l’opportunité ou la viralité.',
  '3. Chaque fait (chiffre, prix, concurrent, tendance, citation) vient des sources fournies et porte son renvoi entre crochets, au numéro de la source : [2], ou [1][4]. N’invente ni chiffre, ni concurrent, ni source.',
  '4. Ce que les sources n’établissent pas est présenté comme une recommandation ou une hypothèse, en le disant clairement, avec la façon de le vérifier.',
  '5. N’écris pas de bibliographie, de liste de sources ni d’annexe de références : elle est ajoutée automatiquement à la fin.',
  '6. Ne nomme aucun outil d’analyse, moteur de recherche ni intelligence artificielle, et ne parle pas de toi.',
  '7. Entre 1 800 et 3 000 mots. Termine par des recommandations concrètes et datées dans le temps (semaines, mois).',
].join('\n');

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
}): string {
  const { report } = input;
  const market = report.market ? countryName(report.market) : null;
  const sources = report.groundingSources ?? [];
  const out: string[] = [
    `Niche étudiée : « ${report.nicheName} » (recherche de l’utilisateur : « ${line(report.query)} »).`,
    `Marché visé : ${market ?? 'tous marchés francophones'}. Date du rapport : ${input.today}.`,
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

  out.push('', 'Rédige maintenant le rapport complet, selon les règles.');
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
  };
}

/** Échec enregistré une seule fois, avec remboursement dans la même transaction. */
async function failDocument(reportId: string, error: unknown): Promise<void> {
  const known = error instanceof AppError;
  const code = known ? error.code : 'REPORT_FAILED';
  const message = neutralizeMessage(known ? error.message : 'La rédaction du rapport a échoué sur le serveur. Réessayez : vos points ont été rendus.');
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

async function writeDocument(reportId: string, startedAt: Date, today: string): Promise<void> {
  const db = getDb();
  try {
    const [row] = await db
      .select({ report: reports.report, memo: reports.researchMemo })
      .from(reports)
      .where(eq(reports.id, reportId))
      .limit(1);
    if (!row) return;
    const report = row.report as unknown as MarketAnalysisReport;
    const sourceIds = new Set((report.groundingSources ?? []).flatMap((source) => (typeof source.id === 'number' ? [source.id] : [])));

    const { text, model } = await generateTextWithPerplexity({
      service: SERVICE,
      instructions: INSTRUCTIONS,
      prompt: buildDocumentPrompt({ report, memo: row.memo, today }),
      maxOutputTokens: 9_000,
      minChars: MIN_CHARS,
      timeoutMs: WRITE_TIMEOUT_MS,
    });

    const { title, markdown } = finalizeDocument(text, sourceIds, `Rapport d’étude de marché : ${report.nicheName}`);
    const verdict = await checkText(markdown);

    await db
      .update(reportDocuments)
      .set({
        status: 'ready',
        title,
        markdown,
        compliance: verdict as unknown as Record<string, unknown>,
        model,
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      // Une réécriture lancée entre-temps garde la main : ce texte-là est périmé.
      .where(and(eq(reportDocuments.reportId, reportId), eq(reportDocuments.status, 'writing'), eq(reportDocuments.startedAt, startedAt)));
  } catch (error) {
    await failDocument(reportId, error).catch((failure: unknown) => console.error(`[${SERVICE.log}] échec non enregistré`, failure));
  }
}

/** Rapport rédigé d'une analyse, ou null s'il n'a jamais été demandé. */
export async function getReportDocument(auth: RequestAuth, reportId: string | undefined): Promise<ReportDocument | null> {
  const owned = await ownedReport(auth, reportId);
  const db = getDb();
  let [row] = await db.select().from(reportDocuments).where(eq(reportDocuments.reportId, owned.id)).limit(1);
  if (!row) return null;

  // Instance coupée en pleine rédaction : le suivi constate l'abandon et rend les points.
  if (row.status === 'writing' && Date.now() - row.startedAt.getTime() > DOCUMENT_DEADLINE_MS) {
    await failDocument(
      owned.id,
      new AppError(504, 'La rédaction du rapport a pris trop de temps. Relancez-la : vos points ont été rendus.', 'REPORT_TIMEOUT'),
    );
    [row] = await db.select().from(reportDocuments).where(eq(reportDocuments.reportId, owned.id)).limit(1);
    if (!row) return null;
  }
  return viewOf(row, owned.report);
}

/**
 * Lance la rédaction (ou la réécriture) du rapport. Une rédaction déjà en cours est renvoyée
 * telle quelle, sans nouveau débit.
 */
export async function startReportDocument(auth: RequestAuth, reportId: string | undefined, today: string): Promise<{ document: ReportDocument; created: boolean }> {
  const owned = await ownedReport(auth, reportId);
  if (!providers.webSearch) {
    throw new AppError(503, 'La rédaction des rapports n’est pas branchée sur ce serveur : l’administrateur doit la configurer. Aucun point n’a été retiré.', 'REPORT_NOT_CONFIGURED');
  }
  if ((owned.report.groundingSources ?? []).length === 0) {
    throw new AppError(409, 'Cette analyse ne s’appuie sur aucune source : il n’y a pas matière à un rapport. Relancez l’analyse de la niche.', 'REPORT_NO_SOURCES');
  }
  ensureReady(['webSearch', 'database']);

  const db = getDb();
  const current = await getReportDocument(auth, owned.id);
  if (current?.status === 'writing') return { document: current, created: false };

  const userId = auth.account.user.id;
  const debit = await debitCredits({
    userId,
    cost: await getActionCost(REPORT_DOCUMENT_ACTION),
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
    creditsCharged: debit.charged,
    debitTransactionId: debit.transactionId,
    refunded: false,
    startedAt,
    completedAt: null,
    updatedAt: startedAt,
  };
  const stale = new Date(startedAt.getTime() - DOCUMENT_DEADLINE_MS);
  const [row] = await db
    .insert(reportDocuments)
    .values({ reportId: owned.id, ...fresh })
    .onConflictDoUpdate({
      target: reportDocuments.reportId,
      set: fresh,
      // Deux clics simultanés : un seul lance la rédaction, l'autre rend ses points.
      setWhere: or(ne(reportDocuments.status, 'writing'), lt(reportDocuments.startedAt, stale)),
    })
    .returning();

  if (!row) {
    await refundDebit({ debitTransactionId: debit.transactionId, generationId: null, note: 'Rapport déjà en cours de rédaction : points rendus.' });
    const concurrent = await getReportDocument(auth, owned.id);
    if (concurrent) return { document: concurrent, created: false };
    throw new AppError(409, 'Le rapport est déjà en cours de rédaction.', 'REPORT_BUSY');
  }

  runInBackground(() => writeDocument(owned.id, startedAt, today), `rapport rédigé ${owned.id}`);
  return { document: viewOf(row, owned.report), created: true };
}
