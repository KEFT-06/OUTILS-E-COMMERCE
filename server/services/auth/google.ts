import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, isUniqueViolation } from '@server/db/client';
import { users, type UserRow } from '@server/db/schema';
import { env, providers } from '@server/env';
import { randomToken } from '@server/lib/crypto';
import { AppError } from '@server/middleware';
import { createUserRecord } from '@server/services/accounts';
import { type ClientInfo, recordAuthEvent } from '@server/services/audit';
import { type LoginResult, finishLogin } from '@server/services/auth';

/**
 * « Continuer avec Google » : OAuth 2.0, flux « code d'autorisation » avec PKCE.
 *
 * Trois garde-fous, chacun contre une attaque précise :
 *  · `state`, gardé dans un cookie : une réponse de Google qui n'a pas été demandée par CE
 *    navigateur est refusée (connexion forcée sur le compte d'un tiers) ;
 *  · PKCE : un code d'autorisation intercepté ne sert à rien sans le vérificateur, resté ici ;
 *  · `nonce`, repris dans le jeton d'identité : un jeton rejoué d'une autre connexion est refusé.
 *
 * Un compte n'est relié QUE par une adresse vérifiée chez Google. Relier sur une adresse non
 * vérifiée livrerait le compte Smart Creator de cette adresse à qui l'a saisie chez Google.
 * Le second facteur reste exigé pour les comptes qui en ont un : Google remplace le mot de
 * passe, jamais la double authentification (voir `finishLogin`).
 */

export const GOOGLE_STATE_TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 15_000;
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export function googleAuthConfigured(): boolean {
  return providers.googleAuth;
}

export const googleRedirectUri = () => `${env.APP_URL.replace(/\/+$/, '')}/api/auth/google/callback`;

const base64url = (buffer: Buffer) => buffer.toString('base64url');

/** Ce que le navigateur garde, dans un cookie, entre le départ vers Google et le retour. */
export interface GoogleFlowState {
  state: string;
  verifier: string;
  nonce: string;
  /** Page où revenir après connexion : chemin interne seulement. */
  next: string;
}

/** Chemin de retour accepté : une page du site, jamais une adresse externe (redirection ouverte). */
export function safeNextPath(next: unknown): string {
  return typeof next === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) ? next : '/app/cockpit';
}

export function startGoogleFlow(next: unknown): { flow: GoogleFlowState; url: string } {
  const flow: GoogleFlowState = { state: randomToken(), verifier: randomToken(), nonce: randomToken(), next: safeNextPath(next) };
  const challenge = base64url(createHash('sha256').update(flow.verifier).digest());
  const url = new URL(env.GOOGLE_OAUTH_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return { flow, url: url.toString() };
}

const claimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().min(1).max(255),
  email: z.string().email(),
  email_verified: z.union([z.boolean(), z.literal('true'), z.literal('false')]),
  name: z.string().optional(),
  nonce: z.string().optional(),
  exp: z.number(),
});

export type GoogleClaims = z.infer<typeof claimsSchema>;

/**
 * Échange le code contre le jeton d'identité et en vérifie les affirmations.
 *
 * La signature du jeton n'est pas revérifiée, et c'est la recommandation de Google : le jeton
 * arrive DIRECTEMENT de son point de terminaison, en HTTPS, en échange de notre secret client
 * — il ne transite par aucun tiers (developers.google.com/identity/openid-connect, « Validating
 * an ID token »). Émetteur, destinataire, expiration et nonce le sont, eux.
 */
export async function exchangeGoogleCode(code: string, flow: GoogleFlowState): Promise<GoogleClaims> {
  let response: Response;
  try {
    response = await fetch(env.GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
        redirect_uri: googleRedirectUri(),
        grant_type: 'authorization_code',
        code_verifier: flow.verifier,
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(502, 'Google n’a pas répondu. Réessayez dans un instant.', 'GOOGLE_UNREACHABLE');
  }
  const payload = (await response.json().catch(() => null)) as { id_token?: string; error?: string } | null;
  if (!response.ok || !payload?.id_token) {
    console.error('[connexion Google] échange refusé :', response.status, payload?.error ?? '');
    throw new AppError(401, 'Google a refusé la connexion. Réessayez.', 'GOOGLE_EXCHANGE_FAILED');
  }

  const [, body] = payload.id_token.split('.');
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body ?? '', 'base64url').toString('utf8'));
  } catch {
    throw new AppError(401, 'Réponse de Google illisible.', 'GOOGLE_TOKEN_INVALID');
  }
  const parsed = claimsSchema.safeParse(decoded);
  if (!parsed.success) throw new AppError(401, 'Réponse de Google incomplète.', 'GOOGLE_TOKEN_INVALID');
  const claims = parsed.data;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!ISSUERS.has(claims.iss) || !audiences.includes(env.GOOGLE_OAUTH_CLIENT_ID!)) {
    throw new AppError(401, 'Ce jeton Google n’est pas destiné à Smart Creator.', 'GOOGLE_TOKEN_INVALID');
  }
  if (claims.exp * 1000 < Date.now()) throw new AppError(401, 'La connexion Google a expiré. Réessayez.', 'GOOGLE_TOKEN_EXPIRED');
  if (claims.nonce !== flow.nonce) throw new AppError(401, 'Connexion Google invalide. Réessayez.', 'GOOGLE_TOKEN_INVALID');
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new AppError(403, 'Votre adresse n’est pas vérifiée chez Google : connectez-vous avec votre mot de passe.', 'GOOGLE_EMAIL_UNVERIFIED');
  }
  return claims;
}

/**
 * Retrouve (ou crée) le compte de cette identité Google, puis termine la connexion comme un
 * mot de passe l'aurait fait — second facteur compris.
 *
 * Ordre de recherche : l'identifiant Google d'abord (stable), l'adresse ensuite (première
 * connexion par Google d'un compte existant, qui est alors relié). Un compte relié à un AUTRE
 * identifiant Google n'est pas repris par une adresse identique.
 */
export async function loginWithGoogle(claims: GoogleClaims, client: ClientInfo): Promise<LoginResult & { created: boolean }> {
  const db = getDb();
  const email = claims.email.trim().toLowerCase();
  let created = false;

  let [user]: (UserRow | undefined)[] = await db.select().from(users).where(eq(users.googleSub, claims.sub)).limit(1);
  if (!user) {
    const [byEmail] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (byEmail) {
      if (byEmail.googleSub && byEmail.googleSub !== claims.sub) {
        throw new AppError(409, 'Ce compte est déjà relié à un autre compte Google.', 'GOOGLE_ACCOUNT_MISMATCH');
      }
      const [linked] = await db
        .update(users)
        .set({ googleSub: claims.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(), updatedAt: new Date() })
        .where(eq(users.id, byEmail.id))
        .returning();
      user = linked;
      await recordAuthEvent('google_linked', { userId: byEmail.id, email, client });
    }
  }

  if (!user) {
    const name = (claims.name ?? '').trim().slice(0, 80) || email.split('@')[0]!.slice(0, 80);
    try {
      const fresh = await createUserRecord({ name: name.length >= 2 ? name : 'Créateur', email, passwordHash: null, role: 'user', country: null });
      const [withGoogle] = await db
        .update(users)
        .set({ googleSub: claims.sub, emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, fresh.id))
        .returning();
      user = withGoogle;
      created = true;
      await recordAuthEvent('signup', { userId: fresh.id, email, client, details: { method: 'google' } });
    } catch (error) {
      // Deux retours de Google simultanés pour la même adresse : le second retrouve le compte.
      if (!isUniqueViolation(error)) throw error;
      [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    }
  }
  if (!user) throw new AppError(500, 'Compte introuvable après la connexion Google.', 'ACCOUNT_MISSING');

  return { ...(await finishLogin(user, client)), created };
}
