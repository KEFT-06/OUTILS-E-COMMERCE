import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { watchItems, watches } from '@server/db/schema';

/**
 * Ce que le radar sait, et que l'analyse stratégique ne peut qu'apprécier.
 *
 * Les cinq taux d'un rapport sont aujourd'hui en `basis: 'assessment'` : une appréciation
 * de l'IA tirée de sources web. Ce fichier produit des CHIFFRES, comptés sur les boutiques
 * réellement surveillées — pas une opinion.
 *
 * Deux règles que rien ne doit assouplir :
 *
 *  1. Ces mesures ne sont JAMAIS écrites dans un rapport. Un rapport est un document daté,
 *     sans `updatedAt`, exporté en PDF : y injecter des chiffres qui bougent chaque nuit
 *     rendrait tout export invérifiable. L'écran d'analyse les affiche À CÔTÉ du rapport,
 *     avec leur date de relevé.
 *
 *  2. Elles ne portent que sur ce qui a été observé. Le radar n'a rien vu avant son
 *     premier passage : les ventes mesurées sont celles faites PENDANT la surveillance,
 *     et la période est toujours annoncée avec le chiffre.
 */

export interface RadarMeasurements {
  /** Boutiques actives sous surveillance. Zéro : rien à mesurer, l'écran n'affiche pas le panneau. */
  stores: number;
  /** Jours depuis la plus ancienne surveillance : la profondeur de l'observation. */
  observedDays: number;
  /** Offres en vente en ce moment chez les boutiques suivies : la saturation, comptée. */
  liveOffers: number;
  /** Offres retirées depuis le début de la surveillance. */
  endedOffers: number;
  /** Ventes constatées pendant la surveillance, par devise — jamais converties. */
  salesByCurrency: { currency: string; units: number; revenue: number }[];
  /** Ventes par jour, toutes boutiques confondues. null : pas encore assez de recul. */
  salesPerDay: number | null;
  /** Prix médian des offres en vente, par devise. */
  medianPriceByCurrency: { currency: string; price: number }[];
  /** Date du dernier relevé. null : aucun relevé encore abouti. */
  lastSweptAt: string | null;
}

const EMPTY: RadarMeasurements = {
  stores: 0,
  observedDays: 0,
  liveOffers: 0,
  endedOffers: 0,
  salesByCurrency: [],
  salesPerDay: null,
  medianPriceByCurrency: [],
  lastSweptAt: null,
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!;
}

export async function radarMeasurements(userId: string, now = new Date()): Promise<RadarMeasurements> {
  const surveillances = await getDb()
    .select({ id: watches.id, createdAt: watches.createdAt, lastSweptAt: watches.lastSweptAt })
    .from(watches)
    .where(and(eq(watches.userId, userId), eq(watches.active, true)));

  if (surveillances.length === 0) return EMPTY;

  const ids = surveillances.map((row) => row.id);
  const rows = await getDb()
    .select({
      currency: watchItems.currency,
      priceValue: watchItems.priceValue,
      salesCount: watchItems.salesCount,
      salesAtFirstSeen: watchItems.salesAtFirstSeen,
      ended: sql<boolean>`${watchItems.endedAt} is not null`,
    })
    .from(watchItems)
    .where(inArray(watchItems.watchId, ids));

  const debut = surveillances.reduce((oldest, row) => (row.createdAt < oldest ? row.createdAt : oldest), now);
  const observedDays = Math.max(0, Math.round((now.getTime() - debut.getTime()) / 86_400_000));

  const parDevise = new Map<string, { units: number; revenue: number; prices: number[] }>();
  let liveOffers = 0;
  let endedOffers = 0;
  let unitesTotales = 0;

  for (const row of rows) {
    if (row.ended) endedOffers += 1;
    else liveOffers += 1;

    const devise = row.currency ?? '—';
    const bucket = parDevise.get(devise) ?? { units: 0, revenue: 0, prices: [] };

    // Ventes faites pendant la surveillance, jamais le compteur total du concurrent :
    // celui-ci contient des ventes antérieures que le radar n'a pas vues.
    const gagnees =
      row.salesCount !== null && row.salesAtFirstSeen !== null ? Math.max(0, row.salesCount - row.salesAtFirstSeen) : 0;
    bucket.units += gagnees;
    unitesTotales += gagnees;
    if (row.priceValue !== null) {
      bucket.revenue += gagnees * row.priceValue;
      if (!row.ended) bucket.prices.push(row.priceValue);
    }
    parDevise.set(devise, bucket);
  }

  const salesByCurrency = [...parDevise.entries()]
    .filter(([, bucket]) => bucket.units > 0)
    .map(([currency, bucket]) => ({ currency, units: bucket.units, revenue: bucket.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const medianPriceByCurrency = [...parDevise.entries()]
    .filter(([, bucket]) => bucket.prices.length > 0)
    .map(([currency, bucket]) => ({ currency, price: median(bucket.prices) }))
    .sort((a, b) => b.price - a.price);

  const dernier = surveillances
    .map((row) => row.lastSweptAt)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    stores: surveillances.length,
    observedDays,
    liveOffers,
    endedOffers,
    salesByCurrency,
    // Une vitesse sur moins de deux jours n'est pas une vitesse : on préfère ne rien dire.
    salesPerDay: observedDays >= 2 ? Math.round((unitesTotales / observedDays) * 10) / 10 : null,
    medianPriceByCurrency,
    lastSweptAt: dernier?.toISOString() ?? null,
  };
}
