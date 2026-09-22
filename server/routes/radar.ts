import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncRoute, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { effectiveLimits } from '@server/services/accounts';
import {
  addWatch,
  eventCountsSince,
  listEvents,
  listWatches,
  markEventsRead,
  removeWatch,
  sweepNow,
  watchItemsOf,
} from '@server/services/radar';
import { radarMeasurements } from '@server/services/radar/measurements';

/**
 * Radar — surveillances du compte connecté.
 *
 * Aucune route ne coûte de point : le radar relève de lui-même, sans geste de
 * l'utilisateur, et facturer un balayage que personne n'a demandé pousserait à le
 * couper. Ce que le palier borne, c'est le NOMBRE de boutiques suivies.
 */

export const radarRouter = Router();

radarRouter.use(requireAuth);

const uuidSchema = z.string().uuid('Identifiant de surveillance invalide.');

function watchId(value: string | undefined): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new AppError(400, 'Identifiant de surveillance invalide.', 'INVALID_WATCH_ID');
  return parsed.data;
}

/** Tableau de bord : surveillances, fil d'événements et compteurs des sept derniers jours. */
radarRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const auth = req.auth!;
    const userId = auth.account.user.id;
    const depuis = new Date(Date.now() - 7 * 86_400_000);

    const [watches, events, counts] = await Promise.all([
      listWatches(userId),
      listEvents(userId, { limit: 60 }),
      eventCountsSince(userId, depuis),
    ]);

    res.json({
      watches,
      events,
      countsLast7Days: counts,
      limit: effectiveLimits(auth.account).watchedStores,
    });
  }),
);

/**
 * Mesures du radar, lues par l'écran d'analyse. Elles ne sont jamais écrites dans un
 * rapport : un document daté ne doit pas changer après son export.
 */
radarRouter.get(
  '/measurements',
  asyncRoute(async (req, res) => {
    res.json(await radarMeasurements(req.auth!.account.user.id));
  }),
);

const addSchema = z.object({
  /** Lien de la boutique, sous-domaine seul, ou identifiant « store_… ». */
  target: z.string().trim().min(2, 'Indiquez le lien de la boutique.').max(300),
});

/** Chaque ajout déclenche un relevé chez un tiers : limite volontairement basse. */
radarRouter.post(
  '/watches',
  routeLimiter(10, 10),
  validateBody(addSchema),
  asyncRoute(async (req, res) => {
    const auth = req.auth!;
    const { target } = req.body as z.infer<typeof addSchema>;
    const result = await addWatch(auth.account.user.id, target, effectiveLimits(auth.account).watchedStores);
    res.status(201).json(result);
  }),
);

radarRouter.delete(
  '/watches/:id',
  asyncRoute(async (req, res) => {
    await removeWatch(req.auth!.account.user.id, watchId(req.params.id));
    res.status(204).end();
  }),
);

/** Articles d'une surveillance : ce qui est en vente, et ce qui s'est arrêté. */
radarRouter.get(
  '/watches/:id/items',
  asyncRoute(async (req, res) => {
    res.json({ items: await watchItemsOf(req.auth!.account.user.id, watchId(req.params.id)) });
  }),
);

radarRouter.get(
  '/watches/:id/events',
  asyncRoute(async (req, res) => {
    const id = watchId(req.params.id);
    res.json({ events: await listEvents(req.auth!.account.user.id, { watchId: id, limit: 100 }) });
  }),
);

/**
 * Relevé à la main. Le radar passe de lui-même chaque jour : cette route sert à ne pas
 * attendre. Elle appelle le site d'un tiers, donc elle est strictement limitée.
 */
radarRouter.post(
  '/watches/:id/sweep',
  routeLimiter(60, 6),
  asyncRoute(async (req, res) => {
    const outcome = await sweepNow(req.auth!.account.user.id, watchId(req.params.id));
    res.json({ outcome });
  }),
);

radarRouter.post(
  '/events/read',
  routeLimiter(1, 30),
  asyncRoute(async (req, res) => {
    res.json({ marked: await markEventsRead(req.auth!.account.user.id) });
  }),
);
