import { z } from 'zod';
import { assertPublicUrl } from '@server/lib/publicUrl';
import { AppError } from '@server/middleware';
import { formatMajor, totalsByCurrency } from '@server/services/marketplaces/money';
import type { MarketplaceAdapter, MarketplaceProduct, SalesSummary, WooCommerceCredentials } from '@server/services/marketplaces/types';

/**
 * Connecteur WooCommerce — API REST v3 (/wp-json/wc/v3), en lecture seule.
 *
 * Les clés se créent dans WordPress : WooCommerce → Réglages → Avancé → API REST, droits
 * « Lecture ». Elles partent en authentification HTTP Basic, donc SEULEMENT en https.
 *
 * L'adresse du site est fournie par l'utilisateur et appelée par le serveur : elle passe par
 * `assertPublicUrl` à chaque appel (https, pas d'adresse privée), et les redirections ne sont
 * pas suivies — un site qui renverrait vers un réseau interne n'y mènerait pas le serveur.
 */

const TIMEOUT_MS = 20_000;
const MAX_PAGES = 10;
/** Statuts d'une commande encaissée (« processing » : payée, en préparation). */
const PAID_STATUSES = new Set(['completed', 'processing']);

export const wooKeySchema = z.object({
  siteUrl: z.string().trim().min(8).max(300),
  consumerKey: z.string().trim().regex(/^ck_[a-f0-9]{20,64}$/, 'La clé client commence par « ck_ ».'),
  consumerSecret: z.string().trim().regex(/^cs_[a-f0-9]{20,64}$/, 'Le secret client commence par « cs_ ».'),
});

async function wooFetch(credentials: WooCommerceCredentials, path: string, query: Record<string, string> = {}) {
  const site = await assertPublicUrl(credentials.siteUrl, 'L’adresse du site');
  const url = new URL(`${site.origin}${site.pathname.replace(/\/+$/, '')}/wp-json/wc/v3${path}`);
  url.search = new URLSearchParams(query).toString();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString('base64')}`,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(502, 'Le site WooCommerce ne répond pas.', 'WOOCOMMERCE_UNREACHABLE');
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError(400, 'WooCommerce refuse ces clés : vérifiez-les, avec les droits « Lecture ».', 'WOOCOMMERCE_ACCESS_DENIED');
  }
  if (response.status >= 300 && response.status < 400) {
    throw new AppError(400, 'Le site redirige ailleurs : indiquez son adresse exacte, en https.', 'WOOCOMMERCE_REDIRECT');
  }
  if (response.status === 404) {
    throw new AppError(400, 'Aucune API WooCommerce à cette adresse : vérifiez l’adresse du site.', 'WOOCOMMERCE_NOT_FOUND');
  }
  if (!response.ok) throw new AppError(502, 'Réponse inattendue du site WooCommerce.', 'WOOCOMMERCE_BAD_RESPONSE');
  const body = (await response.json().catch(() => null)) as unknown;
  return { body, totalPages: Number(response.headers.get('x-wp-totalpages') ?? 1) || 1 };
}

async function collect(credentials: WooCommerceCredentials, path: string, query: Record<string, string>) {
  const items: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { body, totalPages } = await wooFetch(credentials, path, { ...query, per_page: '100', page: String(page) });
    if (!Array.isArray(body)) throw new AppError(502, 'Réponse inattendue du site WooCommerce.', 'WOOCOMMERCE_BAD_RESPONSE');
    items.push(...(body as Record<string, unknown>[]));
    if (page >= totalPages) return { items, truncated: false };
  }
  return { items, truncated: true };
}

/** Devise de la boutique, lue dans ses réglages ; null si les droits ne le permettent pas. */
async function storeCurrency(credentials: WooCommerceCredentials): Promise<string | null> {
  try {
    const { body } = await wooFetch(credentials, '/settings/general/woocommerce_currency');
    const value = (body as { value?: unknown } | null)?.value;
    return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function verifyWooCommerce(credentials: WooCommerceCredentials): Promise<void> {
  await wooFetch(credentials, '/products', { per_page: '1' });
}

export const wooCommerceAdapter: MarketplaceAdapter = {
  id: 'woocommerce',
  label: 'WooCommerce',
  capabilities: { readProducts: true, publishProducts: false, readSales: true },

  isAvailable(context) {
    return context.woocommerce
      ? { available: true }
      : { available: false, reason: 'Reliez votre site WooCommerce dans Mon compte → Connexions.' };
  },

  async listProducts(context) {
    const credentials = context.woocommerce!;
    const [{ items, truncated }, currency] = await Promise.all([collect(credentials, '/products', { status: 'publish' }), storeCurrency(credentials)]);
    const products: MarketplaceProduct[] = items.flatMap((item) => {
      if (typeof item.id !== 'number' || typeof item.name !== 'string') return [];
      const amount = Number(item.price);
      return [
        {
          externalId: String(item.id),
          name: item.name,
          type: item.downloadable === true || item.virtual === true ? 'numérique' : String(item.type ?? 'produit'),
          isFree: amount === 0,
          price:
            Number.isFinite(amount) && amount > 0
              ? { formatted: currency ? formatMajor(amount, currency) : String(item.price), currency: currency ?? '' }
              : null,
        },
      ];
    });
    return { products, truncated };
  },

  async salesSummary(context, range) {
    const { items, truncated } = await collect(context.woocommerce!, '/orders', {
      status: 'any',
      after: `${range.from}T00:00:00`,
      before: `${range.to}T23:59:59`,
    });
    const sales = items.flatMap((item) =>
      typeof item.status === 'string' && PAID_STATUSES.has(item.status) && typeof item.currency === 'string'
        ? [{ amount: Number(item.total), currency: item.currency }]
        : [],
    );
    const summary: SalesSummary = {
      from: range.from,
      to: range.to,
      completedSales: sales.length,
      totalsByCurrency: totalsByCurrency(sales),
      truncated,
      source: 'WooCommerce',
      collectedAt: new Date().toISOString(),
    };
    return summary;
  },
};
