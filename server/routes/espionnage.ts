import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { effectiveLimits } from '@server/services/accounts';
import { listSpiedAds, spiedStores } from '@server/services/espionnage';

/**
 * Mur d'espionnage : lecture seule d'un cache partagé, alimenté par le passage payant de la
 * découverte. Aucune route ici ne déclenche de dépense, et aucune ne coûte de point.
 *
 * La collecte, elle, reste à `POST /api/radar/discover/refresh`, réservée aux administrateurs :
 * un même passage remplit les deux écrans, donc il n'y a qu'un seul endroit où l'on paie.
 */

export const espionnageRouter = Router();

espionnageRouter.use(requireAuth);

const filtersSchema = z.object({
  minDays: z.coerce.number().int().min(0).max(3_650).optional(),
  maxDays: z.coerce.number().int().min(0).max(3_650).optional(),
  storeHost: z.string().trim().max(200).optional(),
  mediaKind: z.enum(['image', 'video']).optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(['oldest', 'newest', 'variants']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

espionnageRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    // Un filtre invalide n'est pas une erreur à afficher : on sert le mur sans lui.
    const parsed = filtersSchema.safeParse(req.query);
    const limite = effectiveLimits(req.auth!.account).spiedAdsVisible;
    res.json(await listSpiedAds(parsed.success ? parsed.data : {}, limite));
  }),
);

espionnageRouter.get(
  '/stores',
  asyncRoute(async (_req, res) => {
    res.json({ stores: await spiedStores() });
  }),
);
