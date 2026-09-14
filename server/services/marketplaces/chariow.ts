import { z } from 'zod';
import { env } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';
import {
  CurrencyTotal,
  MarketplaceAdapter,
  MarketplaceProduct,
  SalesSummary,
} from '@server/services/marketplaces/types';

/**
 * Connecteur Chariow — feuille de route 5.2, gabarit de référence.
 *
 * ⚠️ Écrit d'après la documentation publique (chariow.dev), consultée le
 * 14 septembre 2026, et NON vérifié contre l'API réelle faute de clé.
 *
 * Montants : l'exemple de `GET /sales/{id}` montre `"value": 79.20` pour
 * « $79.20 » — des unités principales, comme pour les produits. Un premier résumé
 * de la page de liste évoquait des unités mineures ; l'exemple chiffré fait foi.
 * C'est le premier point à confirmer sur une vraie réponse : une erreur fausserait
 * le chiffre d'affaires d'un facteur 100.
 *
 * Ce que l'API permet, et ce qu'elle ne permet pas :
 *  - lecture des produits et des ventes (ainsi que clients, remises, licences) ;
 *  - AUCUN endpoint de création ou de publication de produit. Ce connecteur ne
 *    peut donc pas « publier sur Chariow » : il importe le catalogue existant et
 *    remonte les ventes réelles.
 *
 * Données personnelles : les ventes portent l'e-mail et le nom du client. Elles
 * ne sont lues que pour être agrégées ; rien d'autre que des totaux n'en sort.
 */

const BASE_URL = env.CHARIOW_API_URL;
const REQUEST_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 100;
/** La documentation limite à 100 requêtes par minute par clé : la pagination reste loin en dessous. */
const MAX_PAGES = 20;
/**
 * Statuts documentés d'une vente payée : « completed » (paiement réussi) puis
 * « settled » (fonds reversés au vendeur). Les deux sont comptés, une vente ne
 * portant qu'un seul statut à la fois.
 */
const REVENUE_STATUSES = new Set(['completed', 'settled']);

const moneySchema = z.object({
  value: z.number(),
  formatted: z.string().optional(),
  currency: z.string().min(3).max(3),
});

const paginationSchema = z.object({
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean().optional(),
});

const productSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.string(),
  is_free: z.boolean().optional(),
  pricing: z
    .object({
      current_price: moneySchema.nullable().optional(),
      price: moneySchema.nullable().optional(),
    })
    .optional(),
});

const saleSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount: moneySchema,
});

function unexpectedResponse(): AppError {
  return new AppError(502, 'Réponse inattendue de Chariow.', 'CHARIOW_UNEXPECTED_RESPONSE');
}

/**
 * La documentation montre l'enveloppe `{ data: { data: [...], pagination } }`
 * pour les produits ; on accepte aussi `{ data: [...], pagination }`, pour ne pas
 * casser si une liste suit l'autre forme.
 */
function unwrapList(payload: unknown): { items: unknown[]; nextCursor: string | null } {
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) throw unexpectedResponse();

  const root = payload as { data: unknown; pagination?: unknown };
  const list = Array.isArray(root.data)
    ? { items: root.data, pagination: root.pagination }
    : typeof root.data === 'object' && root.data !== null && Array.isArray((root.data as { data?: unknown }).data)
      ? {
          items: (root.data as { data: unknown[] }).data,
          pagination: (root.data as { pagination?: unknown }).pagination,
        }
      : null;

  if (!list) throw unexpectedResponse();

  const pagination = paginationSchema.safeParse(list.pagination ?? {});
  const nextCursor =
    pagination.success && pagination.data.has_more ? (pagination.data.next_cursor ?? null) : null;

  return { items: list.items, nextCursor };
}

function chariowFailure(status: number): AppError {
  if (status === 401 || status === 403) {
    return new AppError(503, "L'accès à Chariow est refusé : clé API invalide sur le serveur.", 'CHARIOW_ACCESS_DENIED');
  }
  if (status === 404) {
    return new AppError(404, 'Ressource introuvable chez Chariow.', 'CHARIOW_NOT_FOUND');
  }
  if (status === 422) {
    return new AppError(400, 'Chariow a refusé la demande : données invalides.', 'CHARIOW_VALIDATION_ERROR');
  }
  if (status === 429) {
    return new AppError(
      429,
      'Chariow limite temporairement le nombre de requêtes. Réessayez dans une minute.',
      'CHARIOW_RATE_LIMITED',
    );
  }
  return new AppError(502, 'Chariow est momentanément indisponible.', 'CHARIOW_UNAVAILABLE');
}

/** Appel authentifié à l'API Chariow, partagé par le catalogue, les ventes et l'affiliation. */
export async function chariowRequest(
  path: string,
  options: { method?: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown } = {},
): Promise<unknown> {
  const apiKey = env.CHARIOW_API_KEY;
  if (!apiKey) throw providerUnavailable('Chariow');

  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(options.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));

  const hasBody = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Après un délai dépassé sur un envoi, on ne sait pas s'il a eu lieu : le
    // relancer pourrait envoyer deux fois les mêmes e-mails.
    throw options.method === 'POST'
      ? new AppError(
          504,
          "Chariow n'a pas répondu à temps : l'envoi a peut-être eu lieu, ne le relancez pas immédiatement.",
          'CHARIOW_SUBMISSION_UNCERTAIN',
        )
      : new AppError(502, 'Chariow est injoignable.', 'CHARIOW_UNREACHABLE');
  }

  if (!response.ok) throw chariowFailure(response.status);
  return response.json();
}

function getPage(path: string, query: Record<string, string>): Promise<unknown> {
  return chariowRequest(path, { query });
}

/** Parcourt une liste paginée par curseur, dans la limite de `MAX_PAGES`. */
async function collect(
  path: string,
  query: Record<string, string>,
): Promise<{ items: unknown[]; truncated: boolean }> {
  const items: unknown[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await getPage(path, {
      ...query,
      per_page: String(PAGE_SIZE),
      ...(cursor ? { cursor } : {}),
    });
    const { items: pageItems, nextCursor } = unwrapList(payload);
    items.push(...pageItems);
    if (!nextCursor) return { items, truncated: false };
    cursor = nextCursor;
  }

  return { items, truncated: true };
}

/** Nombre de décimales d'une devise : 0 pour le franc CFA, 2 pour l'euro. */
function currencyExponent(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

function formatMinor(amountMinor: number, currency: string): string {
  const value = amountMinor / 10 ** currencyExponent(currency);
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toLocaleString('fr-FR')} ${currency}`;
  }
}

export const chariowAdapter: MarketplaceAdapter = {
  id: 'chariow',
  label: 'Chariow',
  capabilities: { readProducts: true, publishProducts: false, readSales: true },

  isAvailable() {
    return env.CHARIOW_API_KEY
      ? { available: true }
      : {
          available: false,
          reason: 'Clé API Chariow non configurée sur le serveur (app.chariow.com → Paramètres → Clés API).',
        };
  },

  async listProducts() {
    const { items, truncated } = await collect('/products', {});

    const products: MarketplaceProduct[] = items.flatMap((item) => {
      const parsed = productSchema.safeParse(item);
      if (!parsed.success) return [];

      const product = parsed.data;
      const price = product.pricing?.current_price ?? product.pricing?.price ?? null;

      return [
        {
          externalId: product.id,
          name: product.name,
          type: product.type,
          isFree: product.is_free ?? false,
          price: price
            ? {
                formatted: price.formatted ?? `${price.value.toLocaleString('fr-FR')} ${price.currency}`,
                currency: price.currency,
              }
            : null,
        },
      ];
    });

    return { products, truncated };
  },

  async salesSummary(range) {
    const { items, truncated } = await collect('/sales', { start_date: range.from, end_date: range.to });

    const totals = new Map<string, { amountMinor: number; salesCount: number }>();
    let completedSales = 0;

    for (const item of items) {
      const parsed = saleSchema.safeParse(item);
      if (!parsed.success || !REVENUE_STATUSES.has(parsed.data.status)) continue;

      completedSales += 1;
      const { currency, value } = parsed.data.amount;
      // Montant en unités principales, converti en unités mineures entières :
      // additionner des décimaux accumulerait des erreurs d'arrondi flottant.
      const amountMinor = Math.round(value * 10 ** currencyExponent(currency));
      const current = totals.get(currency) ?? { amountMinor: 0, salesCount: 0 };
      totals.set(currency, {
        amountMinor: current.amountMinor + amountMinor,
        salesCount: current.salesCount + 1,
      });
    }

    const totalsByCurrency: CurrencyTotal[] = [...totals.entries()].map(([currency, total]) => ({
      currency,
      amountMinor: total.amountMinor,
      formatted: formatMinor(total.amountMinor, currency),
      salesCount: total.salesCount,
    }));

    const summary: SalesSummary = {
      from: range.from,
      to: range.to,
      completedSales,
      totalsByCurrency,
      truncated,
      source: 'Chariow',
      collectedAt: new Date().toISOString(),
    };
    return summary;
  },
};
