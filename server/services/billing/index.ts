import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { paymentCheckouts, payments, users, type PlanId } from '@server/db/schema';
import { env, providers } from '@server/env';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { addMonths, changePlan } from '@server/services/accounts';
import { recordAuthEvent } from '@server/services/audit';
import { createCheckoutSession, retrieveCheckoutSession, stripeMode, verifyWebhookSignature } from '@server/services/billing/stripe';
import { convertAmount, currencyForCountry, fromMinorUnits, getRates, toMinorUnits } from '@server/services/currency';
import { getPlan, getPlanConfig, planPrice } from '@server/services/plans';
import { formatMoney } from '@server/shared/currency';

/**
 * Paiement en ligne des paliers (Stripe Checkout, carte bancaire).
 *
 * Le serveur fixe seul le montant, d'après la grille des paliers et le pays du
 * compte. Le palier n'est activé qu'après confirmation par Stripe lui-même — au
 * retour de la page de paiement ou par le webhook signé, selon ce qui arrive en
 * premier — et une seule fois : la session passe de « open » à « paid » par une
 * mise à jour conditionnelle.
 */

/** Devises proposées au paiement ; les autres pays paient en euros, au taux du jour. */
const CHECKOUT_CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'CAD', 'CHF', 'XAF', 'XOF']);
/** Montant minimal accepté par Stripe, en euros. */
const MINIMUM_EUR = 0.5;

export const checkoutSchema = z.object({
  plan: z.enum(['plus', 'pro', 'max', 'elite']),
  period: z.enum(['month', 'year']),
});

export type CheckoutRequest = z.infer<typeof checkoutSchema>;

export const confirmSchema = z.object({ sessionId: z.string().trim().min(8).max(255) });

const appUrl = () => env.APP_URL.replace(/\/$/, '');
const formatDay = (date: Date) => date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: env.REPORTING_TIMEZONE });
const notFound = () => new AppError(404, 'Paiement introuvable sur votre compte.', 'PAYMENT_NOT_FOUND');

export async function startCheckout(auth: RequestAuth, request: CheckoutRequest): Promise<{ url: string }> {
  if (!providers.payments) throw new AppError(503, 'Le paiement en ligne n’est pas encore configuré sur ce serveur.', 'PAYMENT_NOT_CONFIGURED');

  const { user } = auth.account;
  const [config, rates, plan] = await Promise.all([getPlanConfig(), getRates(), getPlan(request.plan)]);
  const localCurrency = currencyForCountry(user.country, rates);
  const currency = CHECKOUT_CURRENCIES.has(localCurrency) ? localCurrency : 'EUR';
  const price = planPrice(plan, config, currency, rates);
  if (!price || price.monthly <= 0) {
    throw new AppError(400, `Le prix du palier ${plan.label} n’est pas encore fixé : il ne peut pas être payé en ligne.`, 'PLAN_NOT_PURCHASABLE');
  }

  const amount = request.period === 'month' ? price.monthly : price.yearly;
  const periodMonths = request.period === 'month' ? 1 : 12;
  const euros = convertAmount(amount, currency, 'EUR', rates);
  if (euros === null || euros < MINIMUM_EUR) {
    throw new AppError(400, 'Ce montant est trop faible pour un paiement par carte.', 'AMOUNT_TOO_SMALL');
  }
  const amountMinor = toMinorUnits(amount, currency);
  const label = `Smart Creator — palier ${plan.label}, ${periodMonths === 1 ? '1 mois' : '12 mois'}`;

  const session = await createCheckoutSession(
    {
      mode: 'payment',
      locale: 'fr',
      customer_email: user.email,
      client_reference_id: user.id,
      success_url: `${appUrl()}/app/compte?paiement=reussi&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/app/compte?paiement=annule`,
      metadata: { userId: user.id, plan: plan.id, periodMonths: String(periodMonths) },
      payment_intent_data: { description: label, metadata: { userId: user.id, plan: plan.id } },
      line_items: [
        {
          quantity: 1,
          price_data: { currency: currency.toLowerCase(), unit_amount: amountMinor, product_data: { name: label } },
        },
      ],
    },
    randomUUID(),
  );
  if (!session.url) throw new AppError(502, 'Le service de paiement n’a pas renvoyé de page de paiement.', 'PAYMENT_FAILED');

  await getDb().insert(paymentCheckouts).values({
    id: session.id,
    userId: user.id,
    plan: plan.id,
    periodMonths,
    currency,
    amountMinor,
  });
  return { url: session.url };
}

type CheckoutOutcome = { status: 'paid' | 'pending' | 'expired'; plan: PlanId; expiresAt: string | null };

async function currentExpiry(userId: string): Promise<string | null> {
  const [row] = await getDb().select({ planExpiresAt: users.planExpiresAt }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.planExpiresAt?.toISOString() ?? null;
}

/** Active le palier d'une session payée, une seule fois. Idempotent : retour et webhook peuvent se croiser. */
export async function fulfillCheckout(sessionId: string): Promise<CheckoutOutcome> {
  const db = getDb();
  const [checkout] = await db.select().from(paymentCheckouts).where(eq(paymentCheckouts.id, sessionId)).limit(1);
  if (!checkout) throw notFound();
  if (checkout.status === 'paid') return { status: 'paid', plan: checkout.plan, expiresAt: await currentExpiry(checkout.userId) };

  const session = await retrieveCheckoutSession(sessionId);
  if (session.status === 'expired') {
    await db.update(paymentCheckouts).set({ status: 'expired' }).where(and(eq(paymentCheckouts.id, sessionId), eq(paymentCheckouts.status, 'open')));
    return { status: 'expired', plan: checkout.plan, expiresAt: null };
  }
  if (session.payment_status !== 'paid') return { status: 'pending', plan: checkout.plan, expiresAt: null };

  // Stripe doit confirmer exactement ce qui a été proposé : même compte, même montant, même devise.
  if (session.metadata?.userId !== checkout.userId || session.amount_total !== checkout.amountMinor || session.currency?.toUpperCase() !== checkout.currency) {
    console.error('[paiements] session Stripe incohérente avec la demande enregistrée');
    throw new AppError(409, 'Ce paiement ne correspond pas à la demande enregistrée : contactez l’équipe Smart Creator.', 'PAYMENT_MISMATCH');
  }

  const [plan, rates] = await Promise.all([getPlan(checkout.plan), getRates()]);
  const amount = fromMinorUnits(checkout.amountMinor, checkout.currency);
  const amountFcfa = Math.max(1, Math.round(convertAmount(amount, checkout.currency, 'XAF', rates) ?? 0));

  return db.transaction(async (tx) => {
    const now = new Date();
    const [claimed] = await tx
      .update(paymentCheckouts)
      .set({ status: 'paid', completedAt: now })
      .where(and(eq(paymentCheckouts.id, sessionId), eq(paymentCheckouts.status, 'open')))
      .returning();
    if (!claimed) return { status: 'paid' as const, plan: checkout.plan, expiresAt: await currentExpiry(checkout.userId) };

    const [user] = await tx.select().from(users).where(eq(users.id, claimed.userId)).for('update');
    if (!user) throw notFound();

    const [payment] = await tx
      .insert(payments)
      .values({
        userId: user.id,
        userEmail: user.email,
        plan: claimed.plan,
        periodMonths: claimed.periodMonths,
        currency: claimed.currency,
        amountMinor: claimed.amountMinor,
        amountFcfa,
        method: 'card',
        reference: sessionId,
        note: `Paiement en ligne par carte (Stripe${stripeMode() === 'test' ? ', mode test' : ''})`,
        paidAt: now,
        recordedBy: null,
      })
      .returning({ id: payments.id });

    // Renouvellement du même palier : la nouvelle période s'ajoute à celle en cours.
    const base = user.plan === claimed.plan && user.planExpiresAt && user.planExpiresAt > now ? user.planExpiresAt : now;
    const expiresAt = addMonths(base, claimed.periodMonths);
    await changePlan(
      {
        userId: user.id,
        plan: claimed.plan,
        expiresAt,
        refillCredits: true,
        actorId: null,
        note: `Paiement en ligne de ${formatMoney(amount, claimed.currency)} : palier ${plan.label} jusqu’au ${formatDay(expiresAt)}.`,
      },
      tx,
    );
    await tx.update(paymentCheckouts).set({ paymentId: payment!.id }).where(eq(paymentCheckouts.id, sessionId));
    await recordAuthEvent(
      'payment_completed',
      {
        userId: user.id,
        email: user.email,
        client: { ipAddress: null, userAgent: null },
        details: { plan: claimed.plan, periodMonths: claimed.periodMonths, currency: claimed.currency, amountMinor: claimed.amountMinor },
      },
      tx,
    );
    return { status: 'paid' as const, plan: claimed.plan, expiresAt: expiresAt.toISOString() };
  });
}

/** Retour de la page de paiement : seul le titulaire de la session peut la confirmer. */
export async function confirmCheckout(auth: RequestAuth, sessionId: string): Promise<CheckoutOutcome> {
  const [checkout] = await getDb()
    .select({ userId: paymentCheckouts.userId })
    .from(paymentCheckouts)
    .where(eq(paymentCheckouts.id, sessionId))
    .limit(1);
  if (!checkout || checkout.userId !== auth.account.user.id) throw notFound();
  return fulfillCheckout(sessionId);
}

/** Webhook Stripe : signature vérifiée, puis activation idempotente. */
export async function handleStripeWebhook(rawBody: Buffer, signature: string | undefined): Promise<void> {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new AppError(503, 'Webhook Stripe non configuré.', 'WEBHOOK_NOT_CONFIGURED');
  if (!verifyWebhookSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)) {
    throw new AppError(400, 'Signature Stripe invalide.', 'WEBHOOK_SIGNATURE_INVALID');
  }

  const event = JSON.parse(rawBody.toString('utf8')) as { type?: string; data?: { object?: { id?: string } } };
  const sessionId = event.data?.object?.id;
  if (!sessionId || !event.type?.startsWith('checkout.session.')) return;

  const [checkout] = await getDb().select({ id: paymentCheckouts.id }).from(paymentCheckouts).where(eq(paymentCheckouts.id, sessionId)).limit(1);
  // Une session créée hors de Smart Creator sur le même compte Stripe ne nous concerne pas.
  if (!checkout) return;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded' || event.type === 'checkout.session.expired') {
    await fulfillCheckout(sessionId);
  }
}
