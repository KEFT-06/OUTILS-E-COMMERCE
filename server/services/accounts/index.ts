import { eq } from 'drizzle-orm';
import { getDb, inTransaction, isUniqueViolation, type Transaction } from '@server/db/client';
import {
  creditTransactions,
  featureOverrides,
  userPermissions,
  users,
  type PlanId,
  type UserRow,
} from '@server/db/schema';
import { providers } from '@server/env';
import { AppError } from '@server/middleware';
import { effectivePermissions, type Permission } from '@server/services/auth/permissions';
import {
  UNLIMITED,
  getPlan,
  resolveFeatures,
  type FeatureId,
  type PlanDefinition,
  type PlanLimits,
} from '@server/services/plans';

/**
 * Comptes : palier, crédits et droits effectifs.
 *
 * Le solde a deux compartiments :
 *  - les points du palier, rechargés au quota à chaque cycle mensuel ;
 *  - les points bonus (recharges d'un administrateur, remboursements), qui
 *    n'expirent pas.
 * Une action consomme d'abord les points du palier. Chaque mouvement laisse une
 * ligne dans `credit_transactions` : un solde doit toujours pouvoir s'expliquer.
 */

export interface AccountSnapshot {
  user: UserRow;
  plan: PlanDefinition;
  permissions: Permission[];
  overrides: { feature: string; access: 'granted' | 'revoked' }[];
  features: Record<FeatureId, boolean>;
  /** Détient au moins un privilège d'administration. */
  isStaff: boolean;
}

export const emailTaken = () =>
  new AppError(
    409,
    'Un compte existe déjà avec cette adresse. Connectez-vous, ou demandez un lien de réinitialisation à l’administrateur.',
    'EMAIL_TAKEN',
  );

/** Ajoute des mois sans déborder : le 31 janvier plus un mois donne le 28 ou 29 février. */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export async function createUserRecord(
  input: {
    name: string;
    email: string;
    passwordHash: string | null;
    role: 'user' | 'admin';
    plan?: PlanId;
    country?: string | null;
  },
  executor?: Transaction,
): Promise<UserRow> {
  const plan = await getPlan(input.plan ?? 'free');
  const now = new Date();
  const credits = plan.monthlyCredits ?? 0;

  try {
    return await inTransaction(executor, async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          name: input.name,
          email: input.email,
          passwordHash: input.passwordHash,
          country: input.country ?? null,
          role: input.role,
          plan: plan.id,
          planCredits: credits,
          creditsCycleEndsAt: addMonths(now, 1),
          passwordChangedAt: input.passwordHash ? now : null,
        })
        .returning();

      await tx.insert(creditTransactions).values({
        userId: user!.id,
        planDelta: credits,
        reason: 'plan_cycle',
        note: `Ouverture du compte : quota du palier ${plan.label} crédité.`,
        balanceAfter: credits,
      });
      return user!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw emailTaken();
    throw error;
  }
}

/**
 * Applique paresseusement l'échéance du palier et le renouvellement du cycle
 * mensuel, au premier accès après la date. Sans tâche planifiée à surveiller :
 * un solde lu est toujours à jour.
 */
async function maintainCycle(user: UserRow, now: Date): Promise<UserRow> {
  const isExpired = (row: UserRow) => row.planExpiresAt !== null && row.planExpiresAt <= now && row.plan !== 'free';
  if (!isExpired(user) && user.creditsCycleEndsAt > now) return user;

  return getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, user.id)).for('update');
    if (!current) return user;

    const expired = isExpired(current);
    const cycleOver = current.creditsCycleEndsAt <= now;
    // Une requête simultanée a déjà fait la mise à jour.
    if (!expired && !cycleOver) return current;

    const previousPlan = await getPlan(current.plan);
    const nextPlan = expired ? await getPlan('free') : previousPlan;

    let cycleEndsAt = current.creditsCycleEndsAt;
    let planCredits = current.planCredits;
    if (cycleOver) {
      while (cycleEndsAt <= now) cycleEndsAt = addMonths(cycleEndsAt, 1);
      planCredits = nextPlan.monthlyCredits ?? 0;
    } else {
      // Échéance en cours de cycle : les points du palier quitté ne suivent pas.
      planCredits = Math.min(current.planCredits, nextPlan.monthlyCredits ?? 0);
    }

    const [updated] = await tx
      .update(users)
      .set({
        plan: nextPlan.id,
        planExpiresAt: expired ? null : current.planExpiresAt,
        planCredits,
        creditsCycleEndsAt: cycleEndsAt,
        updatedAt: now,
      })
      .where(eq(users.id, current.id))
      .returning();

    await tx.insert(creditTransactions).values({
      userId: current.id,
      planDelta: planCredits - current.planCredits,
      reason: expired ? 'plan_change' : 'plan_cycle',
      note: expired
        ? `Palier ${previousPlan.label} arrivé à échéance : retour au palier ${nextPlan.label}.`
        : `Nouveau cycle mensuel : quota du palier ${nextPlan.label} rechargé.`,
      balanceAfter: updated!.planCredits + updated!.bonusCredits,
    });

    return updated!;
  });
}

export async function loadAccount(userId: string, now = new Date()): Promise<AccountSnapshot | null> {
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;

  const user = await maintainCycle(row, now);
  const grants = await db
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId));
  const overrides = await db
    .select({ feature: featureOverrides.feature, access: featureOverrides.access })
    .from(featureOverrides)
    .where(eq(featureOverrides.userId, userId));
  const plan = await getPlan(user.plan);

  const permissions = effectivePermissions(
    user.role,
    grants.map((grant) => grant.permission),
  );

  return {
    user,
    plan,
    permissions,
    overrides,
    features: resolveFeatures(plan, overrides),
    isStaff: permissions.length > 0,
  };
}

/** Limites du palier (niches enregistrées, méthodes publicitaires) ; un administrateur n'en a aucune. */
export function effectiveLimits(snapshot: Pick<AccountSnapshot, 'user' | 'plan'>): PlanLimits {
  return snapshot.user.role === 'admin' ? UNLIMITED : snapshot.plan.limits;
}

export function creditSummary(snapshot: Pick<AccountSnapshot, 'user' | 'plan'>) {
  const { user, plan } = snapshot;
  return {
    plan: user.planCredits,
    bonus: user.bonusCredits,
    total: user.planCredits + user.bonusCredits,
    allowance: plan.monthlyCredits,
    unlimited: plan.monthlyCredits === null,
    cycleEndsAt: user.creditsCycleEndsAt.toISOString(),
  };
}

export const insufficientCredits = (needed: number, available: number) =>
  new AppError(
    402,
    `Solde insuffisant : cette action coûte ${needed} point${needed > 1 ? 's' : ''}, il vous en reste ${available}.`,
    'INSUFFICIENT_CREDITS',
    { needed, available },
  );

/**
 * Prélève le coût d'une action, verrou de ligne compris : deux actions lancées au
 * même instant ne peuvent pas dépenser deux fois le même point.
 * Un palier illimité ne prélève rien mais laisse une ligne d'usage.
 */
export async function debitCredits(input: {
  userId: string;
  cost: number;
  actionId: string;
  unlimited: boolean;
}): Promise<{ transactionId: string; charged: number }> {
  return getDb().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).for('update');
    if (!user) throw new AppError(401, 'Compte introuvable.', 'AUTH_REQUIRED');

    const charged = input.unlimited ? 0 : Math.max(0, input.cost);
    // Points du palier Gratuit : réservés à une adresse confirmée, sinon un robot créerait des comptes en
    // série pour les dépenser chez les fournisseurs payants. Sans service d'e-mails, personne ne pourrait
    // confirmer son adresse : la règle attend qu'il soit branché.
    if (charged > 0 && providers.email && user.plan === 'free' && !user.emailVerifiedAt) {
      throw new AppError(
        403,
        'Confirmez d’abord votre adresse e-mail pour utiliser vos points gratuits : ouvrez le lien reçu, ou renvoyez-le depuis Mon compte.',
        'EMAIL_VERIFICATION_REQUIRED',
      );
    }
    const available = user.planCredits + user.bonusCredits;
    if (charged > available) throw insufficientCredits(charged, available);

    const fromPlan = Math.min(user.planCredits, charged);
    const fromBonus = charged - fromPlan;

    if (charged > 0) {
      await tx
        .update(users)
        .set({ planCredits: user.planCredits - fromPlan, bonusCredits: user.bonusCredits - fromBonus, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    const [transaction] = await tx
      .insert(creditTransactions)
      .values({
        userId: user.id,
        planDelta: -fromPlan,
        bonusDelta: -fromBonus,
        reason: 'usage',
        actionId: input.actionId,
        note: input.unlimited ? 'Palier illimité : aucun point prélevé.' : null,
        balanceAfter: available - charged,
      })
      .returning({ id: creditTransactions.id });

    return { transactionId: transaction!.id, charged };
  });
}

/** Rend exactement ce qu'un débit a prélevé, dans ses compartiments d'origine. */
export async function refundDebit(
  input: { debitTransactionId: string; generationId: string | null; note: string },
  executor?: Transaction,
): Promise<void> {
  await inTransaction(executor, async (tx) => {
    const [debit] = await tx
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.id, input.debitTransactionId))
      .limit(1);
    if (!debit || (debit.planDelta === 0 && debit.bonusDelta === 0)) return;

    const [user] = await tx.select().from(users).where(eq(users.id, debit.userId)).for('update');
    if (!user) return;

    const planCredits = user.planCredits - debit.planDelta;
    const bonusCredits = user.bonusCredits - debit.bonusDelta;
    await tx.update(users).set({ planCredits, bonusCredits, updatedAt: new Date() }).where(eq(users.id, user.id));
    await tx.insert(creditTransactions).values({
      userId: user.id,
      planDelta: -debit.planDelta,
      bonusDelta: -debit.bonusDelta,
      reason: 'refund',
      actionId: debit.actionId,
      generationId: input.generationId,
      note: input.note,
      balanceAfter: planCredits + bonusCredits,
    });
  });
}

/** Recharge (montant positif) ou correction (négatif) des points bonus par un administrateur. */
export async function grantCredits(
  input: { userId: string; amount: number; actorId: string | null; note: string },
  executor?: Transaction,
): Promise<{ applied: number; balance: number }> {
  return inTransaction(executor, async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).for('update');
    if (!user) throw new AppError(404, 'Utilisateur introuvable.', 'USER_NOT_FOUND');

    const bonusCredits = Math.max(0, user.bonusCredits + input.amount);
    const applied = bonusCredits - user.bonusCredits;
    await tx.update(users).set({ bonusCredits, updatedAt: new Date() }).where(eq(users.id, user.id));
    await tx.insert(creditTransactions).values({
      userId: user.id,
      bonusDelta: applied,
      reason: 'admin_grant',
      actorId: input.actorId,
      note: input.note,
      balanceAfter: user.planCredits + bonusCredits,
    });
    return { applied, balance: user.planCredits + bonusCredits };
  });
}

/**
 * Change le palier. `refillCredits` remet les points du palier au nouveau quota et
 * ouvre un cycle d'un mois : c'est le cas d'un abonnement payé.
 */
export async function changePlan(
  input: {
    userId: string;
    plan: PlanId;
    expiresAt: Date | null;
    refillCredits: boolean;
    actorId: string | null;
    note: string;
  },
  executor?: Transaction,
): Promise<UserRow> {
  const definition = await getPlan(input.plan);

  return inTransaction(executor, async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, input.userId)).for('update');
    if (!current) throw new AppError(404, 'Utilisateur introuvable.', 'USER_NOT_FOUND');

    const now = new Date();
    const planCredits = input.refillCredits ? (definition.monthlyCredits ?? 0) : current.planCredits;
    const [updated] = await tx
      .update(users)
      .set({
        plan: definition.id,
        planExpiresAt: input.expiresAt,
        planCredits,
        creditsCycleEndsAt: input.refillCredits ? addMonths(now, 1) : current.creditsCycleEndsAt,
        updatedAt: now,
      })
      .where(eq(users.id, current.id))
      .returning();

    await tx.insert(creditTransactions).values({
      userId: current.id,
      planDelta: planCredits - current.planCredits,
      reason: 'plan_change',
      actorId: input.actorId,
      note: input.note,
      balanceAfter: planCredits + current.bonusCredits,
    });
    return updated!;
  });
}
