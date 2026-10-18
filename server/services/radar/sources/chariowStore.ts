import { z } from 'zod';
import { env, isProd } from '@server/env';
import { AppError } from '@server/middleware';
import { BUDGET_CODE, fetchViaFirecrawl, firecrawlConfigured, jsonOfPage } from '@server/services/radar/sources/firecrawl';
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
 * DEPUIS L'AUTOMNE 2026, LES VENTES NE SONT PLUS DANS LA LISTE. Mesuré le 04/10/2026 sur une
 * vraie vitrine : le catalogue ne rend plus que le nom, le prix (`pricing.current_price`) et
 * les avis ; `sales_count` et la catégorie ne sont publiés que par la fiche de chaque produit :
 *
 *   GET {CHARIOW_STOREFRONT_URL}/storefront/{store_…}/products/{prd_…}   → sales_count, category
 *
 * Le radar affichait donc « — » partout, et ne voyait plus aucune vente. Chaque relevé lit
 * désormais les fiches, quelques-unes à la fois, dans un temps borné (voir `readDetails`).
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
/*
  La lecture des fiches a été divisée par trois le 11/10/2026. Depuis le 07/10, chaque boutique
  se faisait lire jusqu'à 120 fiches, quatre à la fois, toutes les nuits : des milliers de
  demandes en quelques minutes depuis une seule adresse. La plateforme a cessé de répondre au
  serveur dans les jours qui ont suivi. Rien ne prouve le lien — mais une vitrine est celle d'un
  tiers, et un relevé qui la ménage est le seul qui dure.
*/
/** Fiches produit lues au plus par relevé : au-delà, le catalogue est couvert en plusieurs jours. */
const DETAILS_MAX = 40;
/** Fiches lues en même temps : la vitrine est celle d'un tiers, on ne la sollicite pas en rafale. */
const DETAILS_CONCURRENCY = 2;
/** Temps accordé à la lecture des fiches d'une boutique. */
const DETAILS_BUDGET_MS = 25_000;
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
  slug: z.string().nullable().optional(),
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

/** Fiche d'un produit : ce que la liste ne publie plus. */
const detailSchema = z.object({
  sales_count: z.object({ value: z.number().nullable().optional() }).nullable().optional(),
  category: z.object({ value: z.string().nullable().optional() }).nullable().optional(),
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

/**
 * La vitrine ne répond pas. Le motif (« réponse 500 », « délai dépassé ») va au journal du
 * serveur : devant un client, il n'explique rien et ne lui donne rien à faire.
 */
/** Ce que la plateforme a répondu, gardé à côté de l'erreur : jamais envoyé à un client, lu par l'administration. */
const SOURCE_FAILURES = new WeakMap<object, string>();

/** La cause technique d'une vitrine sans réponse (« réponse 403 (cloudflare) », « délai dépassé »), ou null. */
export const sourceFailureOf = (error: unknown): string | null => (typeof error === 'object' && error !== null ? (SOURCE_FAILURES.get(error) ?? null) : null);

const unreachable = (detail: string) => {
  console.warn(`[radar] vitrine sans réponse : ${detail}`);
  const error = new AppError(502, 'La vitrine de cette boutique ne répond pas en ce moment.', 'RADAR_SOURCE_UNAVAILABLE');
  SOURCE_FAILURES.set(error, detail);
  return error;
};

/** Le statut d'un refus, avec ce qui dit QUI refuse : le service de la plateforme, ou une protection placée devant lui. */
function refusal(response: Response): string {
  const server = response.headers.get('server')?.trim().slice(0, 30);
  const guarded = response.headers.get('cf-mitigated') ? ', protection' : '';
  return `réponse ${response.status}${server ? ` (${server}${guarded})` : ''}`;
}

/**
 * Hôte d'une vitrine tel que nos relevés l'enregistrent (minuscules, en .com), d'après ce que
 * l'utilisateur a saisi. null : ce n'est pas l'adresse d'une vitrine (identifiant donné tel quel,
 * saisie illisible) — rien à chercher dans nos relevés.
 */
export function storefrontHostOf(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /^store_[a-z0-9]{6,24}$/i.test(trimmed)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`);
    const host = (url.hostname.includes('.') ? url.hostname : `${url.hostname}.mychariow.com`).toLowerCase();
    return STOREFRONT_HOSTS.test(host) ? host.replace(/\.mychariow\.shop$/, '.mychariow.com') : null;
  } catch {
    return null;
  }
}

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

/**
 * Identifiant d'attente d'une boutique ajoutée avant d'avoir pu être lue : « host:{hôte} ». Le
 * premier relevé réussi (serveur ou collecteur) le remplace par son vrai identifiant « store_… ».
 */
export const PENDING_PREFIX = 'host:';

export const isPendingStore = (externalId: string) => externalId.startsWith(PENDING_PREFIX);

/**
 * Cible d'attente pour une boutique de la plateforme dont la page n'a pas pu être lue. L'adresse
 * est validée comme pour une lecture : une adresse quelconque reste refusée.
 */
export function pendingTargetOf(input: string): RadarTarget {
  const url = storefrontUrl(input);
  const host = storefrontHostOf(input) ?? url.host.toLowerCase();
  return { source: 'chariow_store', externalId: `${PENDING_PREFIX}${host}`, label: host, url: STOREFRONT_HOSTS.test(host) ? `https://${host}` : url.origin };
}

/**
 * Une page lue par Firecrawl, rendue comme une lecture directe : mêmes refus, mêmes messages. Le
 * statut est celui de la page chez la plateforme ; 0 : Firecrawl n'a rien pu rendre.
 */
async function readThroughFirecrawl(url: string, notFound: string): Promise<string> {
  const page = await fetchViaFirecrawl(url);
  if (page.status === 404) throw new AppError(404, notFound, 'RADAR_TARGET_NOT_FOUND');
  if (page.status === 429) throw new AppError(429, 'La plateforme limite les consultations : le radar réessaiera.', 'RADAR_SOURCE_RATE_LIMITED');
  if (page.status < 200 || page.status >= 300) throw unreachable(page.status ? `réponse ${page.status} (lue par Firecrawl)` : 'Firecrawl sans réponse');
  if (page.body.length > MAX_HTML_BYTES) throw unreachable('page trop volumineuse');
  return page.body;
}

async function fetchText(url: URL): Promise<string> {
  if (firecrawlConfigured()) return readThroughFirecrawl(url.toString(), 'Cette boutique n’existe pas, ou n’est plus en ligne.');
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
  if (!response.ok) throw unreachable(refusal(response));

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_HTML_BYTES) throw unreachable('page trop volumineuse');
  return new TextDecoder().decode(buffer);
}

async function fetchJson(url: string): Promise<unknown> {
  if (firecrawlConfigured()) {
    const body = await readThroughFirecrawl(url, 'Cette boutique n’est plus accessible sur la plateforme.');
    try {
      return jsonOfPage(body);
    } catch {
      throw unreachable('réponse illisible (lue par Firecrawl)');
    }
  }
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
  if (!response.ok) throw unreachable(refusal(response));

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

/**
 * Demande les prix dans la devise de référence. La plateforme accepte `?currency=` ; sans lui,
 * elle choisit la devise d'après l'adresse du demandeur — donc celle du pays du serveur.
 */
function inReferenceCurrency(address: string): string {
  const url = new URL(address);
  url.searchParams.set('currency', env.RADAR_PRICE_CURRENCY);
  return url.toString();
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
    slug: product.slug?.trim() || null,
  };
}

function detailUrl(externalId: string, productId: string): string {
  return inReferenceCurrency(`${catalogUrl(externalId)}/${encodeURIComponent(productId)}`);
}

/**
 * Complète les relevés par la fiche de chaque produit : ventes cumulées et catégorie.
 *
 * Borné trois fois : en nombre (DETAILS_MAX), en temps (DETAILS_BUDGET_MS) et en débit
 * (DETAILS_CONCURRENCY). Sur un catalogue plus grand que la borne, le point de départ avance
 * d'un jour sur l'autre : chaque produit est lu au moins un jour sur deux, et le dernier compte
 * connu reste affiché entre-temps. Un refus de débit arrête la lecture au lieu d'insister.
 */
async function readDetails(externalId: string, observations: RadarObservation[], now = new Date(), until = Number.POSITIVE_INFINITY): Promise<void> {
  const pending = observations.filter((observation) => observation.salesCount === null);
  if (pending.length === 0) return;

  const jour = Math.floor(now.getTime() / 86_400_000);
  const start = pending.length > DETAILS_MAX ? (jour * DETAILS_MAX) % pending.length : 0;
  const queue = [...pending.slice(start), ...pending.slice(0, start)].slice(0, DETAILS_MAX);
  const deadline = Math.min(Date.now() + DETAILS_BUDGET_MS, until);
  let stopped = false;
  let read = 0;
  let withSales = 0;

  const readOne = async (observation: RadarObservation) => {
    try {
      const payload = (await fetchJson(detailUrl(externalId, observation.externalId))) as { data?: unknown } | null;
      const detail = detailSchema.safeParse(payload?.data ?? payload);
      if (!detail.success) return;
      read += 1;
      const sales = detail.data.sales_count?.value;
      if (typeof sales === 'number') {
        withSales += 1;
        observation.salesCount = sales;
      }
      observation.category = detail.data.category?.value?.trim() || null;
    } catch (error) {
      // La plateforme demande de ralentir : on s'arrête là, le relevé de demain reprendra.
      // Toute autre fiche illisible est simplement passée : elle ne fait pas échouer le relevé.
      // Le plafond Firecrawl du jour aussi : les fiches restantes se liront au relevé suivant.
      if (error instanceof AppError && (error.code === 'RADAR_SOURCE_RATE_LIMITED' || error.code === BUDGET_CODE)) stopped = true;
    }
  };
  const open = () => !stopped && Date.now() < deadline;

  /*
    Une boutique peut masquer ses ventes (réglage de toute la boutique) : sa fiche rend
    `sales_count: null`. Mesuré le 18/10/2026 sur une boutique de 25 produits, huit fiches lues
    pour rien — et chaque fiche lue par Firecrawl coûte un crédit. Les premières fiches se lisent
    donc une à une : deux sans ventes, et la boutique n'est pas lue plus loin.
  */
  while (queue.length > 0 && open() && withSales === 0 && read < 2) await readOne(queue.shift()!);
  if (withSales === 0 && read >= 2) return;

  const worker = async () => {
    for (let observation = queue.shift(); observation && open(); observation = queue.shift()) await readOne(observation);
  };
  await Promise.all(Array.from({ length: DETAILS_CONCURRENCY }, worker));
}

/**
 * Un relevé lu hors du serveur (le collecteur, par Firecrawl) : les produits du catalogue et les
 * fiches tels que la plateforme les rend, lus ici par les mêmes règles que `observe` — brouillons
 * écartés, prix remises comprises, ventes prises sur la fiche. Une ligne illisible est passée.
 */
export function observationsFromStorefront(catalog: unknown[], details: Record<string, unknown>): RadarObservation[] {
  const observations: RadarObservation[] = [];
  const seen = new Set<string>();
  for (const item of catalog) {
    const product = productSchema.safeParse(item);
    if (!product.success) continue;
    if (product.data.status && product.data.status !== 'published') continue;
    if (seen.has(product.data.id)) continue;
    seen.add(product.data.id);
    const observation = toObservation(product.data);
    const detail = detailSchema.safeParse(details[product.data.id]);
    if (detail.success && details[product.data.id] !== undefined) {
      const sales = detail.data.sales_count?.value;
      if (typeof sales === 'number') observation.salesCount = sales;
      observation.category = detail.data.category?.value?.trim() || null;
    }
    observations.push(observation);
  }
  return observations;
}

export const chariowStoreSource: RadarSource = {
  async resolve(input: string): Promise<RadarTarget> {
    // Identifiant donné directement : rien à deviner, on vérifie juste qu'il répond.
    if (/^store_[a-z0-9]{6,24}$/i.test(input.trim())) {
      const externalId = input.trim();
      const catalog = catalogSchema.parse(await fetchJson(inReferenceCurrency(catalogUrl(externalId))));
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

  async observe(externalId: string, options: { deadline?: number } = {}): Promise<RadarObservation[]> {
    const observations: RadarObservation[] = [];
    const seen = new Set<string>();
    let next: string | null = catalogUrl(externalId);

    for (let page = 0; next && page < MAX_PAGES; page += 1) {
      const catalog = catalogSchema.parse(await fetchJson(inReferenceCurrency(next)));
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

    await readDetails(externalId, observations, new Date(), options.deadline);
    return observations;
  },
};
