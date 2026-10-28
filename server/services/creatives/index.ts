import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';
import { env, isProd } from '@server/env';
import { AppError } from '@server/middleware';
import { type FalQueueStatus, getFalGeneration } from '@server/services/fal';
import { type VeoGeneration, fetchVeoMedia, getVeoGeneration } from '@server/services/veo';
import { fetchArchivedVideo } from '@server/services/creatives/archive';

/**
 * Créatifs DÉJÀ produits : où vit leur fichier, leur état chez le fournisseur, et le relais du
 * fichier à son auteur.
 *
 * La création de visuels et de vidéos est retirée du site le 28/10/2026 (décision du propriétaire) :
 * plus aucun brief, aucune consigne, aucun dépôt chez un fournisseur. Ce qui reste sert les
 * créatifs d'avant, que leurs auteurs retrouvent dans « Mes créations ».
 */

/**
 * Où vit le fichier d'un créatif — ce que le suivi a besoin de savoir, et rien d'autre.
 *
 * C'est bien l'ENDROIT qui est nommé, pas le modèle qui a dessiné. « interne » couvre tout
 * ce que nous produisons et gardons nous-mêmes ; derrière, la façade d'images choisit
 * Cloudflare, et bascule sur Gemini quand la réserve du jour est vide. Nommer la ligne
 * d'après le modèle la rendrait fausse une fois sur dix, et c'est une valeur qui reste en
 * base pour toujours.
 *
 * La vidéo est rendue par fal.ai quand sa clé est là (depuis le 26/10/2026 : le projet Gemini est
 * refusé par Google), sinon par Veo. Chaque vidéo garde en base le fournisseur qui l'a rendue.
 * Higgsfield, abandonné, n'est plus un fournisseur : ses anciennes lignes restent en base comme
 * historique, sans fichier (il effaçait tout au bout de sept jours).
 */
export type CreativeProvider = 'fal' | 'veo' | 'interne';

/**
 * Jours pendant lesquels le fichier reste récupérable, par fournisseur ; null : sans limite.
 *
 * Une seule durée (sept jours, celle de Higgsfield) valait pour tous, et elle était fausse
 * deux fois : Google n'y garde une vidéo Veo que DEUX jours (« Generated videos are stored on
 * the server for 2 days, after which they are removed », ai.google.dev/gemini-api/docs/veo,
 * vérifié le 28 septembre 2026) — l'utilisateur qui revenait le troisième jour trouvait un
 * fichier perdu qu'on lui avait promis pour une semaine ; et les visuels générés en interne,
 * enregistrés en base, n'expirent jamais.
 * fal.ai garde la durée précédemment appliquée, faute de durée publiée vérifiée.
 */
export const PROVIDER_RETENTION_DAYS: Record<CreativeProvider, number | null> = {
  veo: 2,
  fal: 7,
  interne: null,
};

export type CreativeState = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled';

export interface CreativeStatus {
  requestId: string;
  status: CreativeState;
  /** Présent quand un fichier est prêt. Le lien lui-même reste côté serveur. */
  mediaType?: 'image' | 'video';
  message?: string;
  /** Jours pendant lesquels le fichier reste récupérable ; null : sans limite. Ajouté par la route. */
  retentionDays?: number | null;
  /** Échec dû au fournisseur : le serveur peut relancer la demande. Ne sort jamais vers le client. */
  retryable?: boolean;
}

/**
 * État de facturation d'une génération. « nsfw » et « canceled » ne produisent
 * aucun fichier : comme un échec, ils rendent les points.
 */
export function generationStateOf(status: CreativeStatus['status']): 'pending' | 'completed' | 'failed' {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'nsfw' || status === 'canceled') return 'failed';
  return 'pending';
}

/** Format du fichier produit, pour les statistiques de contenus. */
export function fileFormatOf(status: CreativeStatus): string | null {
  if (status.mediaType === 'video') return 'mp4';
  if (status.mediaType === 'image') return 'png';
  return null;
}

/** La file de fal.ai ne connaît que trois états ; ni « nsfw » ni « canceled » n'en font partie. */
const FAL_STATUS: Record<FalQueueStatus, CreativeStatus['status']> = {
  IN_QUEUE: 'queued',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
};

function falToClientStatus(generation: { requestId: string; status: FalQueueStatus; mediaType?: 'video' | 'image'; failed?: boolean }): CreativeStatus {
  // Terminé sans fichier : un échec, jamais une réussite facturée sans rien à livrer.
  if (generation.status === 'COMPLETED' && (generation.failed || !generation.mediaType)) {
    return { requestId: generation.requestId, status: 'failed', message: 'La vidéo n’a pas pu être rendue : vos points ont été rendus.' };
  }
  return {
    requestId: generation.requestId,
    status: FAL_STATUS[generation.status],
    ...(generation.mediaType ? { mediaType: generation.mediaType } : {}),
  };
}

/** Veo ne connaît que trois états ; la file de rendu n'expose pas d'étape intermédiaire. */
function veoToClientStatus(generation: VeoGeneration): CreativeStatus {
  if (generation.status === 'failed') {
    return {
      requestId: generation.requestId,
      status: 'failed',
      ...(generation.error ? { message: generation.error } : {}),
      ...(generation.retryable ? { retryable: true } : {}),
    };
  }
  return {
    requestId: generation.requestId,
    status: generation.status === 'completed' ? 'completed' : 'queued',
    ...(generation.status === 'completed' ? { mediaType: 'video' as const } : {}),
  };
}

/** `safe` : réglages les plus sûrs (720p), pour la dernière relance d'un rendu que le fournisseur a fait échouer. */
/**
 * État d'une génération chez son fournisseur. Le fournisseur est lu sur la génération
 * enregistrée : chez fal.ai, l'identifiant du modèle fait partie de l'adresse de suivi,
 * donc un identifiant de demande seul ne suffit pas à retrouver le rendu.
 */
export async function getCreativeStatus(requestId: string, provider: CreativeProvider): Promise<CreativeStatus> {
  if (provider === 'veo') return veoToClientStatus(await getVeoGeneration(requestId));
  // Les vidéos lancées avant la bascule restent suivies chez fal.ai jusqu'à leur terme :
  // rien de ce qui a été payé ne devient inaccessible.
  if (provider === 'fal') return falToClientStatus(await getFalGeneration(env.FAL_VIDEO_MODEL, requestId));
  throw new AppError(404, 'Génération introuvable chez le fournisseur.', 'GENERATION_NOT_FOUND');
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/**
 * Type servi pour un fichier relayé. Seuls les types image et vidéo attendus passent : une
 * page HTML ou un SVG renvoyé par le fournisseur s'exécuterait sinon sur l'origine du site,
 * avec la session du visiteur.
 */
export function servedMediaType(announced: string | null, mediaType: 'image' | 'video'): string {
  const type = announced?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (Object.hasOwn(EXTENSIONS, type)) return type;
  return mediaType === 'video' ? 'video/mp4' : 'image/png';
}

/** Adresse de boucle locale : la seule tolérée hors HTTPS, et seulement hors production. */
const LOOPBACK = /^(127\.0\.0\.1|\[::1\]|localhost)$/;

/**
 * Récupère le fichier produit, quel que soit le fournisseur.
 *
 * Le chiffrement est exigé : un lien en clair exposerait le fichier du client sur le trajet.
 * La seule exception vise la boucle locale hors production, pour qu'une suite de tests puisse
 * servir un fichier depuis un serveur factice sans certificat — jamais en production, où la
 * condition `isProd` referme la porte.
 */
async function fetchGeneratedMedia(url: string): Promise<Response> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new AppError(502, 'Lien de fichier invalide renvoyé par le fournisseur.', 'CREATIVE_FILE_INVALID');
  }
  const enClairTolere = !isProd && target.protocol === 'http:' && LOOPBACK.test(target.hostname);
  if (target.protocol !== 'https:' && !enClairTolere) {
    throw new AppError(502, 'Lien de fichier non sécurisé renvoyé par le fournisseur.', 'CREATIVE_FILE_INSECURE');
  }
  let response: Response;
  try {
    response = await fetch(target, { signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new AppError(502, 'Le fichier généré est injoignable.', 'CREATIVE_FILE_UNREACHABLE');
  }
  if (!response.ok || !response.body) throw new AppError(502, 'Le fichier généré est injoignable.', 'CREATIVE_FILE_UNREACHABLE');
  return response;
}

/**
 * Relaie le fichier généré au navigateur.
 *
 * Servi depuis notre propre origine : la politique de sécurité du navigateur n'a
 * pas à s'ouvrir à un CDN tiers dont on ne connaît pas le domaine, et le
 * téléchargement porte un nom de fichier propre.
 */
export async function streamCreativeFile(
  requestId: string,
  provider: CreativeProvider,
  disposition: 'inline' | 'attachment',
  res: ExpressResponse,
): Promise<void> {
  /*
    Veo est à part sur un point : son lien de téléchargement N'EST PAS public, il exige la
    clé du serveur. Le relais générique, qui va chercher l'adresse sans en-tête, ramènerait
    un 403. C'est donc `fetchVeoMedia` qui télécharge, avec la clé — et le client ne voit ni
    le lien, ni la clé, comme pour tous les autres fournisseurs.
  */
  if (provider === 'veo') {
    // La copie archivée d'abord : elle survit aux deux jours de conservation de Google.
    const archived = await fetchArchivedVideo(requestId);
    if (archived) {
      await relayMedia(archived, 'video', requestId, disposition, res);
      return;
    }
    /*
      Un second essai avant de renoncer. Le lecteur vidéo ne demande le fichier qu'UNE fois :
      une coupure d'une seconde chez le fournisseur lui rendait une erreur, et l'auteur voyait
      une vidéo « cassée » alors qu'elle était prête (constaté le 04/10/2026 : 504 au premier
      appel, fichier servi huit secondes plus tard au second).
    */
    const upstream = await withOneRetry(async () => {
      const generation = await getVeoGeneration(requestId);
      if (generation.status !== 'completed' || !generation.mediaUrl) {
        throw new AppError(409, "Aucun fichier disponible : la génération n'est pas terminée.", 'CREATIVE_NOT_READY');
      }
      return fetchVeoMedia(generation.mediaUrl);
    });
    await relayMedia(upstream, 'video', requestId, disposition, res);
    return;
  }

  // Vidéos rendues chez fal.ai : la copie archivée d'abord, puis le fichier chez fal, avec un second essai.
  if (provider !== 'fal') throw new AppError(404, 'Contenu introuvable.', 'CREATIVE_NOT_FOUND');
  const archived = await fetchArchivedVideo(requestId, 'fal');
  if (archived) {
    await relayMedia(archived, 'video', requestId, disposition, res);
    return;
  }
  const { media, upstream } = await withOneRetry(async () => {
    const generation = await getFalGeneration(env.FAL_VIDEO_MODEL, requestId);
    if (!generation.mediaUrl || !generation.mediaType) {
      throw new AppError(409, "Aucun fichier disponible : la génération n'est pas terminée.", 'CREATIVE_NOT_READY');
    }
    return { media: generation.mediaType, upstream: await fetchGeneratedMedia(generation.mediaUrl) };
  });
  await relayMedia(upstream, media, requestId, disposition, res);
}

/** Réessaie une fois, après une courte pause, quand le fournisseur est injoignable ou trop lent. Jamais sur un refus. */
async function withOneRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof AppError) || ![502, 503, 504].includes(error.status)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    return run();
  }
}

/**
 * Écrit la réponse du fournisseur dans celle du navigateur, en-têtes de sécurité compris.
 *
 * Extrait parce que chaque fournisseur va chercher ses octets différemment — Veo exige la
 * clé du serveur, les autres non — mais que la façon de les SERVIR ne doit pas varier : le
 * type est toujours contraint, le contenu jamais deviné, et l'exécution toujours interdite.
 */
async function relayMedia(
  upstream: Response,
  mediaType: 'image' | 'video',
  requestId: string,
  disposition: 'inline' | 'attachment',
  res: ExpressResponse,
): Promise<void> {
  const contentType = servedMediaType(upstream.headers.get('content-type'), mediaType);
  const extension = EXTENSIONS[contentType]!;

  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  const length = upstream.headers.get('content-length');
  if (length) res.setHeader('Content-Length', length);
  res.setHeader('Content-Disposition', `${disposition}; filename="creatif-${requestId.slice(0, 8)}.${extension}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');

  try {
    await pipeline(Readable.fromWeb(upstream.body as unknown as NodeReadableStream), res);
  } catch {
    // Les en-têtes sont déjà partis : impossible de renvoyer une erreur JSON.
    // On coupe la connexion plutôt que de livrer un fichier tronqué comme complet.
    res.destroy();
  }
}
