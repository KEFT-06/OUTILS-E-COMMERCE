import { z } from 'zod';
import { env, isProd } from '@server/env';
import { AppError } from '@server/middleware';
import { formatMajor, totalsByCurrency } from '@server/services/marketplaces/money';
import type { MarketplaceAdapter, MarketplaceProduct, SalesSummary, ShopifyCredentials } from '@server/services/marketplaces/types';

/**
 * Connecteur Shopify — API Admin GraphQL, en lecture seule (catalogue et commandes payées).
 *
 * Deux façons d'obtenir l'accès, selon l'âge de l'application du vendeur :
 *  · jeton « shpat_… » d'une application créée dans l'administration Shopify AVANT le
 *    1er janvier 2026 (Shopify n'en laisse plus créer depuis) ;
 *  · identifiant et secret d'une application du Dev Dashboard, échangés contre un jeton de
 *    24 heures (« client credentials grant », shopify.dev, lu le 28 septembre 2026). Ce flux
 *    ne marche que si l'application et la boutique appartiennent à la même organisation.
 *
 * Portées nécessaires : read_products, read_orders. Aucune écriture.
 */

/** Dernière version stable publiée (shopify.dev/docs/api/usage/versioning, 28 septembre 2026). */
const API_VERSION = '2026-07';
const TIMEOUT_MS = 20_000;
const MAX_PAGES = 8;

export const shopifyDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/, 'Indiquez le domaine « votre-boutique.myshopify.com ».'));

/** Adresse de base : le vrai domaine, ou un faux serveur local pour les tests (hors production seulement). */
function baseUrl(shop: string): string {
  if (!isProd && env.SHOPIFY_TEST_BASE_URL) return env.SHOPIFY_TEST_BASE_URL.replace(/\/+$/, '');
  return `https://${shop}`;
}

/** Jetons temporaires du Dev Dashboard, gardés jusqu'à une heure avant leur fin. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessTokenFor(credentials: ShopifyCredentials): Promise<string> {
  if (credentials.accessToken) return credentials.accessToken;
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new AppError(400, 'Identifiants Shopify incomplets.', 'SHOPIFY_CREDENTIALS_MISSING');
  }
  const key = `${credentials.shop}:${credentials.clientId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  let response: Response;
  try {
    response = await fetch(`${baseUrl(credentials.shop)}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credentials.clientId, client_secret: credentials.clientSecret }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(502, 'Shopify ne répond pas pour le moment.', 'SHOPIFY_UNREACHABLE');
  }
  const payload = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string } | null;
  if (!response.ok || !payload?.access_token) {
    const reason = payload?.error === 'shop_not_permitted' ? ' L’application et la boutique doivent appartenir à la même organisation Shopify.' : '';
    throw new AppError(400, `Shopify refuse l’identifiant et le secret de cette application.${reason}`, 'SHOPIFY_ACCESS_DENIED');
  }
  const lifetime = Math.max(60, (payload.expires_in ?? 86_399) - 3_600) * 1000;
  tokenCache.set(key, { token: payload.access_token, expiresAt: Date.now() + lifetime });
  return payload.access_token;
}

async function graphql<T>(credentials: ShopifyCredentials, query: string, variables: Record<string, unknown>): Promise<T> {
  const token = await accessTokenFor(credentials);
  let response: Response;
  try {
    response = await fetch(`${baseUrl(credentials.shop)}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(502, 'Shopify ne répond pas pour le moment.', 'SHOPIFY_UNREACHABLE');
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError(400, 'Shopify refuse l’accès : vérifiez le jeton et les portées read_products et read_orders.', 'SHOPIFY_ACCESS_DENIED');
  }
  const payload = (await response.json().catch(() => null)) as { data?: T; errors?: unknown } | null;
  if (!response.ok || !payload?.data) {
    console.error('[shopify]', response.status, JSON.stringify(payload?.errors ?? '').slice(0, 300));
    throw new AppError(502, 'Réponse inattendue de Shopify.', 'SHOPIFY_BAD_RESPONSE');
  }
  return payload.data;
}

interface Page<N> {
  edges: { node: N }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

async function collect<N>(credentials: ShopifyCredentials, query: string, field: string, variables: Record<string, unknown> = {}) {
  const items: N[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: Record<string, Page<N> | undefined> = await graphql<Record<string, Page<N>>>(credentials, query, { ...variables, cursor });
    const connection: Page<N> | undefined = data[field];
    if (!connection) break;
    items.push(...connection.edges.map((edge: { node: N }) => edge.node));
    if (!connection.pageInfo.hasNextPage) return { items, truncated: false };
    cursor = connection.pageInfo.endCursor;
  }
  return { items, truncated: true };
}

const PRODUCTS_QUERY = `query Produits($cursor: String) {
  products(first: 100, after: $cursor, query: "status:active") {
    edges { node { id title productType priceRangeV2 { minVariantPrice { amount currencyCode } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ORDERS_QUERY = `query Commandes($cursor: String, $filtre: String) {
  orders(first: 250, after: $cursor, query: $filtre) {
    edges { node { currentTotalPriceSet { shopMoney { amount currencyCode } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

interface ProductNode {
  id: string;
  title: string;
  productType: string | null;
  priceRangeV2?: { minVariantPrice?: { amount: string; currencyCode: string } };
}

interface OrderNode {
  currentTotalPriceSet?: { shopMoney?: { amount: string; currencyCode: string } };
}

/** Vérification à l'enregistrement : une requête de lecture minimale. */
export async function verifyShopify(credentials: ShopifyCredentials): Promise<void> {
  await graphql(credentials, '{ shop { name } }', {});
}

export const shopifyAdapter: MarketplaceAdapter = {
  id: 'shopify',
  label: 'Shopify',
  capabilities: { readProducts: true, publishProducts: false, readSales: true },

  isAvailable(context) {
    return context.shopify
      ? { available: true }
      : { available: false, reason: 'Reliez votre boutique Shopify dans Mon compte → Connexions.' };
  },

  async listProducts(context) {
    const { items, truncated } = await collect<ProductNode>(context.shopify!, PRODUCTS_QUERY, 'products');
    const products: MarketplaceProduct[] = items.map((node) => {
      const price = node.priceRangeV2?.minVariantPrice;
      const amount = price ? Number(price.amount) : NaN;
      return {
        externalId: node.id,
        name: node.title,
        type: node.productType || 'produit',
        isFree: amount === 0,
        price: price && Number.isFinite(amount) && amount > 0 ? { formatted: formatMajor(amount, price.currencyCode), currency: price.currencyCode } : null,
      };
    });
    return { products, truncated };
  },

  async salesSummary(context, range) {
    const filtre = `created_at:>=${range.from} created_at:<=${range.to}T23:59:59Z financial_status:paid`;
    const { items, truncated } = await collect<OrderNode>(context.shopify!, ORDERS_QUERY, 'orders', { filtre });
    const sales = items.flatMap((node) => {
      const money = node.currentTotalPriceSet?.shopMoney;
      return money ? [{ amount: Number(money.amount), currency: money.currencyCode }] : [];
    });
    const summary: SalesSummary = {
      from: range.from,
      to: range.to,
      completedSales: sales.length,
      totalsByCurrency: totalsByCurrency(sales),
      truncated,
      source: 'Shopify',
      collectedAt: new Date().toISOString(),
    };
    return summary;
  },
};
