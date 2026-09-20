import { z } from 'zod';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { getReport } from '@server/services/analysis';
import { EBOOK_PAGES_CEILING } from '@server/services/plans';
import { type EbookJobView, startEbook } from '@server/services/writing/ebookJobs';
import { countryName } from '@server/shared/countries';

/**
 * Dossier stratégique : développe une analyse de niche en un document long.
 *
 * Le rapport d'analyse tient en quelques pages parce qu'il ne dit que ce que les sources
 * établissent. Un dossier de cent pages ne peut pas contenir dix fois plus de faits — il
 * n'y en a pas dix fois plus. Ce qu'il apporte, c'est le déploiement : lecture détaillée
 * de chaque constat, options ouvertes, méthode de mise en œuvre, suivi.
 *
 * D'où la règle qui gouverne ce module : les faits viennent du rapport enregistré sur le
 * serveur, jamais de ce que le navigateur envoie. Le reste est présenté comme du
 * raisonnement, et le texte doit le dire.
 */

/** Au-delà, un dossier de marché se répète : il n'y a pas la matière pour aller plus loin. */
export const MARKET_REPORT_PAGES_CEILING = 100;

export const marketReportRequestSchema = z.object({
  reportId: z.string().uuid(),
  targetPages: z.number().int().min(5).max(MARKET_REPORT_PAGES_CEILING),
});

export type MarketReportRequest = z.infer<typeof marketReportRequestSchema>;

/**
 * Met la matière du rapport en texte, pour la consigne de rédaction.
 *
 * Chaque bloc est annoncé pour ce qu'il est : un taux mesuré, un concurrent relevé dans
 * une source, une idée proposée. La rédaction sait ainsi ce qu'elle peut affirmer et ce
 * qu'elle doit présenter comme une proposition.
 */
export function findingsOf(report: {
  nicheName: string;
  market: string | null;
  executiveSummary?: string;
  overallVerdict?: string;
  rates?: Record<string, { label?: string; level?: string; score?: number | null; rationale?: string } | undefined>;
  competitors?: { name: string; strengths?: string[]; weaknesses?: string[]; positioning?: string }[];
  searchTrends?: { keyword: string; volume?: string | null; intent?: string }[];
  digitalProducts?: { title: string; typeName?: string; recommendedPrice?: number | null; currency?: string; targetAudience?: string }[];
  strategicActionPlan?: { title: string; steps: string[] }[];
  groundingSources?: { title: string; url: string }[];
  limitations?: string[];
}): string {
  const lines: string[] = [];

  lines.push(`Niche : ${report.nicheName}`);
  if (report.market) lines.push(`Marché : ${countryName(report.market)}`);
  if (report.executiveSummary) lines.push('', 'Synthèse de l’étude :', report.executiveSummary);
  if (report.overallVerdict) lines.push('', `Verdict d’ensemble : ${report.overallVerdict}`);

  const rates = Object.values(report.rates ?? {}).filter(Boolean);
  if (rates.length > 0) {
    lines.push('', 'Taux mesurés par l’étude :');
    for (const rate of rates) {
      const score = rate!.score === null || rate!.score === undefined ? '' : ` (${rate!.score}/100)`;
      lines.push(`- ${rate!.label ?? 'taux'} : ${rate!.level ?? 'non qualifié'}${score}${rate!.rationale ? ` — ${rate!.rationale}` : ''}`);
    }
  }

  if (report.competitors?.length) {
    lines.push('', 'Concurrents relevés dans les sources :');
    for (const competitor of report.competitors) {
      lines.push(
        `- ${competitor.name}${competitor.positioning ? ` — ${competitor.positioning}` : ''}` +
          `${competitor.strengths?.length ? ` | forces : ${competitor.strengths.join(', ')}` : ''}` +
          `${competitor.weaknesses?.length ? ` | faiblesses : ${competitor.weaknesses.join(', ')}` : ''}`,
      );
    }
  }

  if (report.searchTrends?.length) {
    lines.push('', 'Expressions de recherche relevées :');
    for (const trend of report.searchTrends) {
      lines.push(`- ${trend.keyword}${trend.volume ? ` (${trend.volume})` : ' (volume non mesuré)'}${trend.intent ? ` — intention : ${trend.intent}` : ''}`);
    }
  }

  if (report.digitalProducts?.length) {
    lines.push('', 'Produits proposés par l’analyse (propositions, pas des faits) :');
    for (const product of report.digitalProducts) {
      const price = product.recommendedPrice ? `${product.recommendedPrice} ${product.currency ?? ''}`.trim() : 'prix non établi';
      lines.push(`- ${product.title}${product.typeName ? ` (${product.typeName})` : ''} — ${price}${product.targetAudience ? ` — pour : ${product.targetAudience}` : ''}`);
    }
  }

  if (report.strategicActionPlan?.length) {
    lines.push('', 'Plan d’action proposé :');
    for (const phase of report.strategicActionPlan) {
      lines.push(`- ${phase.title} : ${phase.steps.join(' ; ')}`);
    }
  }

  if (report.limitations?.length) {
    lines.push('', 'Limites reconnues de l’étude (à rappeler dans le dossier) :');
    for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  }

  if (report.groundingSources?.length) {
    lines.push('', 'Sources citées :');
    for (const source of report.groundingSources.slice(0, 40)) lines.push(`- ${source.title} — ${source.url}`);
  }

  return lines.join('\n');
}

export async function startMarketReport(auth: RequestAuth, request: MarketReportRequest): Promise<{ job: EbookJobView; created: boolean }> {
  // Le rapport est relu sur le serveur : c'est lui qui fait foi, pas ce que le navigateur envoie.
  const report = await getReport(auth, request.reportId);

  const allowed = Math.min(auth.account.plan.limits.ebookPages, MARKET_REPORT_PAGES_CEILING, EBOOK_PAGES_CEILING);
  if (request.targetPages > allowed) {
    throw new AppError(
      403,
      `Un dossier de marché va jusqu’à ${allowed} pages avec votre palier. Choisissez une longueur inférieure. Aucun point n’a été retiré.`,
      'EBOOK_PAGES_OVER_PLAN',
      { allowed, requested: request.targetPages },
    );
  }

  return startEbook(auth, {
    kind: 'market_report',
    productId: request.reportId,
    title: `Dossier stratégique — ${report.nicheName}`,
    subtitle: report.market ? `Marché : ${countryName(report.market)}` : '',
    typeName: 'Dossier stratégique',
    targetAudience: 'Porteur de projet qui décide s’il se lance sur cette niche',
    transformationPromise: 'Décider en connaissance de cause, et savoir par quoi commencer',
    chapters: [],
    market: report.market ?? null,
    targetPages: request.targetPages,
    findings: findingsOf(report as never),
  });
}
