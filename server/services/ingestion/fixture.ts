import {
  AdIngestionAdapter,
  IngestedAd,
  IngestionQuery,
  IngestionResult,
  deriveSignals,
} from '@server/services/ingestion/types';

/**
 * Adaptateur de démonstration — sert à exercer le pipeline sans accès Meta.
 *
 * Trois garde-fous, parce qu'un générateur de fausses publicités est exactement
 * le genre d'outil qui finit par alimenter une capture d'écran commerciale :
 *
 *  1. Il ne s'active que sur `AD_INGESTION_ADAPTER=fixture`, jamais par défaut.
 *  2. Tout ce qu'il produit porte `isDemonstration: true`, étiquette transportée
 *     jusque sous les graphiques de l'interface.
 *  3. Les noms d'annonceurs sont ouvertement fictifs. Inventer des noms
 *     plausibles aurait produit des captures indiscernables du réel.
 *
 * Les volumes sont déterministes : deux exécutions sur la même niche donnent le
 * même score, sinon le pipeline serait intestable.
 */

/** Générateur déterministe, pour que les scores de démonstration soient stables. */
function seededRandom(seed: number): () => number {
  let state = seed % 2_147_483_647;
  if (state <= 0) state += 2_147_483_646;
  return () => {
    state = (state * 16_807) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export const fixtureAdapter: AdIngestionAdapter = {
  id: 'fixture',
  label: 'Jeu de démonstration Smart Creator',

  isAvailable() {
    return { available: true };
  },

  async fetchAds(query: IngestionQuery): Promise<IngestionResult> {
    const collectedAt = new Date();
    const random = seededRandom(hashString(query.niche));

    const advertiserCount = 18 + Math.floor(random() * 40);
    const adsPerAdvertiser = 3 + Math.floor(random() * 6);
    const market = query.market ?? 'CI';

    const ads: IngestedAd[] = [];

    for (let a = 0; a < advertiserCount; a += 1) {
      for (let n = 0; n < adsPerAdvertiser; n += 1) {
        const ageDays = Math.floor(random() * 45);
        const startedAt = new Date(collectedAt.getTime() - ageDays * 86_400_000);

        // Une partie des publicités est arrêtée : sans cela, la durée de vie
        // moyenne serait systématiquement surestimée.
        const isStopped = random() < 0.25;
        const stoppedAfter = Math.floor(random() * Math.max(1, ageDays));

        ads.push({
          externalId: `demo-${a}-${n}`,
          advertiserId: `demo-advertiser-${a}`,
          advertiserName: `Annonceur de démonstration ${a + 1}`,
          startedAt: startedAt.toISOString(),
          ...(isStopped
            ? {
                endedAt: new Date(
                  startedAt.getTime() + stoppedAfter * 86_400_000,
                ).toISOString(),
              }
            : {}),
          market,
          creativeBody: `Exemple de texte publicitaire pour « ${query.niche} » (démonstration).`,
        });
      }
    }

    const limited = query.limit ? ads.slice(0, query.limit) : ads;

    return {
      ads: limited,
      signals: deriveSignals(limited, collectedAt),
      sourceLabel: 'Jeu de démonstration Smart Creator',
      collectedAt: collectedAt.toISOString(),
      isDemonstration: true,
    };
  },
};
