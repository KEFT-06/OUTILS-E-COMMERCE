import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, lt } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { paymentCheckouts } from '@server/db/schema';
import { env } from '@server/env';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { type CheckoutOutcome, type CheckoutRow, activateCheckout, currentExpiry } from '@server/services/billing';
import {
  type MobileOperator,
  createCollection,
  getCollection,
  listCountries,
  listOperators,
  sebpayConfigured,
  sebpayMode,
  signatureMatches,
} from '@server/services/billing/sebpay';
import { currencyForCountry, fromMinorUnits, getRates, toMinorUnits } from '@server/services/currency';
import { getPlan, getPlanConfig, planPrice } from '@server/services/plans';
import { countryName } from '@server/shared/countries';
import { formatMoney } from '@server/shared/currency';
import { internationalNumber, phoneHint } from '@server/shared/phone';

/**
 * Paiement d'un palier par Mobile Money.
 *
 * Le client choisit son opérateur et donne son numéro ; la demande part sur son téléphone, où il
 * la valide avec son code secret. Le serveur fixe seul le montant, d'après la grille des paliers
 * et le pays du compte.
 *
 * Le palier n'est activé que sur la parole du prestataire, relue chez lui avec nos clés
 * (`GET /collections/{référence}`) : même montant, même devise, état « approved ». Sa notification
 * n'est qu'un signal — son contenu n'active jamais rien — si bien qu'une notification forgée ne
 * peut au pire que provoquer une relecture. Trois chemins mènent à cette relecture, pour qu'un
 * paiement validé ne reste jamais sans palier : l'écran qui attend, la notification, et la reprise
 * (au retour du client sur son compte, et à chaque passage de la veille).
 */

export const mobileCheckoutSchema = z.object({
  plan: z.enum(['plus', 'pro', 'max', 'elite']),
  period: z.enum(['month', 'year']),
  operator: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{2,40}$/),
  phone: z.string().trim().min(6).max(24),
  /** Code de confirmation, pour les opérateurs qui l'exigent. */
  otpCode: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/)
    .optional(),
});

export type MobileCheckoutRequest = z.infer<typeof mobileCheckoutSchema>;

export const mobileQuoteSchema = z.object({ plan: z.enum(['plus', 'pro', 'max', 'elite']).optional(), period: z.enum(['month', 'year']).optional() });

/** Une demande sans réponse du client au bout d'un jour n'en aura plus : l'opérateur l'a close bien avant. */
const OPEN_FOR_MS = 24 * 3_600_000;
/** Deux demandes coup sur coup feraient sonner deux fois le téléphone du client. */
const SAME_REQUEST_MS = 45_000;

/** Écart admis entre le montant demandé et le montant confirmé : les frais du prestataire, pas davantage. */
const AMOUNT_TOLERANCE = 0.1;
/** Francs CFA d'Afrique centrale et de l'Ouest : même valeur, deux codes. */
const CFA = new Set(['XAF', 'XOF']);

const PROVIDER = 'sebpay';
const appUrl = () => env.APP_URL.replace(/\/$/, '');
const notFound = () => new AppError(404, 'Paiement introuvable sur votre compte.', 'PAYMENT_NOT_FOUND');
const unavailable = () => new AppError(503, 'Le paiement par Mobile Money n’est pas ouvert pour votre pays.', 'MOBILE_MONEY_UNAVAILABLE');

export interface MobileMoneyOffer {
  available: boolean;
  /** « test » : bac à sable, aucun argent réel ; réservé à l'équipe. */
  mode: 'test' | 'live' | null;
  country: string | null;
  countryName: string | null;
  currency: string | null;
  /** Indicatif du pays, en chiffres. */
  prefix: string | null;
  operators: MobileOperator[];
  /** Montant à payer pour le palier et la durée demandés, dans la devise du pays. */
  amount: number | null;
  amountLabel: string | null;
}

const NOT_OFFERED: MobileMoneyOffer = { available: false, mode: null, country: null, countryName: null, currency: null, prefix: null, operators: [], amount: null, amountLabel: null };

/**
 * Ce que le Mobile Money propose à ce compte : ses opérateurs, sa devise, le montant du palier.
 * Ne lève jamais : un prestataire injoignable ferme simplement ce moyen de paiement à l'écran.
 */
export async function mobileMoneyOffer(auth: RequestAuth, quote: z.infer<typeof mobileQuoteSchema> = {}): Promise<MobileMoneyOffer> {
  const mode = sebpayMode();
  const { user } = auth.account;
  // En bac à sable, aucun vrai paiement n'aboutit : seule l'équipe y accède, pour ses essais.
  if (!sebpayConfigured() || !user.country || (mode === 'test' && !auth.account.isStaff)) return { ...NOT_OFFERED, mode };

  try {
    const country = (await listCountries()).find((entry) => entry.code === user.country);
    if (!country) return { ...NOT_OFFERED, mode };
    const operators = await listOperators(country.code);
    if (operators.length === 0) return { ...NOT_OFFERED, mode };

    const rates = await getRates();
    const currency = country.currency ?? currencyForCountry(country.code, rates);
    let amount: number | null = null;
    if (quote.plan && quote.period) {
      const [config, plan] = await Promise.all([getPlanConfig(), getPlan(quote.plan)]);
      const price = planPrice(plan, config, currency, rates);
      if (!price || price.monthly <= 0) return { ...NOT_OFFERED, mode };
      amount = Math.round(quote.period === 'month' ? price.monthly : price.yearly);
    }
    return {
      available: true,
      mode,
      country: country.code,
      countryName: countryName(country.code),
      currency,
      prefix: country.prefix || null,
      operators,
      amount,
      amountLabel: amount === null ? null : formatMoney(amount, currency),
    };
  } catch (error) {
    console.error('[paiements] Mobile Money indisponible :', error instanceof AppError ? error.code : 'erreur');
    return { ...NOT_OFFERED, mode };
  }
}

export interface MobileCheckoutStart {
  reference: string;
  status: CheckoutOutcome['status'];
  expiresAt: string | null;
  /** Adresse où valider le paiement, pour les opérateurs qui en ont une ; sinon tout se passe sur le téléphone. */
  providerLink: string | null;
  operator: string;
  amountLabel: string;
  phoneHint: string;
}

const newReference = () => `SC${Date.now().toString(36)}${randomBytes(8).toString('hex')}`.toUpperCase();

export async function startMobileCheckout(auth: RequestAuth, request: MobileCheckoutRequest): Promise<MobileCheckoutStart> {
  const offer = await mobileMoneyOffer(auth, request);
  if (!offer.available || !offer.country || !offer.currency || offer.amount === null || !offer.amountLabel) throw unavailable();

  const operator = offer.operators.find((entry) => entry.slug === request.operator);
  if (!operator) throw new AppError(400, 'Cet opérateur n’est pas proposé pour votre pays.', 'OPERATOR_UNAVAILABLE');
  if (operator.otpRequired && !request.otpCode) {
    throw new AppError(
      400,
      operator.ussdCode
        ? `${operator.name} demande un code de confirmation : composez ${operator.ussdCode} sur votre téléphone, puis saisissez le code reçu.`
        : `${operator.name} demande un code de confirmation : saisissez le code reçu sur votre téléphone.`,
      'OTP_REQUIRED',
    );
  }

  const phone = internationalNumber(request.phone, offer.prefix ?? '');
  if (!phone || (offer.prefix && !phone.startsWith(offer.prefix))) {
    throw new AppError(400, `Indiquez un numéro de téléphone ${offer.countryName ? `du pays de votre compte (${offer.countryName})` : 'valide'}.`, 'PHONE_INVALID');
  }

  const db = getDb();
  const { user } = auth.account;
  const [recent] = await db
    .select({ id: paymentCheckouts.id })
    .from(paymentCheckouts)
    .where(
      and(
        eq(paymentCheckouts.userId, user.id),
        eq(paymentCheckouts.provider, PROVIDER),
        eq(paymentCheckouts.status, 'open'),
        gt(paymentCheckouts.createdAt, new Date(Date.now() - SAME_REQUEST_MS)),
      ),
    )
    .limit(1);
  if (recent) {
    throw new AppError(409, 'Une demande de paiement vient de partir sur votre téléphone : validez-la avec votre code secret.', 'PAYMENT_ALREADY_SENT');
  }

  const reference = newReference();
  const periodMonths = request.period === 'month' ? 1 : 12;
  const hint = phoneHint(phone);
  // Enregistrée AVANT l'appel : une notification qui arriverait aussitôt doit trouver la demande.
  await db.insert(paymentCheckouts).values({
    id: reference,
    userId: user.id,
    plan: request.plan,
    periodMonths,
    currency: offer.currency,
    amountMinor: toMinorUnits(offer.amount, offer.currency),
    provider: PROVIDER,
    operator: operator.slug,
    country: offer.country,
    phoneHint: hint,
  });

  let collection;
  try {
    collection = await createCollection({
      amount: offer.amount,
      currency: offer.currency,
      phone,
      operator: operator.slug,
      country: offer.country,
      reference,
      callbackUrl: `${appUrl()}/api/billing/mobile/notify`,
      otpCode: request.otpCode,
    });
  } catch (error) {
    // Rien n'est parti : la demande ne doit pas rester « ouverte » et bloquer la suivante.
    await db.update(paymentCheckouts).set({ status: 'failed' }).where(and(eq(paymentCheckouts.id, reference), eq(paymentCheckouts.status, 'open')));
    throw error;
  }
  if (collection.transactionId) await db.update(paymentCheckouts).set({ providerRef: collection.transactionId }).where(eq(paymentCheckouts.id, reference));

  // Avec un code de confirmation, l'opérateur tranche tout de suite : on lit sa réponse sans attendre.
  const outcome = collection.status === 'pending' ? { status: 'pending' as const, expiresAt: null } : await fulfillMobileCheckout(reference);
  return {
    reference,
    status: outcome.status,
    expiresAt: outcome.expiresAt,
    providerLink: collection.providerLink,
    operator: operator.name,
    amountLabel: offer.amountLabel,
    phoneHint: hint,
  };
}

const close = (reference: string, status: 'failed' | 'expired') =>
  getDb().update(paymentCheckouts).set({ status }).where(and(eq(paymentCheckouts.id, reference), eq(paymentCheckouts.status, 'open')));

const outcomeOf = async (checkout: CheckoutRow): Promise<CheckoutOutcome> => ({
  status: checkout.status === 'paid' ? 'paid' : checkout.status === 'failed' ? 'failed' : checkout.status === 'expired' ? 'expired' : 'pending',
  plan: checkout.plan,
  expiresAt: checkout.status === 'paid' ? await currentExpiry(checkout.userId) : null,
});

/** Relit l'état de la collecte chez le prestataire, et active le palier s'il la dit payée. Idempotent. */
export async function fulfillMobileCheckout(reference: string, now = Date.now()): Promise<CheckoutOutcome> {
  const [checkout] = await getDb().select().from(paymentCheckouts).where(eq(paymentCheckouts.id, reference)).limit(1);
  if (!checkout || checkout.provider !== PROVIDER) throw notFound();
  if (checkout.status !== 'open') return outcomeOf(checkout);

  const tooOld = now - checkout.createdAt.getTime() > OPEN_FOR_MS;
  let collection;
  try {
    collection = await getCollection(reference);
  } catch (error) {
    // Inconnue du prestataire : la demande n'y est jamais arrivée. On ne l'attend pas indéfiniment.
    if (error instanceof AppError && error.code === 'PAYMENT_NOT_FOUND' && tooOld) {
      await close(reference, 'expired');
      return { status: 'expired', plan: checkout.plan, expiresAt: null };
    }
    if (error instanceof AppError && error.code === 'PAYMENT_NOT_FOUND') return { status: 'pending', plan: checkout.plan, expiresAt: null };
    throw error;
  }

  if (collection.status === 'rejected') {
    await close(reference, 'failed');
    return { status: 'failed', plan: checkout.plan, expiresAt: null };
  }
  if (collection.status === 'pending') {
    if (tooOld) await close(reference, 'expired');
    return { status: tooOld ? 'expired' : 'pending', plan: checkout.plan, expiresAt: null };
  }

  /*
    Le prestataire doit confirmer ce qui a été demandé. La demande est la nôtre — notre référence,
    notre montant, relue avec nos clés — donc ce contrôle ne garde pas contre le client, mais
    contre une incohérence chez le prestataire. Il tolère ce qu'un prestataire fait légitimement :
    rendre le montant net de ses frais (quelques pour cent), ou l'exprimer en franc CFA de l'autre
    zone, de même valeur. Refuser à tort laisserait sans palier un client qui a payé.
  */
  const expected = fromMinorUnits(checkout.amountMinor, checkout.currency);
  const sameMoney = (a: string, b: string) => a === b || (CFA.has(a) && CFA.has(b));
  if (
    (collection.amount !== null && Math.abs(collection.amount - expected) > expected * AMOUNT_TOLERANCE) ||
    (collection.currency !== null && !sameMoney(collection.currency, checkout.currency))
  ) {
    console.error('[paiements] collecte Mobile Money incohérente avec la demande enregistrée');
    throw new AppError(409, 'Ce paiement ne correspond pas à la demande enregistrée : contactez l’équipe Smart Creator.', 'PAYMENT_MISMATCH');
  }

  const test = sebpayMode() === 'test';
  const operator = checkout.operator ? checkout.operator.toUpperCase() : 'Mobile Money';
  return activateCheckout(checkout, {
    method: 'mobile_money',
    note: `Paiement en ligne par Mobile Money (${operator}, numéro ${checkout.phoneHint ?? 'non gardé'}${test ? ', bac à sable' : ''})`,
    notice: `Paiement Mobile Money reçu${test ? ' (bac à sable : aucun argent réel)' : ''}.`,
    referenceLine: `Référence : ${reference}${collection.transactionId ? ` · transaction ${collection.transactionId}` : ''}`,
  });
}

/** L'écran qui attend la validation : seul le titulaire de la demande peut la suivre. */
export async function mobileCheckoutStatus(auth: RequestAuth, reference: string): Promise<CheckoutOutcome> {
  const [checkout] = await getDb()
    .select({ userId: paymentCheckouts.userId, provider: paymentCheckouts.provider })
    .from(paymentCheckouts)
    .where(eq(paymentCheckouts.id, reference))
    .limit(1);
  if (!checkout || checkout.provider !== PROVIDER || checkout.userId !== auth.account.user.id) throw notFound();
  return fulfillMobileCheckout(reference);
}

/**
 * Reprend les demandes restées ouvertes — celles d'un compte, ou toutes. Un client qui valide sur
 * son téléphone après avoir fermé l'écran retrouve ainsi son palier sans rien demander.
 * Rend le nombre de paliers activés.
 */
export async function resumeMobileCheckouts(scope: { userId?: string; limit?: number } = {}, now = Date.now()): Promise<number> {
  if (!sebpayConfigured()) return 0;
  const db = getDb();
  const open = await db
    .select({ id: paymentCheckouts.id })
    .from(paymentCheckouts)
    .where(
      and(
        eq(paymentCheckouts.provider, PROVIDER),
        eq(paymentCheckouts.status, 'open'),
        gt(paymentCheckouts.createdAt, new Date(now - OPEN_FOR_MS - 3_600_000)),
        ...(scope.userId ? [eq(paymentCheckouts.userId, scope.userId)] : []),
      ),
    )
    .orderBy(desc(paymentCheckouts.createdAt))
    .limit(scope.limit ?? 5);

  let activated = 0;
  for (const { id } of open) {
    try {
      if ((await fulfillMobileCheckout(id, now)).status === 'paid') activated += 1;
    } catch (error) {
      console.error('[paiements] reprise Mobile Money :', error instanceof AppError ? error.code : 'erreur');
    }
  }
  // Ce qui n'a plus aucune chance d'aboutir cesse d'être « ouvert ».
  if (!scope.userId) {
    await db
      .update(paymentCheckouts)
      .set({ status: 'expired' })
      .where(and(eq(paymentCheckouts.provider, PROVIDER), eq(paymentCheckouts.status, 'open'), lt(paymentCheckouts.createdAt, new Date(now - OPEN_FOR_MS - 3_600_000))));
  }
  return activated;
}

/**
 * Notification du prestataire. Elle ne fait que désigner une demande à relire : rien de ce qu'elle
 * affirme n'est cru. Rend la référence à relire, ou null quand elle ne nous concerne pas.
 */
export async function mobileNotificationTarget(rawBody: Buffer, signature: string | undefined): Promise<string | null> {
  let payload: { external_reference?: unknown };
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as { external_reference?: unknown };
  } catch {
    throw new AppError(400, 'Notification illisible.', 'WEBHOOK_BODY_INVALID');
  }
  const reference = typeof payload.external_reference === 'string' ? payload.external_reference.trim() : '';
  if (!/^SC[0-9A-Z]{8,60}$/.test(reference)) return null;

  const [checkout] = await getDb()
    .select({ id: paymentCheckouts.id })
    .from(paymentCheckouts)
    .where(and(eq(paymentCheckouts.id, reference), eq(paymentCheckouts.provider, PROVIDER)))
    .limit(1);
  if (!checkout) return null;
  // Consigné pour savoir si la signature est écrite comme nous la lisons ; l'activation n'en dépend pas.
  if (env.SEBPAY_SECRET_KEY && !signatureMatches(rawBody, signature, env.SEBPAY_SECRET_KEY.trim())) {
    console.warn('[paiements] notification Mobile Money à la signature non reconnue : état relu chez le prestataire');
  }
  return checkout.id;
}
