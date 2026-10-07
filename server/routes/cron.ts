import { timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { env, isServerless } from '@server/env';
import { AppError, asyncRoute } from '@server/middleware';
import { sendDueRadarDigests } from '@server/services/radar/alerts';
import { collectPerformanceContributions } from '@server/services/performanceLoop/collect';
import { discoveryIsDue, harvestCollectionRuns, runDiscovery } from '@server/services/radar/discovery';
import { purgeStaleThumbnails, storeMissingAvatars, storeMissingThumbnails } from '@server/services/espionnage/media';
import { sweepSessions } from '@server/services/auth/sessions';
import { archivePendingVideos, purgeExpiredVideos } from '@server/services/creatives/archive';
import { purgeStaleVideoUploads } from '@server/services/writing/videoUpload';
import { continueEbookInBackground, resumeEbookJobs } from '@server/services/writing/ebookJobs';
import { submitToIndexNow } from '@server/services/seo/indexNow';
import { sweepPendingGenerations } from '@server/services/generations/sweeper';
import { sweepDueWatches } from '@server/services/radar/sweeper';
import { z } from 'zod';
import { detectAlerts } from '@server/services/alerts';
import { settleDueCommissions } from '@server/services/referral';
import { collectorPlan, ingestLibraryRecords, recordCollectorRun } from '@server/services/espionnage/library';
import { indexDiscoveredStores } from '@server/services/market';
import { runInBackground } from '@server/shared/backgroundWork';

/**
 * Déclencheur périodique du radar, pour les hébergements où rien ne tourne entre deux requêtes.
 *
 * Le serveur classique garde un minuteur en mémoire (`startRadarSweeper`). En sans-serveur, il
 * n'y a pas de mémoire entre deux requêtes : sans cette adresse, le radar ne relèverait jamais et
 * la promesse du module — ne pas dormir — serait fausse. C'est le seul manque qui rendait tout le
 * reste inutile en production.
 *
 * Appeler deux fois de suite ne relève pas deux fois : c'est la date du dernier passage qui
 * décide, pas l'appel. Un planificateur trop zélé ne cause donc ni double relevé chez un tiers,
 * ni double dépense de collecte.
 */

export const cronRouter = Router();

/**
 * Générations examinées par tour quotidien. Le minuteur du serveur classique en prend
 * vingt-cinq toutes les cinq minutes, soit plus de sept mille par jour ; un seul tour doit
 * donc voir large. Au-delà, le reliquat attend le lendemain — sans perte, puisque le filet
 * des 48 heures les rattrape de toute façon.
 */
const GENERATIONS_PAR_TOUR = 500;

/** Comparaison à durée constante : une comparaison ordinaire laisserait deviner le secret. */
function secretIsValid(req: Request): boolean {
  const attendu = env.CRON_SECRET;
  if (!attendu) return false;
  const entete = req.header('authorization') ?? '';
  const fourni = entete.startsWith('Bearer ') ? entete.slice(7) : entete;
  const a = Buffer.from(fourni);
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GET parce que les planificateurs d'hébergeurs n'envoient que des GET. L'appel modifie l'état,
 * ce qui est inhabituel pour un GET : c'est pourquoi il est protégé par un secret et jamais
 * atteignable par un navigateur ordinaire.
 */
cronRouter.get(
  '/radar',
  asyncRoute(async (req, res) => {
    if (!env.CRON_SECRET) {
      throw new AppError(
        503,
        'Le déclencheur périodique n’est pas configuré sur ce serveur.',
        'CRON_NOT_CONFIGURED',
      );
    }
    if (!secretIsValid(req)) {
      // Même message que pour un secret absent côté client : on ne dit pas laquelle des deux.
      throw new AppError(401, 'Déclencheur refusé.', 'CRON_DENIED');
    }

    /*
      LES GÉNÉRATIONS ABANDONNÉES D'ABORD, parce que c'est de l'argent de clients.

      Le serveur classique suit ces générations par un minuteur toutes les cinq minutes. Sur
      un hébergement sans serveur, un minuteur ne survit pas à la requête qui l'a créé : ce
      balayage ne tournait donc JAMAIS en production. Une vidéo lancée puis abandonnée — onglet
      fermé avant la fin — restait « en cours » pour toujours, ses points réservés à jamais, et
      le filet des 48 heures ne se déclenchait pas non plus puisqu'il vit dans ce même balayage.

      Le radar avait reçu cette adresse pour la même raison ; les générations avaient été
      oubliées. Un tour quotidien les rattrape, avec un plafond à la mesure d'une journée.
    */
    const generations = await sweepPendingGenerations(new Date(), GENERATIONS_PAR_TOUR).catch((error: unknown) => {
      console.warn('[cron] suivi des générations :', error instanceof Error ? error.message : error);
      return null;
    });

    // Même oubli, conséquence moindre : les sessions expirées n'étaient jamais purgées.
    const sessions = await sweepSessions().catch((error: unknown) => {
      console.warn('[cron] purge des sessions :', error instanceof Error ? error.message : error);
      return null;
    });

    const sweep = await sweepDueWatches();
    const digests = await sendDueRadarDigests();
    // Parrainage : fin du délai de garde, les commissions dont le paiement tient sont validées.
    await settleDueCommissions().catch((error: unknown) => {
      console.warn('[cron] commissions de parrainage :', error instanceof Error ? error.message : error);
    });

    /*
      Un relevé par jour des vendeurs consentants. Il ne servira à rien avant que cinq
      vendeurs d'une même niche aient accepté — et c'est précisément pourquoi il commence
      maintenant : un repère qui débute sa collecte le jour où on le lit n'a aucune
      profondeur, et c'est la profondeur qu'on vend.

      Son échec ne doit pas emporter le compte rendu du relevé, qui a réussi.
    */
    const performance = await collectPerformanceContributions().catch((error: unknown) => {
      console.warn('[cron] repère de performance :', error instanceof Error ? error.message : error);
      return null;
    });

    // Collecte de la veille terminée chez Apify : ses annonces rejoignent le mur.
    const harvest = await harvestCollectionRuns().catch((error: unknown) => {
      console.warn('[cron] récolte de la collecte :', error instanceof Error ? error.message : error);
      return null;
    });

    let discovery: Awaited<ReturnType<typeof runDiscovery>> | null = null;
    if (await discoveryIsDue()) {
      // Une découverte en échec ne doit pas annuler le compte rendu du relevé, qui a réussi.
      discovery = await runDiscovery().catch((error: unknown) => {
        console.warn('[cron] découverte impossible :', error instanceof Error ? error.message : error);
        return null;
      });
    }

    // Vidéos Veo terminées mais pas encore copiées (dépôt interrompu) : Google les efface au bout de deux jours.
    const videos = await archivePendingVideos().catch((error: unknown) => {
      console.warn('[cron] archive des vidéos :', error instanceof Error ? error.message : error);
      return null;
    });

    /*
      Le stockage ne garde rien sans date de fin : copies de vidéos arrivées au terme prévu par
      le palier de leur auteur, et dépôts « vidéo vers produit » abandonnés depuis plus de 24 h.
      Sans ce passage, l'espace se remplirait au rythme des inscriptions.
    */
    const expired = await purgeExpiredVideos().catch((error: unknown) => {
      console.warn('[cron] effacement des vidéos échues :', error instanceof Error ? error.message : error);
      return null;
    });
    const uploads = await purgeStaleVideoUploads().catch((error: unknown) => {
      console.warn('[cron] effacement des dépôts abandonnés :', error instanceof Error ? error.message : error);
      return null;
    });

    // Aperçus des annonces : copiés tant que l'adresse de Meta est fraîche, effacés trente jours
    // après la dernière fois qu'une annonce a été vue.
    const thumbnails = await storeMissingThumbnails(300).catch((error: unknown) => {
      console.warn('[cron] aperçus des annonces :', error instanceof Error ? error.message : error);
      return null;
    });
    const avatars = await storeMissingAvatars(200).catch((error: unknown) => {
      console.warn('[cron] photos des annonceurs :', error instanceof Error ? error.message : error);
      return null;
    });
    const staleThumbnails = await purgeStaleThumbnails().catch((error: unknown) => {
      console.warn('[cron] effacement des aperçus :', error instanceof Error ? error.message : error);
      return null;
    });

    res.json({ generations, sessions, sweep, digests, harvest, discovery, performance, videos, expired, uploads, thumbnails, avatars, staleThumbnails });
  }),
);

/**
 * Second réveil quotidien, une heure après le premier : le catalogue des boutiques repérées
 * par leurs publicités rejoint l'index du marché, puis les alertes sont calculées sur un index
 * frais. Séparé du premier parce que celui-ci épuise déjà le temps qu'une fonction peut tenir.
 */
cronRouter.get(
  '/marche',
  asyncRoute(async (req, res) => {
    if (!env.CRON_SECRET) throw new AppError(503, 'Le déclencheur périodique n’est pas configuré sur ce serveur.', 'CRON_NOT_CONFIGURED');
    if (!secretIsValid(req)) throw new AppError(401, 'Déclencheur refusé.', 'CRON_DENIED');

    // Rédactions restées en chemin (relance non partie) : elles repartent, sans attendre leur auteur.
    const redactions = await resumeEbookJobs().catch((error: unknown) => {
      console.warn('[cron] reprise des rédactions :', error instanceof Error ? error.message : error);
      return null;
    });

    // Référencement : les pages publiques sont déclarées aux moteurs, une fois par mise en ligne.
    const referencement = await submitToIndexNow().catch((error: unknown) => {
      console.warn('[cron] déclaration aux moteurs de recherche :', error instanceof Error ? error.message : error);
      return null;
    });

    const index = await indexDiscoveredStores(230_000).catch((error: unknown) => {
      console.warn('[cron] index du marché :', error instanceof Error ? error.message : error);
      return null;
    });
    const alertes = await detectAlerts().catch((error: unknown) => {
      console.warn('[cron] alertes :', error instanceof Error ? error.message : error);
      return null;
    });
    // Des boutiques attendent encore leur relevé du jour : le site s'en charge lui-même, à la suite.
    if (index && index.remaining > 0) await chainMarketIndex(1);
    res.json({ redactions, referencement, index, alertes });
  }),
);

/*
  Le relevé du marché tient en quatre minutes par appel, et l'hébergeur ne réveille le site qu'une
  fois par jour : quelques dizaines de boutiques relevées, sur plusieurs centaines. Chaque boutique
  n'était donc lue que tous les quatre ou cinq jours — or les alertes se lisent en ventes PAR JOUR,
  c'est-à-dire entre deux relevés de jours consécutifs. Tant qu'il reste des boutiques à relever,
  le site se rappelle lui-même (comme pour la rédaction des ebooks), dans une limite qui borne la
  dépense : au plus MARKET_MAX_LINKS maillons par jour.
*/
const MARKET_MAX_LINKS = 14;

async function chainMarketIndex(maillon: number): Promise<void> {
  if (env.NODE_ENV === 'test' || !isServerless || !env.CRON_SECRET || maillon > MARKET_MAX_LINKS) return;
  try {
    const response = await fetch(`${env.APP_URL.replace(/\/+$/, '')}/api/cron/marche/suite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ maillon }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) console.warn(`[cron] suite de l’index du marché refusée (${response.status})`);
  } catch (error) {
    console.warn('[cron] suite de l’index du marché non partie :', error instanceof Error ? error.message : error);
  }
}

/** Maillon suivant du relevé du marché : répond tout de suite, relève ensuite, puis passe la main. */
cronRouter.post(
  '/marche/suite',
  asyncRoute(async (req, res) => {
    if (!env.CRON_SECRET) throw new AppError(503, 'Le déclencheur périodique n’est pas configuré sur ce serveur.', 'CRON_NOT_CONFIGURED');
    if (!secretIsValid(req)) throw new AppError(401, 'Déclencheur refusé.', 'CRON_DENIED');
    const parsed = z.object({ maillon: z.coerce.number().int().min(1).max(MARKET_MAX_LINKS) }).safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Maillon inconnu.', 'MARKET_LINK_INVALID');
    const { maillon } = parsed.data;
    res.status(202).json({ accepted: true, maillon });
    runInBackground(async () => {
      const index = await indexDiscoveredStores(230_000);
      await detectAlerts();
      console.info(`[cron] index du marché, maillon ${maillon} : ${index.indexed} relevées, ${index.failed} en échec, ${index.remaining} en attente`);
      if (index.remaining > 0) await chainMarketIndex(maillon + 1);
    }, 'index du marché, suite');
  }),
);

/**
 * Tranche suivante d'une rédaction longue, demandée par le site lui-même à la fin de la
 * précédente. C'est ce qui fait avancer un ebook écran éteint : la réponse part tout de suite,
 * et la tranche s'écrit ensuite, dans le temps accordé à cette requête.
 */
cronRouter.post(
  '/redaction',
  asyncRoute(async (req, res) => {
    if (!env.CRON_SECRET) throw new AppError(503, 'Le déclencheur périodique n’est pas configuré sur ce serveur.', 'CRON_NOT_CONFIGURED');
    if (!secretIsValid(req)) throw new AppError(401, 'Déclencheur refusé.', 'CRON_DENIED');
    const parsed = z.object({ jobId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Rédaction inconnue.', 'EBOOK_JOB_NOT_FOUND');
    continueEbookInBackground(parsed.data.jobId);
    res.status(202).json({ accepted: true });
  }),
);

/* -------------------------------------------------------------------------- */
/*  Collecteur maison (dossier collecteur/)                                    */
/* -------------------------------------------------------------------------- */

function requireCollector(req: Request): void {
  if (!env.CRON_SECRET) throw new AppError(503, 'Le déclencheur périodique n’est pas configuré sur ce serveur.', 'CRON_NOT_CONFIGURED');
  if (!secretIsValid(req)) throw new AppError(401, 'Déclencheur refusé.', 'CRON_DENIED');
}

/** Ce que le collecteur doit relever : mots-clés, pays, annonces installées à contrôler. */
cronRouter.get(
  '/collecte',
  asyncRoute(async (req, res) => {
    requireCollector(req);
    res.json(await collectorPlan());
  }),
);

const collecteSchema = z.object({
  /** Pays de la recherche qui a rapporté ces annonces ; « ALL » : tous pays confondus. */
  country: z.string().trim().toUpperCase().regex(/^(ALL|[A-Z]{2})$/).default('ALL'),
  items: z.array(z.record(z.string(), z.unknown())).max(200),
  /** Dernier lot d'un passage : il est inscrit au journal, et les alertes sont recalculées. */
  done: z.boolean().default(false),
  summary: z.record(z.string(), z.unknown()).optional(),
});

/** Versement d'un lot d'annonces lues dans la bibliothèque publique. */
cronRouter.post(
  '/collecte',
  asyncRoute(async (req, res) => {
    requireCollector(req);
    const parsed = collecteSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Lot d’annonces illisible.', 'COLLECT_INVALID');
    const { country, items, done, summary } = parsed.data;
    const outcome = await ingestLibraryRecords(items, country === 'ALL' ? null : country);
    let alertes: number | null = null;
    if (done) {
      await recordCollectorRun(summary ?? {});
      alertes = await detectAlerts().catch(() => null);
    }
    res.json({ ...outcome, alertes });
  }),
);
