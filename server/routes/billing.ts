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

/** Paiement en ligne des paliers : page de paiement Stripe, confirmation au retour, webhook signé. */

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

/** Corps brut (voir server/app.ts) : la signature porte sur les octets exacts envoyés par Stripe. */
billingRouter.post(
  '/webhook',
  asyncRoute(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'Corps de webhook illisible.', 'WEBHOOK_BODY_INVALID');
    await handleStripeWebhook(req.body, req.get('stripe-signature'));
    res.json({ received: true });
  }),
);
