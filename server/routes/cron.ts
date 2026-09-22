import { timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { env } from '@server/env';
import { AppError, asyncRoute } from '@server/middleware';
import { sendDueRadarDigests } from '@server/services/radar/alerts';
import { discoveryIsDue, runDiscovery } from '@server/services/radar/discovery';
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

    const sweep = await sweepDueWatches();
    const digests = await sendDueRadarDigests();

    let discovery: Awaited<ReturnType<typeof runDiscovery>> | null = null;
    if (await discoveryIsDue()) {
      // Une découverte en échec ne doit pas annuler le compte rendu du relevé, qui a réussi.
      discovery = await runDiscovery().catch((error: unknown) => {
        console.warn('[cron] découverte impossible :', error instanceof Error ? error.message : error);
        return null;
      });
    }

    res.json({ sweep, digests, discovery });
  }),
);
