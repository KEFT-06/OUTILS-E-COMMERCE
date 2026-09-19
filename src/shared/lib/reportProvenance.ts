import type { MarketAnalysisReport } from '@/shared/types/analysis';

/**
 * Provenance d'un rapport en phrases lisibles, pour l'écran, l'aperçu A4 et le PDF : qui a
 * cherché (Perplexity), qui a rédigé (Gemini), combien de pages ont été lues et citées.
 */

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}

/** « Étude approfondie Perplexity : 6 recherches, 77 pages lues, 36 sources citées (1 min 01 s). » */
export function researchLine(report: MarketAnalysisReport): string {
  const generator = report.generator;
  const research = generator?.research;
  if (research?.mode === 'deep_research') {
    return `Étude approfondie Perplexity : ${research.searches} recherches, ${research.pagesConsulted} pages lues, ${research.sourcesCited} sources citées (${durationLabel(research.durationSeconds)}).`;
  }
  if (research) return `Recherche web Perplexity : ${research.sourcesCited} pages retenues.`;
  if (generator?.webSearch) return `Pages trouvées par ${generator.webSearch}.`;
  return 'Aucune recherche web : aucun fait de marché n’a été étudié.';
}

/** « Rédaction : Gemini (gemini-3.5-flash), le 17 septembre 2026. » */
export function writerLine(report: MarketAnalysisReport): string | null {
  const generator = report.generator;
  if (!generator) return null;
  return `Rédaction : ${generator.provider} (${generator.model}), le ${report.dateCreated}.`;
}

/** Provenance de chaque bloc, dans l'ordre du rapport. */
export function blockProvenance(report: MarketAnalysisReport): { label: string; source: string }[] {
  const provenance = report.dataProvenance ?? {};
  const blocks = [
    ['Les cinq taux', provenance.rates],
    ['Concurrents', provenance.competitors],
    ['Mots-clés', provenance.searchTrends],
    ['Idées de produits', provenance.digitalProducts],
    ['Scripts publicitaires', provenance.adCampaigns],
    ['Plan d’action', provenance.strategicActionPlan],
  ] as const;
  return blocks.flatMap(([label, entry]) => (entry ? [{ label, source: entry.source }] : []));
}
