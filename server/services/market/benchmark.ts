import { and, count, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { nicheBenchmarks } from '@server/db/schema';
import { env, providers } from '@server/env';
import { AppError } from '@server/middleware';

/**
 * Référence marché d'une niche : combien de produits numériques existent déjà, depuis quand,
 * à quel prix, et combien d'avis ils ont accumulés. Mesuré sur Gumroad.
 *
 * CE QUE CETTE SOURCE MESURE, ET CE QU'ELLE NE MESURE PAS. Établi par une sonde de 25 produits
 * le 22/09/2026, pas déduit de la documentation :
 *
 *   ✓ prix, devise, type, nombre d'avis, DATE DE CRÉATION : renseignés à 100 %. La date de
 *     création est précisément ce que la vitrine Chariow ne donne pas — ici l'ancienneté d'un
 *     produit est connue dès le premier relevé, sans avoir à observer pendant des semaines.
 *
 *   ✗ nombre de ventes : 28 % seulement. Le vendeur peut le masquer.
 *
 *   ✗ estimer les ventes à partir des avis : IMPOSSIBLE. Le rapport mesuré va de 8 à 40 ventes
 *     par avis. Un facteur 5 d'incertitude ne permet pas d'annoncer un chiffre. Les avis servent
 *     donc à CLASSER des produits entre eux, jamais à quantifier l'un d'eux.
 *
 *   ✗ calibrer un prix pour l'Afrique : prix médian relevé 199,99 $, minimum 30 $, contre
 *     4 000 à 12 000 XAF chez les vendeurs africains que le radar observe. Dix à trente fois
 *     l'écart. Cette source valide un CONCEPT et mesure une SATURATION ; le radar mesure les prix.
 *
 * Le cache est MUTUALISÉ : « combien de produits sur cette niche » est la même réponse pour tous
 * les comptes. Un relevé se paie à l'unité, donc il sert à tout le monde et dure un mois.
 */

const TIMEOUT_MS = 240_000;
export const BENCHMARK_SOURCE = 'gumroad';

export interface NicheBenchmark {
  query: string;
  source: string;
  productCount: number;
  medianPrice: number | null;
  currency: string | null;
  medianAgeDays: number | null;
  totalRatings: number;
  /** Produits qui publient leurs ventes. Le reste les masque. */
  salesKnownCount: number;
  medianSales: number | null;
  collectedAt: string;
  /** Jours restants avant péremption de la mesure. */
  freshForDays: number;
}

/** Clé du cache : deux formulations de la même niche ne doivent pas payer deux relevés. */
export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

const produitSchema = z.object({
  price: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  ratingCount: z.number().nullable().optional(),
  salesCount: z.number().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]!);
};

function toView(row: typeof nicheBenchmarks.$inferSelect, now: Date): NicheBenchmark {
  const ageMs = now.getTime() - row.collectedAt.getTime();
  return {
    query: row.query,
    source: row.source,
    productCount: row.productCount,
    medianPrice: row.medianPrice,
    currency: row.currency,
    medianAgeDays: row.medianAgeDays,
    totalRatings: row.totalRatings,
    salesKnownCount: row.salesKnownCount,
    medianSales: row.medianSales,
    collectedAt: row.collectedAt.toISOString(),
    freshForDays: Math.max(0, env.MARKET_BENCHMARK_TTL_DAYS - Math.floor(ageMs / 86_400_000)),
  };
}

/** Mesure en cache, quelle que soit son âge. Gratuite. */
export async function cachedBenchmark(query: string, now = new Date()): Promise<NicheBenchmark | null> {
  const [row] = await getDb()
    .select()
    .from(nicheBenchmarks)
    .where(and(eq(nicheBenchmarks.query, normalizeQuery(query)), eq(nicheBenchmarks.source, BENCHMARK_SOURCE)))
    .limit(1);
  return row ? toView(row, now) : null;
}

/** Relevés neufs déjà faits aujourd'hui, pour tout le serveur : le garde-fou de dépense. */
export async function collectionsToday(now = new Date()): Promise<number> {
  const debut = new Date(now);
  debut.setUTCHours(0, 0, 0, 0);
  const [row] = await getDb()
    .select({ total: count() })
    .from(nicheBenchmarks)
    .where(gte(nicheBenchmarks.collectedAt, debut));
  return Number(row?.total ?? 0);
}

async function collect(query: string, now: Date): Promise<NicheBenchmark> {
  const url =
    `${env.APIFY_API_URL.replace(/\/+$/, '')}/acts/${env.APIFY_GUMROAD_ACTOR}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(env.APIFY_TOKEN!)}&maxItems=${env.MARKET_BENCHMARK_PRODUCTS}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        searchQueries: [query],
        maxResults: env.MARKET_BENCHMARK_PRODUCTS,
        // Doublerait le coût pour un champ absent trois fois sur quatre : mesuré, pas supposé.
        includeProductDetails: false,
        // Jamais : ce sont des données personnelles de tiers, et la prospection non sollicitée
        // abîmerait la réputation du domaine dont dépendent nos e-mails de mot de passe.
        includeCreatorLeads: false,
        enrichCreatorEmails: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new AppError(
      502,
      `La mesure de marché n’a pas abouti (${error instanceof Error && error.name === 'TimeoutError' ? 'délai dépassé' : 'réseau'}).`,
      'BENCHMARK_UNAVAILABLE',
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError(502, 'Le jeton Apify est refusé : vérifiez-le dans la configuration.', 'BENCHMARK_DENIED');
  }
  if (response.status === 402) {
    throw new AppError(
      503,
      'La réserve mensuelle Apify est épuisée : les mesures reprendront au prochain cycle.',
      'BENCHMARK_OUT_OF_CREDIT',
    );
  }
  if (!response.ok) throw new AppError(502, `La mesure de marché n’a pas abouti (réponse ${response.status}).`, 'BENCHMARK_UNAVAILABLE');

  let items: unknown[];
  try {
    items = z.array(z.unknown()).parse(await response.json());
  } catch {
    throw new AppError(502, 'La mesure de marché a renvoyé une réponse illisible.', 'BENCHMARK_UNAVAILABLE');
  }

  const produits = items.map((item) => produitSchema.safeParse(item)).flatMap((r) => (r.success ? [r.data] : []));

  const prix = produits.map((p) => p.price).filter((v): v is number => typeof v === 'number' && v > 0);
  const ventes = produits.map((p) => p.salesCount).filter((v): v is number => typeof v === 'number');
  const ages = produits
    .map((p) => (p.createdAt ? Math.round((now.getTime() - new Date(p.createdAt).getTime()) / 86_400_000) : null))
    .filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0);

  // Devise dominante du relevé. On ne convertit jamais : mélanger des devises dans une médiane
  // produirait un nombre qui ne veut rien dire.
  const devises = new Map<string, number>();
  for (const p of produits) {
    if (!p.currency) continue;
    devises.set(p.currency, (devises.get(p.currency) ?? 0) + 1);
  }
  const dominante = [...devises.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const prixDominants = dominante
    ? produits.filter((p) => p.currency === dominante && typeof p.price === 'number' && p.price > 0).map((p) => p.price!)
    : prix;

  const valeurs = {
    query: normalizeQuery(query),
    source: BENCHMARK_SOURCE,
    productCount: produits.length,
    medianPrice: median(prixDominants),
    currency: dominante,
    medianAgeDays: median(ages),
    totalRatings: produits.reduce((total, p) => total + (typeof p.ratingCount === 'number' ? p.ratingCount : 0), 0),
    salesKnownCount: ventes.length,
    medianSales: median(ventes),
    collectedAt: now,
  };

  const [row] = await getDb()
    .insert(nicheBenchmarks)
    .values(valeurs)
    .onConflictDoUpdate({
      target: [nicheBenchmarks.query, nicheBenchmarks.source],
      set: { ...valeurs, collectedAt: now },
    })
    .returning();

  return toView(row!, now);
}

export interface BenchmarkResult {
  benchmark: NicheBenchmark | null;
  /**
   * « cache » : servi tel quel · « collected » : relevé neuf, payé · « capped » : plafond du
   * jour atteint · « plan » : le palier n'autorise pas de relevé neuf · « unavailable » : aucune
   * collecte configurée. L'écran doit pouvoir dire POURQUOI il n'a rien, sinon l'absence de
   * mesure passe pour une niche vide.
   */
  origin: 'cache' | 'collected' | 'capped' | 'plan' | 'unavailable';
}

/**
 * Mesure d'une niche. Sert le cache s'il est frais ; sinon relève, dans la limite du plafond
 * quotidien du serveur. Un plafond atteint ne supprime pas la réponse : la mesure périmée reste
 * affichée avec sa date, ce qui vaut mieux qu'un écran vide.
 */
export async function nicheBenchmark(query: string, now = new Date()): Promise<BenchmarkResult> {
  const cache = await cachedBenchmark(query, now);
  if (!providers.apify) return { benchmark: cache, origin: cache ? 'cache' : 'unavailable' };
  if (cache && cache.freshForDays > 0) return { benchmark: cache, origin: 'cache' };

  if ((await collectionsToday(now)) >= env.MARKET_BENCHMARK_DAILY_CAP) {
    return { benchmark: cache, origin: 'capped' };
  }

  try {
    return { benchmark: await collect(query, now), origin: 'collected' };
  } catch (error) {
    // Une mesure indisponible ne casse pas l'écran : on rend la précédente, avec sa date.
    if (cache) return { benchmark: cache, origin: 'cache' };
    throw error;
  }
}

/** Nombre de mesures en cache, pour l'écran d'administration. */
export async function benchmarkCount(): Promise<number> {
  const [row] = await getDb().select({ total: count() }).from(nicheBenchmarks);
  return Number(row?.total ?? 0);
}

/** Dernière collecte, quelle que soit la niche. */
export async function lastBenchmarkAt(): Promise<Date | null> {
  const [row] = await getDb().select({ at: sql<Date | null>`max(${nicheBenchmarks.collectedAt})` }).from(nicheBenchmarks);
  return row?.at ? new Date(row.at) : null;
}
