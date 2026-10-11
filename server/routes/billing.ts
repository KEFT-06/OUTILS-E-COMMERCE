import { Router } from 'express';
import { AppError, asyncRoute, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import {
  type CheckoutRequest,
  checkoutSchema,
  confirmCheckout,
  confirmSchema,
  handleStripeWebhook,
  startCheckout,
} from '@server/services/billing';
import {
  type MobileCheckoutRequest,
  fulfillMobileCheckout,
  mobileCheckoutSchema,
  mobileCheckoutStatus,
  mobileMoneyOffer,
  mobileNotificationTarget,
  mobileQuoteSchema,
  resumeMobileCheckouts,
  startMobileCheckout,
} from '@server/services/billing/mobile';
import { stripeMode } from '@server/services/billing/stripe';
import { env, providers } from '@server/env';
import { runInBackground } from '@server/shared/backgroundWork';

/**
 * Paiement en ligne des paliers. Par carte : page de paiement Stripe, confirmation au retour,
 * webhook signé. Par Mobile Money : demande sur le téléphone, suivie jusqu'à sa validation.
 */

export const billingRouter = Router();

billingRouter.post(
  '/checkout',
  requireAuth,
  routeLimiter(15, 10),
  validateBody(checkoutSchema),
  asyncRoute(async (req, res) => {
    res.status(201).json(await startCheckout(req.auth!, req.body as CheckoutRequest));
  }),
);

billingRouter.post(
  '/confirm',
  requireAuth,
  routeLimiter(15, 30),
  validateBody(confirmSchema),
  asyncRoute(async (req, res) => {
    res.json(await confirmCheckout(req.auth!, (req.body as { sessionId: string }).sessionId));
  }),
);

/* -------------------------------------------------------------------------- */
/*  Moyens de paiement et Mobile Money                                         */
/* -------------------------------------------------------------------------- */

/**
 * Ce que ce compte peut utiliser pour payer, et le montant du palier demandé. L'écran de choix
 * s'ouvre là-dessus : il ne propose jamais un moyen qui refuserait le paiement.
 */
billingRouter.get(
  '/methods',
  requireAuth,
  asyncRoute(async (req, res) => {
    // Un palier ou une durée mal écrits ne ferment pas l'écran : le montant manque, voilà tout.
    const quote = mobileQuoteSchema.safeParse(req.query);
    const cardMode = stripeMode();
    res.json({
      // En mode test, la page de paiement refuse toute vraie carte : seule l'équipe y va.
      card: { available: providers.payments && (cardMode !== 'test' || req.auth!.account.isStaff), mode: cardMode },
      mobile: await mobileMoneyOffer(req.auth!, quote.success ? quote.data : {}),
    });
  }),
);

billingRouter.post(
  '/mobile/checkout',
  requireAuth,
  routeLimiter(15, 8),
  validateBody(mobileCheckoutSchema),
  asyncRoute(async (req, res) => {
    res.status(201).json(await startMobileCheckout(req.auth!, req.body as MobileCheckoutRequest));
  }),
);

/** Reprend les demandes de ce compte restées ouvertes : un paiement validé après coup y trouve son palier. */
billingRouter.post(
  '/mobile/resume',
  requireAuth,
  routeLimiter(15, 20),
  asyncRoute(async (req, res) => {
    res.json({ activated: await resumeMobileCheckouts({ userId: req.auth!.account.user.id, limit: 3 }) });
  }),
);

/** Suivi d'une demande par son auteur, pendant qu'il la valide sur son téléphone. */
billingRouter.get(
  '/mobile/:reference',
  requireAuth,
  routeLimiter(15, 240),
  asyncRoute(async (req, res) => {
    const reference = String(req.params.reference ?? '');
    if (!/^SC[0-9A-Z]{8,60}$/.test(reference)) throw new AppError(404, 'Paiement introuvable sur votre compte.', 'PAYMENT_NOT_FOUND');
    res.json(await mobileCheckoutStatus(req.auth!, reference));
  }),
);

/**
 * Notification du prestataire Mobile Money (corps brut, voir server/app.ts). Réponse immédiate,
 * comme il le demande ; l'état est ensuite relu chez lui, et lui seul fait foi.
 */
billingRouter.post(
  '/mobile/notify',
  routeLimiter(5, 120),
  asyncRoute(async (req, res) => {
    if (!env.SEBPAY_SECRET_KEY) throw new AppError(503, 'Paiement Mobile Money non configuré.', 'WEBHOOK_NOT_CONFIGURED');
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'Notification illisible.', 'WEBHOOK_BODY_INVALID');
    const reference = await mobileNotificationTarget(req.body, req.get('x-sebpay-signature'));
    if (reference) {
      runInBackground(async () => {
        await fulfillMobileCheckout(reference);
      }, 'relecture d’un paiement Mobile Money');
    }
    res.json({ received: true });
  }),
);

/** Corps brut (voir server/app.ts) : la signature porte sur les octets exacts envoyés par Stripe. */
billingRouter.post(
  '/webhook',
  asyncRoute(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'Corps de webhook illisible.', 'WEBHOOK_BODY_INVALID');
    await handleStripeWebhook(req.body, req.get('stripe-signature'));
    res.json({ received: true });
  }),
);
