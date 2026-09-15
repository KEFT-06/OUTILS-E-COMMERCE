import type { Response } from 'express';
import { and, eq, ne } from 'drizzle-orm';
import { getDb, type Executor } from '@server/db/client';
import { sessions, users, type SessionRow, type UserRow } from '@server/db/schema';
import { isProd } from '@server/env';
import { authCookieOptions, clearAuthCookie } from '@server/lib/cookies';
import { randomToken, sha256 } from '@server/lib/crypto';
import type { ClientInfo } from '@server/services/audit';

/**
 * Sessions stockées en base, référencées par un cookie httpOnly.
 *
 * Préférées à un jeton JWT autoporté : une session en base se révoque à l'instant
 * (déconnexion, suspension, changement de mot de passe), et c'est elle qui permet
 * de voir qui est connecté. Le préfixe `__Host-` en production interdit à un
 * sous-domaine d'écraser le cookie.
 */

export const SESSION_COOKIE = isProd ? '__Host-sc_session' : 'sc_session';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Un compte qui détient des privilèges d'administration a des sessions plus courtes. */
export const SESSION_POLICIES = {
  member: { absoluteMs: 30 * DAY_MS, idleMs: 7 * DAY_MS },
  staff: { absoluteMs: 12 * HOUR_MS, idleMs: 2 * HOUR_MS },
} as const;

/** L'activité n'est réécrite qu'une fois par minute : une écriture par requête serait du gaspillage. */
const TOUCH_INTERVAL_MS = 60_000;

/** Fenêtre au-delà de laquelle un utilisateur n'est plus compté « en ligne ». */
export const ONLINE_WINDOW_MS = 5 * 60_000;

export async function createSession(
  input: { userId: string; staff: boolean; mfaVerified: boolean; client: ClientInfo },
  executor: Executor = getDb(),
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const policy = input.staff ? SESSION_POLICIES.staff : SESSION_POLICIES.member;
  const token = randomToken();
  const sessionId = sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + policy.absoluteMs);

  await executor.insert(sessions).values({
    id: sessionId,
    userId: input.userId,
    mfaVerified: input.mfaVerified,
    ipAddress: input.client.ipAddress,
    userAgent: input.client.userAgent,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });

  return { token, sessionId, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, authCookieOptions(expiresAt.getTime() - Date.now()));
}

export function clearSessionCookie(res: Response): void {
  clearAuthCookie(res, SESSION_COOKIE);
}

function idleLimitMs(session: SessionRow): number {
  const lifetime = session.expiresAt.getTime() - session.createdAt.getTime();
  return lifetime <= SESSION_POLICIES.staff.absoluteMs ? SESSION_POLICIES.staff.idleMs : SESSION_POLICIES.member.idleMs;
}

/** Session valide et son compte, ou null. Une session expirée est supprimée au passage. */
export async function resolveSession(
  token: string,
  now = new Date(),
): Promise<{ session: SessionRow; user: UserRow } | null> {
  if (token.length < 20 || token.length > 100) return null;

  const db = getDb();
  const sessionId = sha256(token);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!row) return null;

  const { session } = row;
  const idle = now.getTime() - session.lastSeenAt.getTime();
  if (session.expiresAt <= now || idle > idleLimitMs(session)) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  if (idle > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sessionId));
    session.lastSeenAt = now;
  }

  return row;
}

export async function revokeSession(sessionId: string, executor: Executor = getDb()): Promise<void> {
  await executor.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Révoque toutes les sessions d'un compte, sauf éventuellement la session courante. Renvoie leur nombre. */
export async function revokeUserSessions(
  userId: string,
  options: { exceptSessionId?: string } = {},
  executor: Executor = getDb(),
): Promise<number> {
  const condition = options.exceptSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.id, options.exceptSessionId))
    : eq(sessions.userId, userId);
  const revoked = await executor.delete(sessions).where(condition).returning({ id: sessions.id });
  return revoked.length;
}
