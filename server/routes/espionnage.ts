import { Router } from 'express';
import { z } from 'zod';
import { providers } from '@server/env';
import { asyncRoute, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { effectiveLimits } from '@server/services/accounts';
import { listSpiedAds, refreshWall, refreshWallInBackground, spiedStores } from '@server/services/espionnage';
import { sendAdDownload, sendAdThumbnail, sendAdVideo, sendPageAvatar } from '@server/services/espionnage/media';
import { STOREFRONTS } from '@server/shared/storefronts';
import {
  type AdSearchRequest,
  adSearchRequestSchema,
  getAdSearch,
  recentAdSearches,
  searchQuota,
  startAdSearch,
} from '@server/services/espionnage/search';

/**
 * Mur d'espionnage : lecture seule d'un cache partagé, alimenté par le passage payant de la
 * découverte. Aucune route ici ne déclenche de dépense, et aucune ne coûte de point.
 *
 * La collecte, elle, reste à `POST /api/radar/discover/refresh`, réservée aux administrateurs :
 * un même passage remplit les deux écrans, donc il n'y a qu'un seul endroit où l'on paie.
 */

export const espionnageRouter = Router();

/**
 * Aperçu d'une annonce, conservé chez nous. Public, et mis en cache par l'hébergeur : ce sont des
 * publicités que Meta montre à tout le monde, et une vignette ne doit pas coûter un appel au serveur
 * à chaque affichage. L'identifiant est celui de la ligne, impossible à deviner.
 */
espionnageRouter.get(
  '/media/:id',
  asyncRoute(async (req, res) => {
    await sendAdThumbnail(req.params.id, res);
  }),
);

/** Photo de profil d'un annonceur, publique et mise en cache comme les aperçus. */
espionnageRouter.get(
  '/avatar/:pageId',
  asyncRoute(async (req, res) => {
    await sendPageAvatar(req.params.pageId, res);
  }),
);

espionnageRouter.use(requireAuth);

const filtersSchema = z.object({
  minDays: z.coerce.number().int().min(0).max(3_650).optional(),
  maxDays: z.coerce.number().int().min(0).max(3_650).optional(),
  storeHost: z.string().trim().max(200).optional(),
  pageId: z.string().regex(/^\d{5,30}$/).optional(),
  mediaKind: z.enum(['image', 'video']).optional(),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  storefront: z.enum(STOREFRONTS).optional(),
  // « active » : ce que Meta déclarait en cours à la dernière collecte ; « arretee » : l'inverse.
  etat: z.enum(['active', 'arretee']).optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(['oldest', 'newest', 'variants']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  batch: z.coerce.number().int().min(0).max(100_000).optional(),
});

espionnageRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    // Un filtre invalide n'est pas une erreur à afficher : on sert le mur sans lui.
    const parsed = filtersSchema.safeParse(req.query);
    const limite = effectiveLimits(req.auth!.account).spiedAdsVisible;
    res.json(await listSpiedAds(parsed.success ? parsed.data : {}, limite));
    refreshWallInBackground();
  }),
);

/** Fichier d'origine d'une publicité (vidéo ou image), remis en téléchargement à un compte connecté. */
espionnageRouter.get(
  '/ads/:id/download',
  routeLimiter(10, 60),
  asyncRoute(async (req, res) => {
    await sendAdDownload(req.params.id, res);
  }),
);

/** Relais de lecture d'une vidéo, pour le lecteur du mur quand il ne peut pas la lire chez Meta directement. */
espionnageRouter.get(
  '/ads/:id/video',
  // Un lecteur vidéo envoie une demande par saut dans la vidéo : le plafond est large.
  routeLimiter(10, 300),
  asyncRoute(async (req, res) => {
    await sendAdVideo(req.params.id, req.headers.range, res);
  }),
);

/** « Actualiser » : fait entrer dans le mur ce qu'une collecte terminée a rapporté. Aucune dépense. */
espionnageRouter.post(
  '/refresh',
  routeLimiter(10, 30),
  asyncRoute(async (_req, res) => {
    res.json(await refreshWall());
  }),
);

/**
 * Recherche par mot-clé dans la bibliothèque publicitaire, comme sur celle de Meta.
 * Une recherche NOUVELLE est facturée chez le fournisseur : quota par palier, plafond mensuel du
 * serveur, et partage de chaque résultat pendant 24 heures (services/espionnage/search.ts).
 */
espionnageRouter.get(
  '/searches',
  asyncRoute(async (req, res) => {
    res.json({ recent: await recentAdSearches(), quota: await searchQuota(req.auth!), configured: providers.apify });
  }),
);

espionnageRouter.post(
  '/searches',
  routeLimiter(10, 20),
  validateBody(adSearchRequestSchema),
  asyncRoute(async (req, res) => {
    res.status(202).json({ search: await startAdSearch(req.auth!, req.body as AdSearchRequest) });
  }),
);

/** Suivi d'une recherche : le client relit toutes les quelques secondes jusqu'au résultat. */
espionnageRouter.get(
  '/searches/:id',
  asyncRoute(async (req, res) => {
    res.json({ search: await getAdSearch(req.auth!, req.params.id) });
  }),
);

espionnageRouter.get(
  '/stores',
  asyncRoute(async (_req, res) => {
    res.json({ stores: await spiedStores() });
  }),
);
