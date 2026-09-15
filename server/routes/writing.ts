import { Router } from 'express';
import { aiLimiter, asyncRoute, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import {
  type LaunchKitWritingRequest,
  type ProductWritingRequest,
  launchKitWritingSchema,
  productWritingSchema,
  writeLaunchKit,
  writeProduct,
} from '@server/services/writing';

/** Rédaction par l'IA : modules d'un produit et textes du kit de lancement. Facturée, points rendus en cas d'échec. */

export const writingRouter = Router();

writingRouter.post(
  '/product',
  requireAuth,
  requireFeature('ai_writing'),
  aiLimiter,
  validateBody(productWritingSchema),
  asyncRoute(async (req, res) => {
    res.json(await writeProduct(req.auth!, req.body as ProductWritingRequest));
  }),
);

writingRouter.post(
  '/launch-kit',
  requireAuth,
  requireFeature('ai_writing'),
  aiLimiter,
  validateBody(launchKitWritingSchema),
  asyncRoute(async (req, res) => {
    res.json(await writeLaunchKit(req.auth!, req.body as LaunchKitWritingRequest));
  }),
);
