import { z } from 'zod';
import { env, isProd } from '@server/env';
import { AppError } from '@server/middleware';
import type { RadarObservation, RadarSource, RadarTarget } from '@server/services/radar/types';

/**
 * Vitrine publique d'une boutique Chariow.
 *
 * Deux adresses, relevées le 22/09/2026 et vérifiées sur quatre boutiques :
 *
 *   GET https://{boutique}.mychariow.com/                          → la page, qui contient
 *                                                                    l'identifiant « store_… »
 *   GET {CHARIOW_STOREFRONT_URL}/storefront/{store_…}/products     → le catalogue, en JSON,
 *                                                                    SANS authentification
 *
 * Ce que la vitrine publie, et qui fait tout l'intérêt de la surveillance :
 *   · `sales_count` — les ventes cumulées de chaque produit, en clair ;
 *   · `pricing.effective.value` — le prix réellement pratiqué, remises comprises.
 *
 * Ce qu'elle ne publie PAS : aucune date de création. L'ancienneté d'un produit ne
 * s'obtient donc que par l'observation — c'est précisément ce que le radar existe pour faire.
 *
 * Rien ici n'est une donnée privée : c'est le catalogue que la boutique montre déjà à ses
 * visiteurs. Un seul passage par jour et par boutique, et l'outil s'annonce dans son
 * en-tête User-Agent plutôt que de se faire passer pour un navigateur.
 */

const TIMEOUT_MS = 20_000;
/** Une page de vitrine pèse une cinquantaine de kilo-octets ; au-delà, on ne lit pas. */
const MAX_HTML_BYTES = 2_000_000;
/** Pages de catalogue suivies au plus : borne le travail sur une très grosse boutique. */
const MAX_PAGES = 20;
const USER_AGENT = 'SmartCreatorRadar/1.0 (+veille concurrentielle ; une visite par jour)';

/** Hôtes autorisés. Sans cette liste, une adresse fournie par un utilisateur ferait
 *  appeler par le serveur n'importe quelle machine, y compris sur le réseau interne. */
const STOREFRONT_HOSTS = /\.mychariow\.(com|shop)$/;
const LOOPBACK = /^(127\.0\.0\.1|\[::1\]|localhost)$/;

const STORE_ID = /store_[a-z0-9]{6,24}/i;

const moneySchema = z.object({
  value: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
});

const productSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  pricing: z
    .object({
      effective: moneySchema.optional(),
      current_price: moneySchema.optional(),
    })
    .nullable()
    .optional(),
  sales_count: z.object({ value: z.number().nullable().optional() }).nullable().optional(),
  store: z.object({ name: z.string().nullable().optional(), url: z.string().nullable().optional() }).nullable().optional(),
});

const catalogSchema = z.object({
  data: z.array(productSchema),
  pagination: z
    .object({
      next_page_url: z.string().nullable().optional(),
      has_more_pages: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});

const unreachable = (detail: string) =>
  new AppError(502, `La vitrine de cette boutique est injoignable (${detail}).`, 'RADAR_SOURCE_UNAVAILABLE');

/**
 * Transforme une saisie en adresse de vitrine. Accepte un lien complet, un
 * sous-domaine (« techlab-market ») ou l'identifiant « store_… » directement.
 */
function storefrontUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new AppError(400, 'Indiquez le lien de la boutique à surveiller.', 'RADAR_TARGET_INVALID');

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new AppError(400, 'Ce lien de boutique n’est pas valide.', 'RADAR_TARGET_INVALID');
  }

  // Un sous-domaine seul (« techlab-market ») : on complète le domaine de la plateforme.
  if (!url.hostname.includes('.')) url = new URL(`https://${url.hostname}.mychariow.com`);

  const tolereEnClair = !isProd && LOOPBACK.test(url.hostname);

  /*
    Sous test, seule la boucle locale est joignable. Sans cette barrière, un test qui ajoute une
    surveillance par nom d'hôte appelle la VRAIE vitrine d'un tiers : la suite devient dépendante
    du réseau, et l'on sollicite le site de quelqu'un à chaque exécution. Constaté, pas supposé.
  */
  if (env.NODE_ENV === 'test' && !tolereEnClair) {
    throw new AppError(
      400,
      'Sous test, le radar ne relève que des vitrines locales.',
      'RADAR_SOURCE_UNSUPPORTED',
    );
  }

  if (!STOREFRONT_HOSTS.test(url.hostname) && !tolereEnClair) {
    throw new AppError(
      400,
      'Le radar ne surveille pour l’instant que les boutiques Chariow (adresse en .mychariow.com).',
      'RADAR_SOURCE_UNSUPPORTED',
    );
  }
  if (url.protocol !== 'https:' && !tolereEnClair) url.protocol = 'https:';
  return url;
}

async function fetchText(url: URL): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw unreachable(error instanceof Error && error.name === 'TimeoutError' ? 'délai dépassé' : 'réseau');
  }
  if (response.status === 404) {
    throw new AppError(404, 'Cette boutique n’existe pas, ou n’est plus en ligne.', 'RADAR_TARGET_NOT_FOUND');
  }
  if (!response.ok) throw unreachable(`réponse ${response.status}`);

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_HTML_BYTES) throw unreachable('page trop volumineuse');
  return new TextDecoder().decode(buffer);
}

async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw unreachable(error instanceof Error && error.name === 'TimeoutError' ? 'délai dépassé' : 'réseau');
  }
  if (response.status === 404) {
    throw new AppError(404, 'Cette boutique n’est plus accessible sur la plateforme.', 'RADAR_TARGET_NOT_FOUND');
  }
  if (response.status === 429) {
    throw new AppError(429, 'La plateforme limite les consultations : le radar réessaiera.', 'RADAR_SOURCE_RATE_LIMITED');
  }
  if (!response.ok) throw unreachable(`réponse ${response.status}`);

  try {
    return (await response.json()) as unknown;
  } catch {
    throw unreachable('réponse illisible');
  }
}

/** Titre lisible de la boutique, pris dans la page. Sert de libellé par défaut. */
function storeLabel(html: string, fallback: string): string {
  const og = /<meta[^>]+property="og:title"[^>]+content="([^"]{1,120})"/i.exec(html);
  const title = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(html);
  const found = (og?.[1] ?? title?.[1] ?? '').replace(/\s+/g, ' ').trim();
  return found || fallback;
}

/** Le catalogue est paginé par curseur : on suit `next_page_url`, dans la limite de MAX_PAGES. */
function catalogUrl(externalId: string): string {
  return `${env.CHARIOW_STOREFRONT_URL.replace(/\/+$/, '')}/storefront/${encodeURIComponent(externalId)}/products`;
}

function toObservation(product: z.infer<typeof productSchema>): RadarObservation {
  const money = product.pricing?.effective ?? product.pricing?.current_price ?? null;
  return {
    externalId: product.id,
    name: product.name.replace(/\s+/g, ' ').trim().slice(0, 300),
    kind: product.type ?? null,
    priceValue: typeof money?.value === 'number' ? Math.round(money.value) : null,
    currency: money?.currency ?? null,
    salesCount: typeof product.sales_count?.value === 'number' ? product.sales_count.value : null,
  };
}

export const chariowStoreSource: RadarSource = {
  async resolve(input: string): Promise<RadarTarget> {
    // Identifiant donné directement : rien à deviner, on vérifie juste qu'il répond.
    if (/^store_[a-z0-9]{6,24}$/i.test(input.trim())) {
      const externalId = input.trim();
      const catalog = catalogSchema.parse(await fetchJson(catalogUrl(externalId)));
      const store = catalog.data[0]?.store ?? null;
      return {
        source: 'chariow_store',
        externalId,
        label: store?.name?.trim() || externalId,
        url: store?.url ?? null,
      };
    }

    const url = storefrontUrl(input);
    const html = await fetchText(url);
    const found = STORE_ID.exec(html)?.[0];
    if (!found) {
      throw new AppError(
        422,
        'Cette page ne ressemble pas à une boutique Chariow : le radar n’y trouve aucun catalogue.',
        'RADAR_TARGET_UNREADABLE',
      );
    }
    return {
      source: 'chariow_store',
      externalId: found.toLowerCase(),
      label: storeLabel(html, url.hostname),
      url: url.origin,
    };
  },

  async observe(externalId: string): Promise<RadarObservation[]> {
    const observations: RadarObservation[] = [];
    const seen = new Set<string>();
    let next: string | null = catalogUrl(externalId);

    for (let page = 0; next && page < MAX_PAGES; page += 1) {
      const catalog = catalogSchema.parse(await fetchJson(next));
      for (const product of catalog.data) {
        // Un brouillon n'est pas en vente : le compter ferait naître de faux articles.
        if (product.status && product.status !== 'published') continue;
        if (seen.has(product.id)) continue;
        seen.add(product.id);
        observations.push(toObservation(product));
      }
      const suivant = catalog.pagination?.next_page_url ?? null;
      // La page suivante doit rester sur le service de vitrine : une adresse renvoyée
      // par un tiers ne décide pas de qui le serveur va appeler.
      next = suivant && suivant.startsWith(env.CHARIOW_STOREFRONT_URL.replace(/\/+$/, '')) ? suivant : null;
    }

    return observations;
  },
};
