import { inArray } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { spiedAds } from '@server/db/schema';

/**
 * Publicités d'un PRODUIT : celles dont le lien de destination mène à sa page.
 *
 * Une boutique fait de la publicité pour un produit précis, pas pour son catalogue. Trois écrans
 * du Radar rattachaient les annonces chacun à sa façon — l'un par produit, les deux autres à la
 * boutique entière : la « première publicité » d'un produit jamais promu était alors celle de son
 * voisin. Une seule règle ici, la même pour tous.
 *
 * La vitrine ne publie aucune date de création : la date de début d'une publicité, publiée par
 * la régie, est la seule borne d'ancienneté qui ne dépende pas de notre observation.
 */

interface StoreAd {
  landingUrl: string;
  startedAt: Date | null;
  active: boolean;
}

export interface ProductAds {
  /** Début de la plus ancienne publicité connue pour ce produit sur Meta. */
  firstAdAt: Date | null;
  activeAds: number;
  totalAds: number;
}

const AUCUNE: ProductAds = { firstAdAt: null, activeAds: 0, totalAds: 0 };

/** Annonces connues de chaque boutique, en une requête. */
export async function loadStoreAds(hosts: string[]): Promise<Map<string, StoreAd[]>> {
  const parBoutique = new Map<string, StoreAd[]>();
  const uniques = [...new Set(hosts.filter(Boolean))];
  if (uniques.length === 0) return parBoutique;
  const rows = await getDb()
    .select({ host: spiedAds.storeHost, landingUrl: spiedAds.landingUrl, startedAt: spiedAds.startedAt, active: spiedAds.active })
    .from(spiedAds)
    .where(inArray(spiedAds.storeHost, uniques));
  for (const row of rows) {
    const liste = parBoutique.get(row.host) ?? [];
    liste.push(row);
    parBoutique.set(row.host, liste);
  }
  return parBoutique;
}

/** Cette adresse mène-t-elle à la page de ce produit ? Le nom doit être un segment entier : « /guide » ne vaut pas « /guide-2 ». */
export function leadsToProduct(landingUrl: string, slug: string): boolean {
  const segment = `/${slug.toLowerCase()}`;
  const chemin = landingUrl.toLowerCase().split(/[?#]/)[0]!.replace(/\/+$/, '');
  return chemin.endsWith(segment) || chemin.includes(`${segment}/`);
}

/**
 * Relevé sur de vraies annonces le 07/10/2026 : les unes mènent à « /72-prompts » (le nom
 * d'adresse du produit), les autres à « /prd_1j8m61/checkout » (son identifiant, vers le
 * paiement). Les deux formes désignent le produit.
 */
export function adsOfProduct(ads: StoreAd[] | undefined, slug: string | null, externalId?: string | null): ProductAds {
  const cles = [slug, externalId].filter((cle): cle is string => Boolean(cle));
  if (cles.length === 0 || !ads || ads.length === 0) return AUCUNE;
  const siennes = ads.filter((ad) => cles.some((cle) => leadsToProduct(ad.landingUrl, cle)));
  if (siennes.length === 0) return AUCUNE;
  const debuts = siennes.flatMap((ad) => (ad.startedAt ? [ad.startedAt.getTime()] : []));
  return {
    firstAdAt: debuts.length ? new Date(Math.min(...debuts)) : null,
    activeAds: siennes.filter((ad) => ad.active).length,
    totalAds: siennes.length,
  };
}

/** Page du produit sur sa vitrine ; la vitrine elle-même quand son adresse n'est pas connue. */
export const productUrl = (host: string, slug: string | null): string => (slug ? `https://${host}/${encodeURIComponent(slug)}` : `https://${host}`);
