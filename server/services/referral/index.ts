import { randomInt } from 'node:crypto';
import { and, count, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { getDb, isUniqueViolation, type Executor } from '@server/db/client';
import { payments, referralCommissions, referralPayouts, users, type REFERRAL_PAYOUT_METHODS, type REFERRAL_PAYOUT_STATUSES } from '@server/db/schema';
import { env } from '@server/env';
import { AppError } from '@server/middleware';

/**
 * Parrainage : un lien par compte, et une commission sur les paiements des comptes qu'il amène.
 *
 * Le parcours, de bout en bout :
 *
 *   1. LIEN — chaque compte a un code (« /r/CODE » ou « /?ref=CODE »).
 *   2. SUIVI — la visite pose un cookie pour REFERRAL_COOKIE_DAYS jours. Dernier clic : un second
 *      lien suivi remplace le premier.
 *   3. RATTACHEMENT — à l'inscription, le nouveau compte est rattaché au parrain du cookie.
 *      Une fois pour toutes : un compte ne change pas de parrain, et ne se parraine pas lui-même.
 *   4. COMMISSION — chaque PAIEMENT du filleul en crée une, « en attente ». L'inscription seule ne
 *      rapporte rien : une prime à l'inscription se fabrique avec de faux comptes, un paiement non.
 *   5. VALIDATION — après REFERRAL_HOLD_DAYS jours, si le paiement n'a pas été remboursé.
 *   6. RETRAIT — dès que le solde validé atteint REFERRAL_MIN_PAYOUT_FCFA, le parrain demande son
 *      versement (Mobile Money, virement, crypto). L'équipe le règle, puis le marque payé.
 *
 * Les montants sont en francs CFA, la devise des comptes du site ; l'écran les convertit.
 */

type PayoutMethod = (typeof REFERRAL_PAYOUT_METHODS)[number];
type PayoutStatus = (typeof REFERRAL_PAYOUT_STATUSES)[number];

/** Sans 0/O ni 1/I/L : un code se dicte au téléphone et se recopie d'un écran. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
export const REFERRAL_CODE = /^[A-Z2-9]{6,12}$/;

const JOUR_MS = 86_400_000;

const newCode = () => Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export const normalizeCode = (value: unknown): string | null => {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return REFERRAL_CODE.test(code) ? code : null;
};

/** Ce que le programme promet, tel que l'écran l'annonce. */
export function referralTerms() {
  const fixed = env.REFERRAL_COMMISSION_FIXED_FCFA;
  return {
    mode: fixed > 0 ? ('fixed' as const) : ('percent' as const),
    percent: env.REFERRAL_COMMISSION_PERCENT,
    fixedFcfa: fixed,
    holdDays: env.REFERRAL_HOLD_DAYS,
    minPayoutFcfa: env.REFERRAL_MIN_PAYOUT_FCFA,
    cookieDays: env.REFERRAL_COOKIE_DAYS,
  };
}

/** Commission due sur un paiement, en francs CFA. */
export function commissionFor(baseFcfa: number): number {
  const terms = referralTerms();
  if (terms.mode === 'fixed') return terms.fixedFcfa;
  return Math.max(0, Math.round((baseFcfa * terms.percent) / 100));
}

/** Code du compte, créé à la première demande. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const db = getDb();
  const [user] = await db.select({ code: users.referralCode }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(404, 'Compte introuvable.', 'USER_NOT_FOUND');
  if (user.code) return user.code;
  for (let essai = 0; essai < 6; essai += 1) {
    const code = newCode();
    try {
      const [ecrit] = await db
        .update(users)
        .set({ referralCode: code })
        .where(and(eq(users.id, userId), isNull(users.referralCode)))
        .returning({ code: users.referralCode });
      if (ecrit?.code) return ecrit.code;
      // Deux écrans ouverts en même temps : l'autre a posé le code le premier.
      const [relu] = await db.select({ code: users.referralCode }).from(users).where(eq(users.id, userId)).limit(1);
      if (relu?.code) return relu.code;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new AppError(500, 'Votre lien de parrainage n’a pas pu être créé.', 'REFERRAL_CODE_FAILED');
}

/** Ce code est-il celui d'un compte actif ? */
export async function referralCodeExists(rawCode: unknown): Promise<boolean> {
  const code = normalizeCode(rawCode);
  if (!code) return false;
  const [affiliate] = await getDb().select({ id: users.id }).from(users).where(and(eq(users.referralCode, code), eq(users.status, 'active'))).limit(1);
  return Boolean(affiliate);
}

/** Une visite arrivée par un lien de parrainage. Renvoie le code s'il existe, null sinon. */
export async function recordReferralVisit(rawCode: unknown): Promise<string | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const [affiliate] = await getDb()
    .update(users)
    .set({ referralClicks: sql`${users.referralClicks} + 1` })
    .where(and(eq(users.referralCode, code), eq(users.status, 'active')))
    .returning({ id: users.id });
  return affiliate ? code : null;
}

/**
 * Rattache un compte tout juste créé au parrain dont il a suivi le lien. Sans effet si le code
 * est inconnu, si le compte a déjà un parrain, ou si c'est le sien.
 */
export async function attachReferral(userId: string, rawCode: unknown, now = new Date()): Promise<boolean> {
  const code = normalizeCode(rawCode);
  if (!code) return false;
  const db = getDb();
  const [affiliate] = await db.select({ id: users.id }).from(users).where(and(eq(users.referralCode, code), eq(users.status, 'active'))).limit(1);
  if (!affiliate || affiliate.id === userId) return false;
  const attached = await db
    .update(users)
    .set({ referredBy: affiliate.id, referredAt: now })
    .where(and(eq(users.id, userId), isNull(users.referredBy)))
    .returning({ id: users.id });
  return attached.length > 0;
}

/**
 * Commission d'un paiement, s'il vient d'un filleul. Appelée dans la transaction qui enregistre
 * le paiement : les deux existent ensemble, ou pas du tout. Un paiement ne la crée qu'une fois.
 */
export async function recordReferralCommission(
  input: { paymentId: string; userId: string | null; amountFcfa: number },
  executor: Executor = getDb(),
  now = new Date(),
): Promise<boolean> {
  if (!input.userId || input.amountFcfa <= 0) return false;
  const [payer] = await executor.select({ referredBy: users.referredBy }).from(users).where(eq(users.id, input.userId)).limit(1);
  if (!payer?.referredBy) return false;
  const amountFcfa = commissionFor(input.amountFcfa);
  if (amountFcfa <= 0) return false;
  const created = await executor
    .insert(referralCommissions)
    .values({
      affiliateId: payer.referredBy,
      referredUserId: input.userId,
      paymentId: input.paymentId,
      baseFcfa: input.amountFcfa,
      amountFcfa,
      approveAt: new Date(now.getTime() + env.REFERRAL_HOLD_DAYS * JOUR_MS),
    })
    .onConflictDoNothing({ target: referralCommissions.paymentId })
    .returning({ id: referralCommissions.id });
  return created.length > 0;
}

/**
 * Fin du délai de garde : les commissions dont le paiement tient toujours sont validées, celles
 * dont le paiement a été remboursé entre-temps sont annulées. Appelée par le réveil quotidien.
 */
export async function settleDueCommissions(now = new Date()): Promise<{ approved: number; cancelled: number }> {
  const db = getDb();
  const dues = await db
    .select({ id: referralCommissions.id, paymentStatus: payments.status })
    .from(referralCommissions)
    .innerJoin(payments, eq(payments.id, referralCommissions.paymentId))
    .where(and(eq(referralCommissions.status, 'pending'), lte(referralCommissions.approveAt, now)))
    .limit(2_000);
  const aValider = dues.filter((row) => row.paymentStatus === 'paid').map((row) => row.id);
  const aAnnuler = dues.filter((row) => row.paymentStatus !== 'paid').map((row) => row.id);
  if (aValider.length > 0) await db.update(referralCommissions).set({ status: 'approved' }).where(and(inArray(referralCommissions.id, aValider), eq(referralCommissions.status, 'pending')));
  if (aAnnuler.length > 0) await db.update(referralCommissions).set({ status: 'cancelled' }).where(and(inArray(referralCommissions.id, aAnnuler), eq(referralCommissions.status, 'pending')));
  return { approved: aValider.length, cancelled: aAnnuler.length };
}

/** Un paiement remboursé : sa commission tombe, tant qu'elle n'a pas été versée. */
export async function cancelCommissionOf(paymentId: string, executor: Executor = getDb()): Promise<void> {
  await executor
    .update(referralCommissions)
    .set({ status: 'cancelled', payoutId: null })
    .where(and(eq(referralCommissions.paymentId, paymentId), inArray(referralCommissions.status, ['pending', 'approved'])));
}

export interface ReferralDashboard {
  code: string;
  terms: ReturnType<typeof referralTerms>;
  clicks: number;
  /** Comptes créés par ce lien, et ceux d'entre eux qui ont payé au moins une fois. */
  signups: number;
  customers: number;
  /** En francs CFA. `available` : validé et pas encore demandé en retrait. */
  balances: { pending: number; available: number; requested: number; paid: number };
  commissions: { id: string; amountFcfa: number; baseFcfa: number; status: string; createdAt: string; approveAt: string; referred: string }[];
  payouts: { id: string; amountFcfa: number; method: PayoutMethod; destination: string; status: PayoutStatus; note: string | null; requestedAt: string; processedAt: string | null }[];
}

/** « Awa K. » : assez pour reconnaître un filleul, pas assez pour l'identifier auprès d'un tiers. */
const discret = (name: string | null): string => {
  const mots = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return 'Compte supprimé';
  return mots.length === 1 ? mots[0]! : `${mots[0]} ${mots[mots.length - 1]![0]!.toUpperCase()}.`;
};

/** Numéro ou IBAN rappelé à l'écran sans être réaffiché en entier. */
const masque = (destination: string): string => (destination.length <= 4 ? destination : `${'•'.repeat(Math.min(8, destination.length - 4))}${destination.slice(-4)}`);

export async function referralDashboard(userId: string): Promise<ReferralDashboard> {
  const db = getDb();
  const code = await ensureReferralCode(userId);
  const [[me], [signups], [customers], commissions, payouts] = await Promise.all([
    db.select({ clicks: users.referralClicks }).from(users).where(eq(users.id, userId)).limit(1),
    db.select({ total: count() }).from(users).where(eq(users.referredBy, userId)),
    db.select({ total: sql<number>`count(distinct ${referralCommissions.referredUserId})` }).from(referralCommissions).where(eq(referralCommissions.affiliateId, userId)),
    db
      .select({
        id: referralCommissions.id,
        amountFcfa: referralCommissions.amountFcfa,
        baseFcfa: referralCommissions.baseFcfa,
        status: referralCommissions.status,
        payoutId: referralCommissions.payoutId,
        createdAt: referralCommissions.createdAt,
        approveAt: referralCommissions.approveAt,
        name: users.name,
      })
      .from(referralCommissions)
      .leftJoin(users, eq(users.id, referralCommissions.referredUserId))
      .where(eq(referralCommissions.affiliateId, userId))
      .orderBy(desc(referralCommissions.createdAt))
      .limit(500),
    db.select().from(referralPayouts).where(eq(referralPayouts.affiliateId, userId)).orderBy(desc(referralPayouts.requestedAt)).limit(50),
  ]);

  const somme = (filtre: (row: (typeof commissions)[number]) => boolean) => commissions.filter(filtre).reduce((total, row) => total + row.amountFcfa, 0);
  return {
    code,
    terms: referralTerms(),
    clicks: me?.clicks ?? 0,
    signups: Number(signups?.total ?? 0),
    customers: Number(customers?.total ?? 0),
    balances: {
      pending: somme((row) => row.status === 'pending'),
      available: somme((row) => row.status === 'approved' && row.payoutId === null),
      requested: somme((row) => row.status === 'approved' && row.payoutId !== null),
      paid: somme((row) => row.status === 'paid'),
    },
    commissions: commissions.slice(0, 50).map((row) => ({
      id: row.id,
      amountFcfa: row.amountFcfa,
      baseFcfa: row.baseFcfa,
      status: row.status === 'approved' && row.payoutId !== null ? 'requested' : row.status,
      createdAt: row.createdAt.toISOString(),
      approveAt: row.approveAt.toISOString(),
      referred: discret(row.name),
    })),
    payouts: payouts.map((row) => ({
      id: row.id,
      amountFcfa: row.amountFcfa,
      method: row.method,
      destination: masque(row.destination),
      status: row.status,
      note: row.note,
      requestedAt: row.requestedAt.toISOString(),
      processedAt: row.processedAt?.toISOString() ?? null,
    })),
  };
}

/**
 * Demande de retrait : tout le solde validé part dans une demande. Une seule demande ouverte à la
 * fois, pour que l'équipe n'ait jamais deux versements à rapprocher pour le même compte.
 */
export async function requestPayout(userId: string, input: { method: PayoutMethod; destination: string; holderName: string }): Promise<{ id: string; amountFcfa: number }> {
  return getDb().transaction(async (tx) => {
    // Verrou sur le compte : deux demandes simultanées ne se partagent pas le même solde.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const [ouverte] = await tx.select({ id: referralPayouts.id }).from(referralPayouts).where(and(eq(referralPayouts.affiliateId, userId), eq(referralPayouts.status, 'requested'))).limit(1);
    if (ouverte) throw new AppError(409, 'Une demande de retrait est déjà en cours de traitement.', 'REFERRAL_PAYOUT_PENDING');

    const disponibles = await tx
      .select({ id: referralCommissions.id, amountFcfa: referralCommissions.amountFcfa })
      .from(referralCommissions)
      .where(and(eq(referralCommissions.affiliateId, userId), eq(referralCommissions.status, 'approved'), isNull(referralCommissions.payoutId)));
    const amountFcfa = disponibles.reduce((total, row) => total + row.amountFcfa, 0);
    if (amountFcfa <= 0 || amountFcfa < env.REFERRAL_MIN_PAYOUT_FCFA) {
      throw new AppError(409, 'Votre solde validé n’atteint pas encore le minimum de retrait.', 'REFERRAL_BELOW_MINIMUM', { minimum: env.REFERRAL_MIN_PAYOUT_FCFA, available: amountFcfa });
    }
    const [payout] = await tx.insert(referralPayouts).values({ affiliateId: userId, amountFcfa, method: input.method, destination: input.destination, holderName: input.holderName }).returning({ id: referralPayouts.id });
    await tx.update(referralCommissions).set({ payoutId: payout!.id }).where(inArray(referralCommissions.id, disponibles.map((row) => row.id)));
    return { id: payout!.id, amountFcfa };
  });
}

/* -------------------------------------------------------------------------- */
/*  Administration                                                             */
/* -------------------------------------------------------------------------- */

export interface AdminPayout {
  id: string;
  affiliate: { id: string; name: string; email: string };
  amountFcfa: number;
  method: PayoutMethod;
  destination: string;
  holderName: string;
  status: PayoutStatus;
  note: string | null;
  requestedAt: string;
  processedAt: string | null;
}

export async function listPayouts(status?: PayoutStatus): Promise<AdminPayout[]> {
  const rows = await getDb()
    .select({ payout: referralPayouts, name: users.name, email: users.email })
    .from(referralPayouts)
    .innerJoin(users, eq(users.id, referralPayouts.affiliateId))
    .where(status ? eq(referralPayouts.status, status) : undefined)
    .orderBy(desc(referralPayouts.requestedAt))
    .limit(200);
  return rows.map(({ payout, name, email }) => ({
    id: payout.id,
    affiliate: { id: payout.affiliateId, name, email },
    amountFcfa: payout.amountFcfa,
    method: payout.method,
    destination: payout.destination,
    holderName: payout.holderName,
    status: payout.status,
    note: payout.note,
    requestedAt: payout.requestedAt.toISOString(),
    processedAt: payout.processedAt?.toISOString() ?? null,
  }));
}

/**
 * Règle une demande. « Payée » : ses commissions sont soldées. « Refusée » : elles redeviennent
 * disponibles, le parrain pourra redemander son retrait avec d'autres coordonnées.
 */
export async function processPayout(payoutId: string, decision: 'paid' | 'rejected', actorId: string, note: string | null, now = new Date()): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [claimed] = await tx
      .update(referralPayouts)
      .set({ status: decision, note, processedAt: now, processedBy: actorId })
      .where(and(eq(referralPayouts.id, payoutId), eq(referralPayouts.status, 'requested')))
      .returning({ id: referralPayouts.id });
    if (!claimed) throw new AppError(409, 'Cette demande a déjà été traitée.', 'REFERRAL_PAYOUT_SETTLED');
    if (decision === 'paid') await tx.update(referralCommissions).set({ status: 'paid' }).where(eq(referralCommissions.payoutId, payoutId));
    else await tx.update(referralCommissions).set({ payoutId: null }).where(eq(referralCommissions.payoutId, payoutId));
  });
}
