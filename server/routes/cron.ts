import { timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { env } from '@server/env';
import { AppError, asyncRoute } from '@server/middleware';
import { sendDueRadarDigests } from '@server/services/radar/alerts';
import { collectPerformanceContributions } from '@server/services/performanceLoop/collect';
import { discoveryIsDue, runDiscovery } from '@server/services/radar/discovery';
import { sweepSessions } from '@server/services/auth/sessions';
import { archivePendingVideos } from '@server/services/creatives/archive';
import { sweepPendingGenerations } from '@server/services/generations/sweeper';
import { sweepDueWatches } from '@server/services/radar/sweeper';

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

    res.json({ generations, sessions, sweep, digests, discovery, performance, videos });
  }),
);
