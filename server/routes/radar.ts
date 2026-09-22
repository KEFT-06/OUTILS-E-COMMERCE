import { Router } from 'express';
import { z } from 'zod';
import { providers } from '@server/env';
import { AppError, asyncRoute, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth, requirePermission } from '@server/middleware/auth';
import { effectiveLimits } from '@server/services/accounts';
import {
  addWatch,
  countUnreadEvents,
  eventCountsSince,
  listEvents,
  listWatches,
  markEventsRead,
  removeWatch,
  setRadarAlerts,
  sweepNow,
  watchItemsOf,
} from '@server/services/radar';
import { lastDiscoveryAt, listDiscoveredStores, runDiscovery } from '@server/services/radar/discovery';
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

    // Le Cockpit n'affiche que trois lignes : lui envoyer soixante événements serait du poids
    // inutile sur l'écran le plus ouvert du site. L'écran Radar, lui, demande le fil complet.
    const demandes = Number(req.query.events);
    const limite = Number.isInteger(demandes) ? Math.min(Math.max(demandes, 1), 60) : 60;

    const [watches, events, counts] = await Promise.all([
      listWatches(userId),
      listEvents(userId, { limit: limite }),
      eventCountsSince(userId, depuis),
    ]);

    res.json({
      watches,
      events,
      countsLast7Days: counts,
      limit: effectiveLimits(auth.account).watchedStores,
      // L'écran a besoin de l'état de l'interrupteur pour l'afficher sans second appel.
      alertsEnabled: auth.account.user.radarAlertsEnabled,
      /** false : aucun fournisseur d'e-mail sur ce serveur — l'interrupteur le dit plutôt que de mentir. */
      emailConfigured: providers.email,
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

/** Compteur seul, pour la pastille de la barre latérale : réponse minuscule, appelée souvent. */
radarRouter.get(
  '/unread',
  asyncRoute(async (req, res) => {
    res.json({ unread: await countUnreadEvents(req.auth!.account.user.id) });
  }),
);

const alertsSchema = z.object({ enabled: z.boolean() });

/** Résumé par e-mail : activé par défaut, coupé en un clic. */
radarRouter.post(
  '/alerts',
  routeLimiter(10, 20),
  validateBody(alertsSchema),
  asyncRoute(async (req, res) => {
    const { enabled } = req.body as z.infer<typeof alertsSchema>;
    await setRadarAlerts(req.auth!.account.user.id, enabled);
    res.json({ enabled });
  }),
);

/**
 * Boutiques repérées par la découverte publicitaire. Lecture du cache mutualisé : gratuite,
 * et identique pour tous les comptes puisque chercher les vendeurs d'une plateforme donne
 * la même réponse à tout le monde.
 */
radarRouter.get(
  '/discover',
  asyncRoute(async (req, res) => {
    const auth = req.auth!;
    res.json({
      stores: await listDiscoveredStores(),
      lastRunAt: (await lastDiscoveryAt())?.toISOString() ?? null,
      configured: providers.apify,
      /** Seul un administrateur peut lancer une collecte : chaque passage coûte de l'argent. */
      canRefresh: auth.account.user.role === 'admin',
    });
  }),
);

/**
 * Lance une collecte payante. Réservée aux administrateurs, et limitée : le rythme normal
 * est celui du planificateur, cette route sert à ne pas attendre la semaine suivante.
 */
radarRouter.post(
  '/discover/refresh',
  requirePermission('admin.security.read'),
  routeLimiter(60, 3),
  asyncRoute(async (_req, res) => {
    res.json({ outcome: await runDiscovery() });
  }),
);
