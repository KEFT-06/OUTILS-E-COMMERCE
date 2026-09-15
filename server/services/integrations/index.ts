import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { userIntegrations } from '@server/db/schema';
import { env } from '@server/env';
import { decryptSecret, encryptSecret } from '@server/lib/crypto';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { recordAuthEvent, type ClientInfo } from '@server/services/audit';
import { chariowRequest } from '@server/services/marketplaces/chariow';

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
  const [row] = await getDb()
    .select({ hint: userIntegrations.hint, verifiedAt: userIntegrations.verifiedAt })
    .from(userIntegrations)
    .where(and(eq(userIntegrations.userId, user.id), eq(userIntegrations.provider, 'chariow')))
    .limit(1);

  const adminKey = user.role === 'admin' && Boolean(env.CHARIOW_API_KEY);
  return {
    chariow: {
      connected: Boolean(row) || adminKey,
      source: row ? ('own' as const) : adminKey ? ('admin' as const) : null,
      hint: row?.hint ?? null,
      verifiedAt: row?.verifiedAt.toISOString() ?? null,
    },
  };
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
