import type { MarketAnalysisReport } from '@/shared/types/analysis';

/**
 * Ce que chaque source fonde dans le rapport.
 *
 * Les numéros de source ne sont plus semés dans le texte : ils coupaient la lecture et
 * n'apprenaient rien sans aller voir la liste. Le lien reste pourtant nécessaire — un
 * rapport dont on ne peut pas remonter les faits ne vaut rien. Il est donc renversé :
 * l'onglet Sources dit, pour chaque page, quels passages du rapport s'appuient sur elle.
 */
export function usageBySource(report: MarketAnalysisReport): Map<number, string[]> {
  const usage = new Map<number, string[]>();

  const attribute = (ids: readonly number[] | undefined, label: string) => {
    for (const id of ids ?? []) {
      const existing = usage.get(id);
      if (!existing) usage.set(id, [label]);
      else if (!existing.includes(label)) existing.push(label);
    }
  };

  attribute(report.summarySourceIds, 'Synthèse');
  for (const rate of Object.values(report.rates)) {
    if (rate) attribute(rate.sourceIds, rate.label);
  }
  for (const competitor of report.competitors) {
    attribute(competitor.sourceIds, competitor.name || 'Concurrence');
  }

  return usage;
}
