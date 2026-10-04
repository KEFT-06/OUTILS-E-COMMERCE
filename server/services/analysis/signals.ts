import { and, eq, or } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { containsIgnoringAccents } from '@server/db/search';
import { spiedAds } from '@server/db/schema';
import { env } from '@server/env';
import type { WebSource } from '@server/services/analysis/webSearch';
import { nicheKeywords, searchMarketProducts } from '@server/services/market';

/**
 * Nos propres relevés sur une niche, donnés à l'analyse comme une source de plus.
 *
 * L'étude du web dit ce qui se publie sur un sujet ; elle ne dit presque jamais ce qui se VEND.
 * Une analyse du 04/10/2026 concluait ainsi : « les sources ne donnent ni ventes, ni avis
 * d'acheteurs : la demande ne peut pas être mesurée » — et ne rendait aucun verdict. Or le site
 * relève chaque jour ce que le web ne publie pas : les ventes affichées par les boutiques de
 * produits digitaux, leurs prix, et les publicités que des vendeurs paient depuis des semaines.
 *
 * Ce sont des mesures, pas des estimations : rien n'est extrapolé, et une niche sur laquelle
 * nous n'avons rien relevé ne reçoit aucune source de ce genre.
 */

const JOUR_MS = 86_400_000;
const PRODUCTS_READ = 200;
const ADS_READ = 400;

export interface NicheSignals {
  products: number;
  stores: number;
  productsWithSales: number;
  totalSales: number;
  bestSeller: { name: string; sales: number; price: number | null; currency: string | null } | null;
  prices: { min: number; median: number; max: number; currency: string } | null;
  activeAds: number;
  advertisers: number;
  longestAdDays: number | null;
  adsOverSixtyDays: number;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
};

/** Ce que nos relevés disent d'une niche, ou null quand ils n'en disent rien. */
export async function measureNiche(niche: string, now = new Date()): Promise<NicheSignals | null> {
  const keywords = nicheKeywords(niche);
  if (keywords.length === 0) return null;

  const market = await searchMarketProducts(niche, PRODUCTS_READ);
  const withSales = market.products.filter((product) => typeof product.sales === 'number' && product.sales > 0);
  const best = [...withSales].sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0))[0] ?? null;

  // Les prix ne se comparent que dans une même devise : on garde la plus fréquente.
  const priced = market.products.filter((product) => typeof product.price === 'number' && product.price > 0 && product.currency);
  const byCurrency = new Map<string, number[]>();
  for (const product of priced) byCurrency.set(product.currency!, [...(byCurrency.get(product.currency!) ?? []), product.price!]);
  const [currency, values] = [...byCurrency.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [null, []];

  const ads = await getDb()
    .select({ pageId: spiedAds.pageId, advertiser: spiedAds.advertiser, startedAt: spiedAds.startedAt })
    .from(spiedAds)
    .where(and(eq(spiedAds.active, true), or(...keywords.map((keyword) => containsIgnoringAccents([spiedAds.title, spiedAds.bodyText], keyword)))))
    .limit(ADS_READ);
  const days = ads.flatMap((ad) => (ad.startedAt ? [Math.max(0, Math.floor((now.getTime() - ad.startedAt.getTime()) / JOUR_MS))] : []));

  if (market.products.length === 0 && ads.length === 0) return null;
  return {
    products: market.products.length,
    stores: market.stores,
    productsWithSales: withSales.length,
    totalSales: withSales.reduce((total, product) => total + (product.sales ?? 0), 0),
    bestSeller: best ? { name: best.name, sales: best.sales ?? 0, price: best.price, currency: best.currency } : null,
    prices: currency && values.length > 0 ? { min: Math.min(...values), median: median(values), max: Math.max(...values), currency } : null,
    activeAds: ads.length,
    advertisers: new Set(ads.map((ad) => ad.pageId ?? ad.advertiser ?? '')).size,
    longestAdDays: days.length > 0 ? Math.max(...days) : null,
    adsOverSixtyDays: days.filter((value) => value >= 60).length,
  };
}

const count = (value: number, one: string, many: string) => `${value.toLocaleString('fr-FR')} ${value > 1 ? many : one}`;

/** Les relevés en phrases, tels que le rédacteur de l'analyse les lira. Fonction pure. */
export function describeSignals(signals: NicheSignals, day: string): string {
  const lines = [`Relevé du ${day} sur les boutiques de produits digitaux et les publicités suivies par Smart Creator (mesures, pas estimations).`];
  if (signals.products > 0) {
    lines.push(`Offre : ${count(signals.products, 'produit en vente', 'produits en vente')} sur ce sujet, dans ${count(signals.stores, 'boutique', 'boutiques')}.`);
    lines.push(
      signals.productsWithSales > 0
        ? `Ventes affichées par les boutiques : ${count(signals.totalSales, 'vente', 'ventes')} au total sur ${count(signals.productsWithSales, 'produit', 'produits')}${
            signals.bestSeller
              ? ` ; la meilleure vente est « ${signals.bestSeller.name} » (${count(signals.bestSeller.sales, 'vente', 'ventes')}${
                  signals.bestSeller.price && signals.bestSeller.currency ? `, ${signals.bestSeller.price.toLocaleString('fr-FR')} ${signals.bestSeller.currency}` : ''
                }).`
              : '.'
          }`
        : 'Aucune de ces boutiques n’affiche de ventes sur ces produits.',
    );
    if (signals.prices) {
      const { min, median: middle, max, currency } = signals.prices;
      lines.push(`Prix relevés : de ${min.toLocaleString('fr-FR')} à ${max.toLocaleString('fr-FR')} ${currency}, médiane ${middle.toLocaleString('fr-FR')} ${currency}.`);
    }
  } else {
    lines.push('Offre : aucun produit sur ce sujet dans les boutiques relevées.');
  }
  lines.push(
    signals.activeAds > 0
      ? `Publicités : ${count(signals.activeAds, 'annonce en cours', 'annonces en cours')} sur ce sujet, chez ${count(signals.advertisers, 'annonceur', 'annonceurs')}${
          signals.longestAdDays !== null ? ` ; la plus ancienne tourne depuis ${count(signals.longestAdDays, 'jour', 'jours')}` : ''
        }${signals.adsOverSixtyDays > 0 ? `, et ${count(signals.adsOverSixtyDays, 'tourne', 'tournent')} depuis plus de 60 jours (une publicité payée aussi longtemps est rentable pour son annonceur)` : ''}.`
      : 'Publicités : aucune annonce en cours sur ce sujet parmi celles relevées.',
  );
  return lines.join(' ');
}

/** La source à ajouter à celles de l'étude, numérotée à leur suite ; null : rien de relevé. */
export async function nicheSignalsSource(niche: string, nextId: number, now = new Date()): Promise<WebSource | null> {
  const signals = await measureNiche(niche, now);
  if (!signals) return null;
  const day = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: env.REPORTING_TIMEZONE });
  return {
    id: nextId,
    title: 'Relevés Smart Creator : boutiques et publicités observées sur cette niche',
    url: `${env.APP_URL.replace(/\/+$/, '')}/app/radar?niche=${encodeURIComponent(niche)}`,
    snippet: describeSignals(signals, day),
    publishedAt: now.toISOString().slice(0, 10),
  };
}
