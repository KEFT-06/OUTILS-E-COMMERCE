import type { Response } from 'express';
import { and, eq, inArray, isNull, lt, lte, ne, notExists, sql, type SQL } from 'drizzle-orm';
import { getDb, type Executor } from '@server/db/client';
import { sessionHistory, sessions, users, type SessionRow, type UserRow } from '@server/db/schema';
import { isProd } from '@server/env';
import { authCookieOptions, clearAuthCookie } from '@server/lib/cookies';
import { randomToken, sha256 } from '@server/lib/crypto';
import { describeDevice, maskIp } from '@server/lib/device';
import type { ClientInfo } from '@server/services/audit';
import type { SessionEndReason } from '@server/shared/sessions';

/**
 * Sessions stockées en base, référencées par un cookie httpOnly.
 *
 * Préférées à un jeton JWT autoporté : une session en base se révoque à l'instant
 * (déconnexion, blocage, changement de mot de passe), et c'est elle qui permet
 * de voir qui est connecté. Le préfixe `__Host-` en production interdit à un
 * sous-domaine d'écraser le cookie.
 *
 * Chaque session laisse aussi une ligne dans `session_history`, conservée après
 * sa fin : heure de connexion, dernière activité, heure et raison de la
 * déconnexion. Toute fin de session passe donc par ce module.
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

/** Durée de conservation de l'historique des connexions, comptée depuis la déconnexion. */
export const SESSION_HISTORY_RETENTION_DAYS = 365;

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

  // L'historique ne garde que l'appareil lisible et l'adresse IP tronquée.
  await executor.insert(sessionHistory).values({
    sessionId,
    userId: input.userId,
    device: describeDevice(input.client.userAgent),
    ipMasked: maskIp(input.client.ipAddress),
    startedAt: now,
    lastSeenAt: now,
  });

  return { token, sessionId, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, authCookieOptions(expiresAt.getTime() - Date.now()));
}

export function clearSessionCookie(res: Response): void {
  clearAuthCookie(res, SESSION_COOKIE);
}

type SessionTimes = Pick<SessionRow, 'id' | 'createdAt' | 'lastSeenAt' | 'expiresAt'>;

function idleLimitMs(session: Pick<SessionRow, 'createdAt' | 'expiresAt'>): number {
  const lifetime = session.expiresAt.getTime() - session.createdAt.getTime();
  return lifetime <= SESSION_POLICIES.staff.absoluteMs ? SESSION_POLICIES.staff.idleMs : SESSION_POLICIES.member.idleMs;
}

/**
 * Heure de déconnexion retenue. Un site ne sait pas quand un onglet se ferme :
 * sans geste de la personne, c'est sa dernière activité qui compte, sauf si elle
 * était encore active quand la session a atteint sa durée maximale.
 */
function endMoment(reason: SessionEndReason, session: SessionTimes, now: Date): Date {
  if (reason === 'idle') return session.lastSeenAt;
  if (reason === 'expired') {
    const end = session.expiresAt < now ? session.expiresAt : now;
    return end.getTime() - session.lastSeenAt.getTime() <= ONLINE_WINDOW_MS ? end : session.lastSeenAt;
  }
  return now;
}

/** Supprime les sessions visées et clôt leur ligne d'historique. Renvoie leur nombre. */
async function endSessions(
  condition: SQL | undefined,
  reason: SessionEndReason,
  executor: Executor,
  now = new Date(),
): Promise<number> {
  const ended = await executor.delete(sessions).where(condition).returning({
    id: sessions.id,
    createdAt: sessions.createdAt,
    lastSeenAt: sessions.lastSeenAt,
    expiresAt: sessions.expiresAt,
  });

  for (const session of ended) {
    // Sans condition sur `ended_at` : seule la requête qui a supprimé la session arrive
    // ici, et sa raison l'emporte sur une clôture provisoire du balayage.
    await executor
      .update(sessionHistory)
      .set({ endedAt: endMoment(reason, session, now), endReason: reason, lastSeenAt: session.lastSeenAt })
      .where(eq(sessionHistory.sessionId, session.id));
  }
  return ended.length;
}

/** Session valide et son compte, ou null. Une session expirée est close au passage. */
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
    await endSessions(eq(sessions.id, sessionId), session.expiresAt <= now ? 'expired' : 'idle', db, now);
    return null;
  }

  if (idle > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sessionId));
    await db.update(sessionHistory).set({ lastSeenAt: now }).where(eq(sessionHistory.sessionId, sessionId));
    session.lastSeenAt = now;
  }

  return row;
}

export async function revokeSession(sessionId: string, reason: SessionEndReason, executor: Executor = getDb()): Promise<void> {
  await endSessions(eq(sessions.id, sessionId), reason, executor);
}

/** Révoque toutes les sessions d'un compte, sauf éventuellement la session courante. Renvoie leur nombre. */
export async function revokeUserSessions(
  userId: string,
  options: { exceptSessionId?: string; reason: SessionEndReason },
  executor: Executor = getDb(),
): Promise<number> {
  const condition = options.exceptSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.id, options.exceptSessionId))
    : eq(sessions.userId, userId);
  return endSessions(condition, options.reason, executor);
}

/**
 * Clôt les sessions expirées ou inactives que plus personne ne présente (onglet
 * fermé sans déconnexion), rattrape les lignes d'historique restées ouvertes et
 * efface l'historique au-delà de la durée de conservation.
 */
export async function sweepSessions(now = new Date()): Promise<{ ended: number; reconciled: number; purged: number }> {
  const db = getDb();
  let ended = await endSessions(lte(sessions.expiresAt, now), 'expired', db, now);

  // La plus courte limite d'inactivité filtre en base ; la règle exacte s'applique ensuite.
  const candidates = await db
    .select({ id: sessions.id, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(lt(sessions.lastSeenAt, new Date(now.getTime() - SESSION_POLICIES.staff.idleMs)))
    .limit(500);
  const idleIds = candidates.filter((session) => now.getTime() - session.lastSeenAt.getTime() > idleLimitMs(session)).map((session) => session.id);
  if (idleIds.length > 0) ended += await endSessions(inArray(sessions.id, idleIds), 'idle', db, now);

  const reconciled = await db
    .update(sessionHistory)
    .set({ endedAt: sql`${sessionHistory.lastSeenAt}`, endReason: 'expired' })
    .where(
      and(
        isNull(sessionHistory.endedAt),
        notExists(db.select({ one: sql`1` }).from(sessions).where(eq(sessions.id, sessionHistory.sessionId))),
      ),
    )
    .returning({ id: sessionHistory.id });

  const purged = await db
    .delete(sessionHistory)
    .where(lt(sessionHistory.endedAt, new Date(now.getTime() - SESSION_HISTORY_RETENTION_DAYS * DAY_MS)))
    .returning({ id: sessionHistory.id });

  return { ended, reconciled: reconciled.length, purged: purged.length };
}

/** Lance le balayage des sessions (au démarrage, puis périodiquement). Renvoie la fonction d'arrêt. */
export function startSessionSweeper(intervalMs = 5 * 60_000): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    sweepSessions()
      .catch((error: unknown) => console.error('[sessions] balayage interrompu :', error))
      .finally(() => {
        running = false;
      });
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
