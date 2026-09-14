/**
 * Boucle de performance — Lot 6 : règle d'agrégation.
 *
 * Le cahier des charges impose une participation opt-in et une agrégation
 * minimale de 5 vendeurs. La règle est codée ici, indépendamment du stockage qui
 * n'existe pas encore : quand la collecte arrivera, elle ne pourra publier que ce
 * que cette fonction autorise.
 *
 * Garde-fous :
 *  - seuls les vendeurs consentants sont lus : une seule ligne sans consentement
 *    écarte toutes les lignes du vendeur (un retrait de consentement l'emporte
 *    sur l'historique) ;
 *  - un vendeur compte pour un, quel que soit son nombre de lignes : ses valeurs
 *    sont d'abord ramenées à sa moyenne, puis on prend la médiane entre vendeurs.
 *    Un gros vendeur ne pèse pas plus qu'un petit, et une valeur extrême ne
 *    déplace pas le repère ;
 *  - un groupe de moins de 5 vendeurs n'est pas publié, pas plus qu'une mesure
 *    fournie par moins de 5 vendeurs d'un groupe publié. Pour les groupes écartés,
 *    on ne publie ni les valeurs ni le nombre de vendeurs : annoncer « 4 vendeurs »
 *    dans une niche rare peut déjà désigner des concurrents précis.
 */

export const MIN_SELLERS_PER_GROUP = 5;

export interface PerformanceContribution {
  sellerId: string;
  /** Consentement explicite du vendeur à contribuer aux repères partagés. */
  optedIn: boolean;
  niche: string;
  market: string;
  /** Mesures numériques, par exemple { conversionRatePercent: 2.1 }. */
  metrics: Record<string, number>;
}

export interface BenchmarkGroup {
  niche: string;
  market: string;
  sellerCount: number;
  /** Médiane entre vendeurs, pour chaque mesure fournie par au moins 5 d'entre eux. */
  medians: Record<string, number>;
}

export interface BenchmarkResult {
  groups: BenchmarkGroup[];
  /** Nombre de groupes écartés, sans aucun détail sur leur contenu. */
  suppressedGroups: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function aggregateBenchmarks(contributions: PerformanceContribution[]): BenchmarkResult {
  /** Clé de groupe → vendeur → mesure → valeurs. */
  const groups = new Map<string, { niche: string; market: string; sellers: Map<string, Map<string, number[]>> }>();

  const withdrawnSellers = new Set(
    contributions.filter((contribution) => !contribution.optedIn).map((contribution) => contribution.sellerId),
  );

  for (const contribution of contributions) {
    if (withdrawnSellers.has(contribution.sellerId)) continue;

    const key = `${contribution.niche.trim().toLowerCase()}::${contribution.market}`;
    let group = groups.get(key);
    if (!group) {
      group = { niche: contribution.niche.trim(), market: contribution.market, sellers: new Map() };
      groups.set(key, group);
    }

    let seller = group.sellers.get(contribution.sellerId);
    if (!seller) {
      seller = new Map();
      group.sellers.set(contribution.sellerId, seller);
    }

    for (const [metric, value] of Object.entries(contribution.metrics)) {
      if (!Number.isFinite(value)) continue;
      seller.set(metric, [...(seller.get(metric) ?? []), value]);
    }
  }

  const published: BenchmarkGroup[] = [];
  let suppressedGroups = 0;

  for (const group of groups.values()) {
    if (group.sellers.size < MIN_SELLERS_PER_GROUP) {
      suppressedGroups += 1;
      continue;
    }

    const sellerAveragesByMetric = new Map<string, number[]>();
    for (const sellerMetrics of group.sellers.values()) {
      for (const [metric, values] of sellerMetrics) {
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        sellerAveragesByMetric.set(metric, [...(sellerAveragesByMetric.get(metric) ?? []), average]);
      }
    }

    const medians: Record<string, number> = {};
    for (const [metric, averages] of sellerAveragesByMetric) {
      if (averages.length >= MIN_SELLERS_PER_GROUP) {
        medians[metric] = Math.round(median(averages) * 100) / 100;
      }
    }

    if (Object.keys(medians).length === 0) {
      suppressedGroups += 1;
      continue;
    }

    published.push({ niche: group.niche, market: group.market, sellerCount: group.sellers.size, medians });
  }

  return { groups: published, suppressedGroups };
}
