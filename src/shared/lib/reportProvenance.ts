import type { MarketAnalysisReport } from '@/shared/types/analysis';

/**
 * Provenance d'un rapport en phrases lisibles, pour l'écran, l'aperçu A4 et le PDF :
 * l'ampleur de l'étude menée, la date de rédaction, le nombre de pages lues et citées.
 *
 * Ce qui compte pour le lecteur, c'est l'effort de recherche et la traçabilité des
 * sources — pas le nom des moteurs employés, qui n'est jamais affiché et peut changer
 * d'une version à l'autre sans rien modifier au rapport.
 */

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}

/** « Étude approfondie : 6 recherches, 77 pages lues, 36 sources citées (1 min 01 s). » */
export function researchLine(report: MarketAnalysisReport): string {
  const research = report.generator?.research;
  if (research?.mode === 'deep_research') {
    return `Étude approfondie : ${research.searches} recherches, ${research.pagesConsulted} pages lues, ${research.sourcesCited} sources citées (${durationLabel(research.durationSeconds)}).`;
  }
  if (research) return `Recherche web : ${research.sourcesCited} pages retenues.`;
  return 'Aucune recherche web : aucun fait de marché n’a été étudié.';
}

/** « Rapport rédigé le 17 septembre 2026. » */
export function writerLine(report: MarketAnalysisReport): string | null {
  if (!report.generator) return null;
  return `Rapport rédigé le ${report.dateCreated}.`;
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
