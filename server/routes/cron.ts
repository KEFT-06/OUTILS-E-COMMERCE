import { timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { env, isServerless } from '@server/env';
import { AppError, asyncRoute } from '@server/middleware';
import { sendDueRadarDigests } from '@server/services/radar/alerts';
import { collectPerformanceContributions } from '@server/services/performanceLoop/collect';
import { discoveryIsDue, harvestCollectionRuns, runDiscovery } from '@server/services/radar/discovery';
import { purgeStaleThumbnails, storeMissingAvatars, storeMissingThumbnails } from '@server/services/espionnage/media';
import { sweepSessions } from '@server/services/auth/sessions';
import { purgeExpiredAudio } from '@server/services/audio';
import { archivePendingVideos, purgeExpiredVideos } from '@server/services/creatives/archive';
import { purgeStaleVideoUploads } from '@server/services/writing/videoUpload';
import { continueEbookInBackground, resumeEbookJobs } from '@server/services/writing/ebookJobs';
import { continueReportInBackground, resumeReportDocuments } from '@server/services/analysis/document';
import { submitToIndexNow } from '@server/services/seo/indexNow';
import { sweepPendingGenerations } from '@server/services/generations/sweeper';
import { sweepDueWatches } from '@server/services/radar/sweeper';
import { resumeMobileCheckouts } from '@server/services/billing/mobile';
import { runWatchPass } from '@server/services/watch';
import { z } from 'zod';
import { detectAlerts } from '@server/services/alerts';
import { settleDueCommissions } from '@server/services/referral';
import { collectorPlan, ingestLibraryRecords, recordCollectorRun } from '@server/services/espionnage/library';
import { pendingCollectorSearches, pourCollectorSearch } from '@server/services/espionnage/search';
import { indexDiscoveredStores, reportMarketRun } from '@server/services/market';
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

    // Paiements Mobile Money validés après que le client a quitté l'écran : leur palier s'active ici au plus tard.
    await resumeMobileCheckouts({ limit: 20 }).catch((error: unknown) => {
      console.warn('[cron] paiements Mobile Money :', error instanceof Error ? error.message : error);
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
    // Les pistes audio suivent la conservation des vidéos du palier : même passage.
    await purgeExpiredAudio().catch((error: unknown) => {
      console.warn('[cron] effacement des pistes audio échues :', error instanceof Error ? error.message : error);
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
 * Passage de VEILLE CONTINUE, appelé toutes les demi-heures par l'atelier « Veille continue »
 * (.github/workflows/veille.yml).
 *
 * Demande du propriétaire, 11/10/2026 : « je veux que ça tourne en continu, que ce soit pour le
 * radar, les alertes, l'espionnage ». L'hébergeur ne réveille le site qu'une fois par jour : le
 * radar ne relevait donc qu'à 03 h, les alertes ne se calculaient qu'à 04 h, et une nuit ratée
 * laissait le fil vide jusqu'au lendemain. Ce passage fait, en petit et souvent, ce que les deux
 * réveils font en gros et une fois : les surveillances dues, les boutiques de l'index dont le
 * relevé du jour est dû, puis les alertes sur ce qui vient d'être relevé — ventes et publicités.
 *
 * Il rend un compte rendu chiffré, sans nom de boutique ni de compte : l'atelier l'affiche.
 */
cronRouter.get(
  '/veille',
  asyncRoute(async (req, res) => {
    if (!env.CRON_SECRET) throw new AppError(503, 'Le déclencheur périodique n’est pas configuré sur ce serveur.', 'CRON_NOT_CONFIGURED');
    if (!secretIsValid(req)) throw new AppError(401, 'Déclencheur refusé.', 'CRON_DENIED');

    // Borné : il répond toujours avant le délai de l'atelier, et dit quelles étapes ont pris du retard.
    res.json(await runWatchPass('veille continue'));
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
    // Même filet pour les rapports rédigés : un long rapport quitté en route se termine quand même.
    await resumeReportDocuments().catch((error: unknown) => {
      console.warn('[cron] reprise des rapports :', error instanceof Error ? error.message : error);
    });

    // Référencement : les pages publiques sont déclarées aux moteurs, une fois par mise en ligne.
    const referencement = await submitToIndexNow().catch((error: unknown) => {
      console.warn('[cron] déclaration aux moteurs de recherche :', error instanceof Error ? error.message : error);
      return null;
    });

    /*
      Le relevé tient dans MARKET_RUN_MS, délai de la dernière boutique compris : ce qui vient
      après lui — les alertes, puis la suite — est donc toujours atteint. Et si le relevé échoue
      en entier, la suite part quand même : un maillon neuf a plus de chances qu'un réveil perdu.
    */
    const index = await indexDiscoveredStores(MARKET_RUN_MS).catch((error: unknown) => {
      console.warn('[cron] index du marché :', error instanceof Error ? error.message : error);
      return null;
    });
    const alertes = await detectAlerts().catch((error: unknown) => {
      console.warn('[cron] alertes :', error instanceof Error ? error.message : error);
      return null;
    });
    // Des boutiques attendent encore leur relevé du jour : le site s'en charge lui-même, à la suite.
    await reportMarketRun('réveil de la nuit', index, alertes);
    if (!index || index.remaining > 0) await chainMarketIndex(1);
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
/**
 * Temps de relevé par appel. La requête en a 300 ; une boutique entamée juste avant la fin peut
 * en prendre 45 de plus (server/services/market) : 190 laisse de quoi calculer les alertes et
 * passer la main, toujours.
 */
const MARKET_RUN_MS = 190_000;

async function chainMarketIndex(maillon: number): Promise<void> {
  if (env.NODE_ENV === 'test' || !isServerless || !env.CRON_SECRET || maillon > MARKET_MAX_LINKS) return;
  // Deux essais : un appel perdu arrêtait le relevé de toute la journée.
  for (const essai of [1, 2]) {
    try {
      const response = await fetch(`${env.APP_URL.replace(/\/+$/, '')}/api/cron/marche/suite`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CRON_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ maillon }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return;
      console.warn(`[cron] suite de l’index du marché refusée (${response.status}), essai ${essai}`);
    } catch (error) {
      console.warn(`[cron] suite de l’index du marché non partie, essai ${essai} :`, error instanceof Error ? error.message : error);
    }
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
      const index = await indexDiscoveredStores(MARKET_RUN_MS);
      const alertes = await detectAlerts().catch((error: unknown) => {
        console.warn('[cron] alertes :', error instanceof Error ? error.message : error);
        return null;
      });
      await reportMarketRun(`suite, maillon ${maillon}`, index, alertes);
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

/**
 * Passage suivant d'un rapport rédigé, demandé par le site lui-même à la fin du précédent : un
 * long rapport s'écrit ainsi jusqu'au bout, que son auteur soit resté sur l'écran ou non.
 */
cronRouter.post(
  '/rapport',
  asyncRoute(async (req, res) => {
    if (!env.CRON_SECRET) throw new AppError(503, 'Le déclencheur périodique n’est pas configuré sur ce serveur.', 'CRON_NOT_CONFIGURED');
    if (!secretIsValid(req)) throw new AppError(401, 'Déclencheur refusé.', 'CRON_DENIED');
    const parsed = z.object({ reportId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Rapport inconnu.', 'REPORT_NOT_FOUND');
    continueReportInBackground(parsed.data.reportId);
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
    // Les recherches des clients en attente : le collecteur les lit avant tout le reste.
    res.json({ ...(await collectorPlan()), searches: await pendingCollectorSearches() });
  }),
);

const collecteSchema = z.object({
  /** Pays de la recherche qui a rapporté ces annonces ; « ALL » : tous pays confondus. */
  country: z.string().trim().toUpperCase().regex(/^(ALL|[A-Z]{2})$/).default('ALL'),
  items: z.array(z.record(z.string(), z.unknown())).max(200),
  /** Dernier lot d'un passage : il est inscrit au journal, et les alertes sont recalculées. */
  done: z.boolean().default(false),
  summary: z.record(z.string(), z.unknown()).optional(),
  /** Lot lu pour la recherche d'un client : il la complète, en plus de rejoindre le mur. */
  search: z.object({ id: z.string().uuid(), first: z.boolean().default(false), done: z.boolean().default(false) }).optional(),
  /**
   * Copier les aperçus du lot tout de suite, pendant que les adresses de Meta sont fraîches. Une
   * collecte de plusieurs milliers d'annonces (Firecrawl) dépasse ce que la tenue du mur copie en
   * une journée : sans cela, ses aperçus expireraient avant d'être copiés.
   */
  apercus: z.boolean().default(false),
});

/** Versement d'un lot d'annonces lues dans la bibliothèque publique. */
cronRouter.post(
  '/collecte',
  asyncRoute(async (req, res) => {
    requireCollector(req);
    const parsed = collecteSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Lot d’annonces illisible.', 'COLLECT_INVALID');
    const { country, items, done, summary, search, apercus } = parsed.data;
    const outcome = await ingestLibraryRecords(items, country === 'ALL' ? null : country);
    // Les annonces du lot sont les plus récemment vues : ce sont elles que la copie prend d'abord.
    const thumbnails = apercus && outcome.adsKept > 0 ? await storeMissingThumbnails(Math.min(outcome.adsKept, 60)).catch(() => null) : null;
    const searched = search ? await pourCollectorSearch({ ...search, items }) : null;
    let alertes: number | null = null;
    if (done) {
      await recordCollectorRun(summary ?? {});
      alertes = await detectAlerts().catch(() => null);
    }
    res.json({ ...outcome, alertes, ...(thumbnails ? { thumbnails } : {}), ...(searched ? { searchStored: searched.stored } : {}) });
  }),
);
