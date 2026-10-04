import { Router } from 'express';
import { asyncRoute } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { countUnreadAlerts, listAlerts, markAlertsSeen } from '@server/services/alerts';

/**
 * Alertes : ce que le radar, l'index du marché et le mur publicitaire ont remarqué.
 * Lecture seule pour l'écran ; les alertes sont calculées par le réveil quotidien.
 */
export const alertsRouter = Router();

alertsRouter.use(requireAuth);

alertsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json({ alerts: await listAlerts(req.auth!.account.user.id) });
  }),
);

/** Chiffre de la cloche : réponse d'un entier, lue à chaque écran. */
alertsRouter.get(
  '/unread',
  asyncRoute(async (req, res) => {
    res.json({ unread: await countUnreadAlerts(req.auth!.account.user.id) });
  }),
);

alertsRouter.post(
  '/seen',
  asyncRoute(async (req, res) => {
    await markAlertsSeen(req.auth!.account.user.id);
    res.status(204).end();
  }),
);
