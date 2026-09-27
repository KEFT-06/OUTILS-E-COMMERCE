import { z } from 'zod';
import { env, isProd } from '@server/env';
import { AppError } from '@server/middleware';

/**
 * Rendu vidéo par Veo 3.1, chez Google.
 *
 * TOUT CE QUI SUIT A ÉTÉ MESURÉ SUR L'API le 27 septembre 2026, avec la clé du compte. Rien
 * n'en est déduit d'une documentation, qui ne publie aucune de ces bornes :
 *
 *   · formats acceptés : 9:16 et 16:9, et EUX SEULS. Le carré est refusé —
 *     « `aspectRatio` does not support `1:1` ». C'est la contrainte qui a coûté le format
 *     carré au module vidéo, et aucun modèle vidéo du catalogue Google ne le rend.
 *   · durées acceptées : 4, 6 et 8 secondes. Un JEU DISCRET, et non une plage : 5 et 7 sont
 *     refusés, alors même que le message d'erreur annonce « une valeur entre 4 et 8 ». Se
 *     fier à ce message aurait fait échouer une génération sur deux.
 *   · résolutions : 720p, 1080p, 4k. « 2160p » est refusé, bien qu'il désigne la même chose.
 *   · `negativePrompt` est accepté — ce que le modèle d'IMAGE de Google, lui, ne propose pas.
 *     C'est par là que passe l'interdiction des marques et du texte à l'écran.
 *
 * Le rendu est une opération longue : on soumet, on sonde, puis on relaie le fichier. Le
 * lien de téléchargement n'est utilisable qu'avec la clé du serveur, et ne sort donc jamais
 * d'ici — c'est le serveur qui va chercher les octets et les sert depuis notre origine.
 */

const TIMEOUT_MS = 120_000;

/** Adresse de boucle locale : la seule tolérée hors HTTPS, et seulement hors production. */
const LOOPBACK = /^(127.0.0.1|[::1]|localhost)$/;

/** Formats rendus par Veo. Le carré n'en fait pas partie, et cela ne se contourne pas. */
export const VEO_FORMATS = ['9:16', '16:9'] as const;
/** Durées rendues par Veo. Jeu discret : toute autre valeur est refusée. */
export const VEO_DURATIONS = [4, 6, 8] as const;

export type VeoFormat = (typeof VEO_FORMATS)[number];
export type VeoDuration = (typeof VEO_DURATIONS)[number];

/**
 * Identifiant de demande servi au client.
 *
 * Google nomme ses opérations `models/<modèle>/operations/<id>` ; seul l'`<id>` voyage, et
 * le modèle est remis devant au moment de sonder. Laisser passer le chemin entier
 * permettrait de faire interroger par le serveur une adresse choisie par l'appelant.
 */
export const veoRequestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{6,128}$/, 'Identifiant de génération invalide.');

export type VeoStatus = 'queued' | 'completed' | 'failed';

export interface VeoGeneration {
  requestId: string;
  status: VeoStatus;
  /** Renseigné seulement quand le rendu est terminé. */
  mediaUrl?: string;
  error?: string;
}

export function veoConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

function veoFailure(status: number, detail: string): AppError {
  console.error('[veo] le fournisseur a répondu', status, detail.slice(0, 200));
  if (status === 401 || status === 403) {
    return new AppError(503, 'Google refuse la clé du serveur pour le rendu vidéo.', 'VEO_ACCESS_DENIED');
  }
  if (status === 429) {
    return new AppError(
      429,
      'La réserve de rendus vidéo est épuisée pour le moment. Réessayez plus tard : vos points ont été rendus.',
      'VEO_QUOTA_EXHAUSTED',
    );
  }
  if (status === 400) {
    return new AppError(502, 'Google a refusé la description de la vidéo. Reformulez-la : vos points ont été rendus.', 'VEO_BAD_INPUT');
  }
  // Opération inconnue ou expirée chez Google : elle ne produira jamais rien. Code distinct,
  // pour que le balayeur des générations abandonnées puisse la solder et rendre les points.
  if (status === 404) {
    return new AppError(404, 'Ce rendu vidéo n’existe plus chez Google.', 'VEO_NOT_FOUND');
  }
  if (status >= 500) {
    return new AppError(503, 'Le rendu vidéo est momentanément indisponible. Réessayez : vos points ont été rendus.', 'VEO_UNAVAILABLE');
  }
  return new AppError(502, 'Le rendu vidéo n’a pas abouti. Réessayez : vos points ont été rendus.', 'VEO_FAILED');
}

async function veoFetch(path: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${env.GEMINI_API_URL.replace(/\/+$/, '')}/v1beta/${path}`, {
      method: init.method ?? 'GET',
      // La clé part en en-tête, jamais dans l'adresse : une adresse se retrouve dans les journaux.
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY!, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(init.body ? { body: init.body } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(504, 'Google n’a pas répondu à temps pour le rendu vidéo.', 'VEO_TIMEOUT');
  }

  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) throw veoFailure(response.status, payload?.error?.message ?? '');
  return payload;
}

const operationSchema = z.object({
  name: z.string().min(1),
  done: z.boolean().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  response: z
    .object({
      generateVideoResponse: z
        .object({ generatedSamples: z.array(z.object({ video: z.object({ uri: z.string().url() }).optional() })).optional() })
        .optional(),
    })
    .optional(),
});

/** Ne garde que l'identifiant de l'opération : le chemin complet ne sort pas du serveur. */
const operationId = (name: string): string => name.split('/').pop() ?? name;

export interface VeoInput {
  prompt: string;
  negativePrompt: string;
  aspectRatio: VeoFormat;
  durationSeconds: VeoDuration;
}

/** Corps envoyé à Veo. Fonction pure, testable sans appel réseau. */
export function buildVeoRequest(input: VeoInput) {
  return {
    instances: [{ prompt: input.prompt }],
    parameters: {
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      resolution: env.VEO_RESOLUTION,
      negativePrompt: input.negativePrompt,
    },
  };
}

export async function submitVeoGeneration(input: VeoInput): Promise<VeoGeneration> {
  const payload = await veoFetch(`models/${env.VEO_VIDEO_MODEL}:predictLongRunning`, {
    method: 'POST',
    body: JSON.stringify(buildVeoRequest(input)),
  });
  const parsed = operationSchema.safeParse(payload);
  if (!parsed.success) throw new AppError(502, 'Réponse inattendue du service de rendu vidéo.', 'VEO_BAD_RESPONSE');
  return { requestId: operationId(parsed.data.name), status: 'queued' };
}

export async function getVeoGeneration(requestId: string): Promise<VeoGeneration> {
  const payload = await veoFetch(`models/${env.VEO_VIDEO_MODEL}/operations/${encodeURIComponent(requestId)}`);
  const parsed = operationSchema.safeParse(payload);
  if (!parsed.success) throw new AppError(502, 'Réponse inattendue du service de rendu vidéo.', 'VEO_BAD_RESPONSE');

  const { done, error, response } = parsed.data;
  if (error) return { requestId, status: 'failed', error: error.message ?? 'Le rendu a échoué.' };
  if (!done) return { requestId, status: 'queued' };

  const uri = response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  // Terminé sans fichier : un échec, et il doit rendre les points comme tel.
  if (!uri) return { requestId, status: 'failed', error: 'Le rendu s’est terminé sans vidéo.' };
  return { requestId, status: 'completed', mediaUrl: uri };
}

/**
 * Va chercher les octets de la vidéo.
 *
 * Le lien rendu par Google n'est PAS public : il exige la clé du serveur. C'est donc le
 * serveur qui télécharge, et qui sert ensuite depuis sa propre origine — le client ne voit
 * jamais ni le lien, ni la clé.
 */
export async function fetchVeoMedia(url: string): Promise<Response> {
  let cible: URL;
  try {
    cible = new URL(url);
  } catch {
    throw new AppError(502, 'Lien de fichier invalide renvoyé par le service de rendu.', 'VEO_FILE_INVALID');
  }

  /*
    Le lien vient de Google et n'est suivi que s'il pointe bien chez lui : une réponse altérée
    ferait sinon appeler par le serveur une adresse choisie par un tiers — et avec la clé du
    serveur en en-tête, ce qui la livrerait.

    Même exception que pour les autres fournisseurs : la boucle locale en clair est tolérée
    HORS production, pour qu'une suite de tests puisse servir un fichier depuis un faux
    serveur sans certificat. En production, `isProd` referme la porte.
  */
  const enClairTolere = !isProd && cible.protocol === 'http:' && LOOPBACK.test(cible.hostname);
  if (!enClairTolere && (cible.protocol !== 'https:' || !/(^|\.)googleapis\.com$/.test(cible.hostname))) {
    throw new AppError(502, 'Lien de fichier inattendu renvoyé par le service de rendu.', 'VEO_FILE_INVALID');
  }

  let response: Response;
  try {
    response = await fetch(cible, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY! }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new AppError(502, 'La vidéo générée est injoignable.', 'VEO_FILE_UNREACHABLE');
  }
  if (!response.ok || !response.body) throw new AppError(502, 'La vidéo générée est injoignable.', 'VEO_FILE_UNREACHABLE');
  return response;
}
