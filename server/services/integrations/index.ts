import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { userIntegrations } from '@server/db/schema';
import { env } from '@server/env';
import { decryptSecret, encryptSecret } from '@server/lib/crypto';
import { assertPublicUrl } from '@server/lib/publicUrl';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { recordAuthEvent, type ClientInfo } from '@server/services/audit';
import { chariowRequest } from '@server/services/marketplaces/chariow';
import { shopifyDomainSchema, verifyShopify } from '@server/services/marketplaces/shopify';
import type { MarketplaceContext, ShopifyCredentials, WooCommerceCredentials } from '@server/services/marketplaces/types';
import { verifyWooCommerce, wooKeySchema } from '@server/services/marketplaces/woocommerce';

/**
 * Clés API personnelles.
 *
 * Chariow : chaque utilisateur branche SA boutique avec SA clé. La clé du serveur
 * (CHARIOW_API_KEY) appartient au propriétaire de Smart Creator et ne sert qu'aux
 * comptes administrateurs : elle ouvre les ventes et les clients d'une boutique
 * réelle, et aucun autre compte ne doit y accéder.
 *
 * Une clé enregistrée est vérifiée auprès de Chariow, chiffrée en AES-256-GCM,
 * et ne repart jamais vers le navigateur : seuls ses quatre derniers caractères
 * sont montrés à son propriétaire.
 */

export const chariowKeySchema = z
  .string()
  .trim()
  .regex(/^sk_[A-Za-z0-9_-]{16,200}$/, 'Clé API Chariow invalide : elle commence par « sk_ ».');

export type ChariowKeySource = 'own' | 'admin';

export async function resolveChariowCredentials(
  auth: RequestAuth | undefined,
): Promise<{ apiKey: string; source: ChariowKeySource } | null> {
  if (!auth) return null;

  const [row] = await getDb()
    .select({ secret: userIntegrations.secret })
    .from(userIntegrations)
    .where(and(eq(userIntegrations.userId, auth.account.user.id), eq(userIntegrations.provider, 'chariow')))
    .limit(1);
  if (row) return { apiKey: decryptSecret(row.secret), source: 'own' };

  if (auth.account.user.role === 'admin' && env.CHARIOW_API_KEY) {
    return { apiKey: env.CHARIOW_API_KEY, source: 'admin' };
  }
  return null;
}

export async function integrationsOverview(user: { id: string; role: 'user' | 'admin' }) {
  const rows = await getDb()
    .select({ provider: userIntegrations.provider, hint: userIntegrations.hint, label: userIntegrations.label, verifiedAt: userIntegrations.verifiedAt })
    .from(userIntegrations)
    .where(eq(userIntegrations.userId, user.id));
  const of = (provider: string) => rows.find((row) => row.provider === provider);
  const row = of('chariow');
  const shop = (provider: StoreProvider) => {
    const found = of(provider);
    return { connected: Boolean(found), label: found?.label ?? null, hint: found?.hint ?? null, verifiedAt: found?.verifiedAt.toISOString() ?? null };
  };

  const adminKey = user.role === 'admin' && Boolean(env.CHARIOW_API_KEY);
  return {
    chariow: {
      connected: Boolean(row) || adminKey,
      source: row ? ('own' as const) : adminKey ? ('admin' as const) : null,
      hint: row?.hint ?? null,
      verifiedAt: row?.verifiedAt.toISOString() ?? null,
    },
    shopify: shop('shopify'),
    woocommerce: shop('woocommerce'),
  };
}

/* -------------------------------------------------------------------------- */
/*  Boutiques Shopify et WooCommerce                                           */
/* -------------------------------------------------------------------------- */

/**
 * Clés des boutiques du vendeur sur d'autres services. Même règle que Chariow : vérifiées
 * auprès du service avant d'être gardées, chiffrées en AES-256-GCM, jamais renvoyées au
 * navigateur (seuls la boutique et les quatre derniers caractères le sont).
 */
export const STORE_PROVIDERS = ['shopify', 'woocommerce'] as const;
export type StoreProvider = (typeof STORE_PROVIDERS)[number];

export const shopifyKeySchema = z
  .object({
    shop: shopifyDomainSchema,
    accessToken: z.string().trim().regex(/^shpat_[A-Za-z0-9]{20,100}$/, 'Le jeton d’accès commence par « shpat_ ».').optional(),
    clientId: z.string().trim().min(10).max(200).optional(),
    clientSecret: z.string().trim().min(10).max(300).optional(),
  })
  .refine((value) => Boolean(value.accessToken) || Boolean(value.clientId && value.clientSecret), {
    message: 'Indiquez soit le jeton d’accès (shpat_…), soit l’identifiant et le secret de l’application.',
  });

export async function saveStoreKey(auth: RequestAuth, provider: StoreProvider, input: unknown, client: ClientInfo) {
  let credentials: ShopifyCredentials | WooCommerceCredentials;
  let label: string;
  let hint: string;
  if (provider === 'shopify') {
    const parsed = shopifyKeySchema.safeParse(input);
    if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message ?? 'Identifiants Shopify invalides.', 'VALIDATION_ERROR');
    credentials = parsed.data.accessToken
      ? { shop: parsed.data.shop, accessToken: parsed.data.accessToken }
      : { shop: parsed.data.shop, clientId: parsed.data.clientId, clientSecret: parsed.data.clientSecret };
    await verifyShopify(credentials);
    label = parsed.data.shop;
    hint = (parsed.data.accessToken ?? parsed.data.clientSecret!).slice(-4);
  } else {
    const parsed = wooKeySchema.safeParse(input);
    if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message ?? 'Clés WooCommerce invalides.', 'VALIDATION_ERROR');
    const site = await assertPublicUrl(parsed.data.siteUrl, 'L’adresse du site');
    credentials = { ...parsed.data, siteUrl: `${site.origin}${site.pathname.replace(/\/+$/, '')}` };
    await verifyWooCommerce(credentials);
    label = credentials.siteUrl;
    hint = parsed.data.consumerSecret.slice(-4);
  }

  const now = new Date();
  const values = { secret: encryptSecret(JSON.stringify(credentials)), hint, label, verifiedAt: now, updatedAt: now };
  await getDb()
    .insert(userIntegrations)
    .values({ userId: auth.account.user.id, provider, ...values })
    .onConflictDoUpdate({ target: [userIntegrations.userId, userIntegrations.provider], set: values });
  await recordAuthEvent('integration_saved', { userId: auth.account.user.id, email: auth.account.user.email, client, details: { provider } });
  return integrationsOverview(auth.account.user);
}

export async function removeStoreKey(auth: RequestAuth, provider: StoreProvider, client: ClientInfo) {
  const removed = await getDb()
    .delete(userIntegrations)
    .where(and(eq(userIntegrations.userId, auth.account.user.id), eq(userIntegrations.provider, provider)))
    .returning({ userId: userIntegrations.userId });
  if (removed.length > 0) {
    await recordAuthEvent('integration_removed', { userId: auth.account.user.id, email: auth.account.user.email, client, details: { provider } });
  }
  return integrationsOverview(auth.account.user);
}

/** Identifiants de toutes les boutiques reliées du compte, pour les connecteurs. */
export async function resolveMarketplaceContext(auth: RequestAuth | undefined): Promise<MarketplaceContext> {
  const chariow = await resolveChariowCredentials(auth);
  if (!auth) return { chariowApiKey: null, shopify: null, woocommerce: null };
  const rows = await getDb()
    .select({ provider: userIntegrations.provider, secret: userIntegrations.secret })
    .from(userIntegrations)
    .where(and(eq(userIntegrations.userId, auth.account.user.id), inArray(userIntegrations.provider, [...STORE_PROVIDERS])));
  const read = <T>(provider: StoreProvider): T | null => {
    const row = rows.find((entry) => entry.provider === provider);
    if (!row) return null;
    try {
      return JSON.parse(decryptSecret(row.secret)) as T;
    } catch {
      return null;
    }
  };
  return { chariowApiKey: chariow?.apiKey ?? null, shopify: read<ShopifyCredentials>('shopify'), woocommerce: read<WooCommerceCredentials>('woocommerce') };
}

export async function saveChariowKey(auth: RequestAuth, apiKey: string, client: ClientInfo) {
  // Vérification en lecture seule : un catalogue d'un seul produit.
  try {
    await chariowRequest(apiKey, '/products', { query: { per_page: '1' } });
  } catch (error) {
    if (error instanceof AppError && error.code === 'CHARIOW_ACCESS_DENIED') {
      throw new AppError(
        400,
        'Chariow refuse cette clé API. Vérifiez-la dans app.chariow.com → Paramètres → Clés API.',
        'CHARIOW_KEY_REJECTED',
      );
    }
    throw error;
  }

  const now = new Date();
  const values = {
    secret: encryptSecret(apiKey),
    hint: apiKey.slice(-4),
    verifiedAt: now,
    updatedAt: now,
  };
  await getDb()
    .insert(userIntegrations)
    .values({ userId: auth.account.user.id, provider: 'chariow', ...values })
    .onConflictDoUpdate({ target: [userIntegrations.userId, userIntegrations.provider], set: values });

  await recordAuthEvent('integration_saved', {
    userId: auth.account.user.id,
    email: auth.account.user.email,
    client,
    details: { provider: 'chariow' },
  });
  return integrationsOverview(auth.account.user);
}

export async function removeChariowKey(auth: RequestAuth, client: ClientInfo) {
  const removed = await getDb()
    .delete(userIntegrations)
    .where(and(eq(userIntegrations.userId, auth.account.user.id), eq(userIntegrations.provider, 'chariow')))
    .returning({ userId: userIntegrations.userId });

  if (removed.length > 0) {
    await recordAuthEvent('integration_removed', {
      userId: auth.account.user.id,
      email: auth.account.user.email,
      client,
      details: { provider: 'chariow' },
    });
  }
  return integrationsOverview(auth.account.user);
}
