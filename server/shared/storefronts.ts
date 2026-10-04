/**
 * Plateformes de vente reconnues dans le lien d'une publicité — commun au serveur (lecture des
 * annonces, filtre du mur) et au navigateur (ce qu'on peut faire d'une boutique).
 *
 * Relevé réel du 04/10/2026, 717 annonces cherchées au Cameroun, en Côte d'Ivoire et au Sénégal :
 * 357 mènent à « *.myshopify.com », 325 à « *.mymaketou.shop », 10 à « *.mymaketou.store ». Le mur
 * ne montrait que les boutiques Chariow : il passait à côté de la plus grande part de ce que les
 * vendeurs de ces pays paient en publicité.
 *
 * Le Radar, lui, ne sait relever que les vitrines Chariow (ventes, catalogue, prix). Les autres
 * boutiques se regardent sur le mur ; elles ne se surveillent pas.
 */

export const STOREFRONTS = ['chariow', 'maketou', 'shopify'] as const;
export type Storefront = (typeof STOREFRONTS)[number];

export const STOREFRONT_LABELS: Record<Storefront, string> = { chariow: 'Chariow', maketou: 'Maketou', shopify: 'Shopify' };

/** Sous-domaines techniques : ce ne sont pas des boutiques. */
const NOT_A_STORE = new Set(['www', 'api', 'api-edge', 'app', 'cdn', 'images', 'assets', 'static', 'checkout', 'admin', 'accounts']);

const PATTERNS: { storefront: Storefront; pattern: RegExp; host: (sub: string, extension: string) => string }[] = [
  {
    storefront: 'chariow',
    // Toute extension est acceptée derrière « mychariow » (.com, .shop, .store, .online, .market) ;
    // elles désignent la même boutique, ramenée à sa forme en .com, celle que le Radar surveille.
    pattern: /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.mychariow\.([a-z]{2,12})\b/i,
    host: (sub) => `${sub}.mychariow.com`,
  },
  {
    storefront: 'maketou',
    // « .shop » et « .store » vus tous les deux ; rien ne dit qu'ils désignent la même boutique : l'extension est gardée.
    pattern: /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.mymaketou\.([a-z]{2,12})\b/i,
    host: (sub, extension) => `${sub}.mymaketou.${extension}`,
  },
  {
    storefront: 'shopify',
    pattern: /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.myshopify\.(com)\b/i,
    host: (sub) => `${sub}.myshopify.com`,
  },
];

/** Première boutique reconnue dans un texte (lien de destination, légende), ou null. */
export function findStorefront(text: string): { host: string; storefront: Storefront } | null {
  for (const { storefront, pattern, host } of PATTERNS) {
    const found = pattern.exec(text);
    const sub = found?.[1]?.toLowerCase();
    if (!sub || NOT_A_STORE.has(sub)) continue;
    return { host: host(sub, (found?.[2] ?? '').toLowerCase()), storefront };
  }
  return null;
}

/** Plateforme d'un hôte de boutique déjà reconnu, ou null. */
export function storefrontOfHost(host: string | null | undefined): Storefront | null {
  const value = (host ?? '').toLowerCase();
  if (/\.mychariow\.[a-z]{2,12}$/.test(value)) return 'chariow';
  if (/\.mymaketou\.[a-z]{2,12}$/.test(value)) return 'maketou';
  if (value.endsWith('.myshopify.com')) return 'shopify';
  return null;
}

/** Le Radar ne relève que les vitrines Chariow : seules elles peuvent être ouvertes ou surveillées. */
export const followableOnRadar = (host: string | null | undefined): boolean => storefrontOfHost(host) === 'chariow';
