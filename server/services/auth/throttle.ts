import { eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { authThrottles } from '@server/db/schema';

/**
 * Protection contre la force brute et le bourrage d'identifiants.
 *
 * Deux compteurs par tentative échouée :
 *  - par adresse e-mail, qu'un compte existe ou non : la réponse est la même dans
 *    les deux cas, donc un attaquant n'apprend pas quelles adresses sont inscrites ;
 *  - par adresse IP, avec un seuil beaucoup plus haut : les opérateurs mobiles
 *    partagent souvent une adresse entre des milliers d'abonnés (CGNAT), et un
 *    seuil bas bloquerait tout un quartier.
 *
 * Le verrou s'allonge à chaque palier franchi. Il est vérifié AVANT le mot de
 * passe : pendant un verrou, même le bon mot de passe est refusé, sinon le verrou
 * ne ralentirait rien.
 */

export interface ThrottlePolicy {
  /** Un verrou tombe tous les `threshold` échecs. */
  threshold: number;
  /** Durée du 1er, du 2e, puis de chaque verrou suivant. */
  lockSeconds: readonly number[];
}

export const EMAIL_POLICY: ThrottlePolicy = { threshold: 5, lockSeconds: [15 * 60, 60 * 60, 24 * 60 * 60] };
export const IP_POLICY: ThrottlePolicy = { threshold: 50, lockSeconds: [15 * 60, 60 * 60, 6 * 60 * 60] };

/** Sans nouvel échec pendant 24 h, le compteur repart de zéro. */
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;

export const emailThrottleKey = (email: string) => `email:${email}`;
export const ipThrottleKey = (ip: string | null) => `ip:${ip ?? 'inconnue'}`;

/** Secondes de verrou restantes sur la plus contraignante des clés ; 0 si aucune n'est verrouillée. */
export async function lockedFor(keys: string[], now = new Date()): Promise<number> {
  const rows = await getDb()
    .select({ lockedUntil: authThrottles.lockedUntil })
    .from(authThrottles)
    .where(inArray(authThrottles.key, keys));

  return rows.reduce((longest, row) => {
    const remaining = row.lockedUntil ? Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000) : 0;
    return Math.max(longest, remaining);
  }, 0);
}

/**
 * Compte un échec, de façon atomique (deux tentatives simultanées ne peuvent pas
 * se compter une seule fois). Renvoie la durée du verrou posé, ou 0.
 */
export async function registerFailure(key: string, policy: ThrottlePolicy, now = new Date()): Promise<number> {
  const db = getDb();
  const forgetBefore = new Date(now.getTime() - FORGET_AFTER_MS).toISOString();

  const [row] = await db
    .insert(authThrottles)
    .values({ key, failures: 1, lastFailureAt: now })
    .onConflictDoUpdate({
      target: authThrottles.key,
      set: {
        failures: sql`CASE WHEN ${authThrottles.lastFailureAt} < ${forgetBefore}::timestamptz THEN 1 ELSE ${authThrottles.failures} + 1 END`,
        lastFailureAt: now,
      },
    })
    .returning({ failures: authThrottles.failures });

  const failures = row?.failures ?? 1;
  if (failures % policy.threshold !== 0) return 0;

  const level = Math.min(failures / policy.threshold - 1, policy.lockSeconds.length - 1);
  const seconds = policy.lockSeconds[level]!;
  await db
    .update(authThrottles)
    .set({ lockedUntil: new Date(now.getTime() + seconds * 1000) })
    .where(eq(authThrottles.key, key));
  return seconds;
}

export async function clearFailures(key: string): Promise<void> {
  await getDb().delete(authThrottles).where(eq(authThrottles.key, key));
}
