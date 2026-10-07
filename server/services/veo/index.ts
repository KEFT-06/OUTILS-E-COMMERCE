import { z } from 'zod';
import { env, isProd } from '@server/env';
import { AppError } from '@server/middleware';
import { classifyGoogle429, recordGoogleRefusal } from '@server/services/ai/googleRefusal';

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
  /** Motif de l'échec, rédigé par le site : le texte du fournisseur ne sort jamais du serveur. */
  error?: string;
  /** Échec dû au fournisseur (panne, surcharge), pas à la demande : la même demande peut aboutir. */
  retryable?: boolean;
}

export function veoConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

/** Refus de Google motivés par le réglage des personnes (voir submitWithFallback). */
const personRefusals = new WeakSet<AppError>();

function veoFailure(status: number, detail: string, payload: unknown = null): AppError {
  console.error('[veo] le fournisseur a répondu', status, detail.slice(0, 200));
  if (status === 401 || status === 403) {
    return new AppError(503, 'Le service vidéo refuse l’accès du serveur : l’administrateur doit vérifier sa configuration.', 'VEO_ACCESS_DENIED');
  }
  if (status === 429) {
    const kind = classifyGoogle429(payload);
    recordGoogleRefusal(kind, 'veo', detail);
    // Projet de la clé sans crédit ni facturation : aucun modèle Veo n'a de franchise gratuite,
    // les autres refuseraient de même.
    if (kind === 'billing' || kind === 'no_free_tier') {
      return new AppError(503, 'Le rendu vidéo est momentanément indisponible : l’administrateur en a été informé. Vos points ont été rendus.', 'VEO_BILLING_REQUIRED');
    }
    return new AppError(
      429,
      'Le rendu vidéo n’a pas pu être lancé. Vos points ont été rendus.',
      'VEO_QUOTA_EXHAUSTED',
    );
  }
  if (status === 400) {
    const refused = new AppError(502, 'La description de la vidéo a été refusée. Reformulez-la : vos points ont été rendus.', 'VEO_BAD_INPUT');
    // Le détail de Google reste côté serveur (il nommerait le fournisseur) : on ne garde que le motif.
    if (/person/i.test(detail)) personRefusals.add(refused);
    return refused;
  }
  // Opération inconnue ou expirée chez Google : elle ne produira jamais rien. Code distinct,
  // pour que le balayeur des générations abandonnées puisse la solder et rendre les points.
  if (status === 404) {
    return new AppError(404, 'Ce rendu vidéo n’existe plus.', 'VEO_NOT_FOUND');
  }
  if (status >= 500) {
    return new AppError(503, 'Le rendu vidéo n’a pas pu aboutir. Vos points ont été rendus.', 'VEO_UNAVAILABLE');
  }
  return new AppError(502, 'Le rendu vidéo n’a pas abouti. Vos points ont été rendus.', 'VEO_FAILED');
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
    throw new AppError(504, 'Le service vidéo n’a pas répondu à temps.', 'VEO_TIMEOUT');
  }

  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) throw veoFailure(response.status, payload?.error?.message ?? '', payload);
  return payload;
}

const operationSchema = z.object({
  name: z.string().min(1),
  done: z.boolean().optional(),
  error: z.object({ code: z.number().optional(), message: z.string().optional() }).optional(),
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

/** Modèles Veo dans l'ordre d'essai : chacun a son propre quota chez Google. */
function veoModels(): string[] {
  return [...new Set([env.VEO_VIDEO_MODEL, ...env.VEO_FALLBACK_MODELS])];
}

/*
  Le suivi d'un rendu passe par l'adresse de SON modèle. Un rendu lancé sur un modèle de secours
  garde donc son rang dans l'identifiant (« m1-… ») ; celui du modèle principal reste nu, comme
  les rendus déjà enregistrés avant cette bascule.
*/
const encodeRequestId = (index: number, id: string) => (index === 0 ? id : `m${index}-${id}`);
function decodeRequestId(requestId: string): { model: string; id: string } {
  const match = /^m(\d)-(.+)$/.exec(requestId);
  const models = veoModels();
  if (match && models[Number(match[1])]) return { model: models[Number(match[1])]!, id: match[2]! };
  return { model: env.VEO_VIDEO_MODEL, id: requestId };
}

/**
 * Réglage des personnes autorisé en Europe. Les fonctions tournent à Dublin depuis le
 * 29/09/2026 ; Google n'y admet que « allow_adult » pour les personnes. Le site n'envoie aucun
 * réglage (Google applique celui de la région) ; si Google refusait quand même la demande pour
 * ce motif, elle repart une fois avec le réglage européen explicite.
 */
const EU_PERSON_GENERATION = 'allow_adult';
const personRefusal = (error: unknown) => error instanceof AppError && personRefusals.has(error);

function withPersonGeneration(body: unknown): unknown {
  const request = body as { parameters?: Record<string, unknown> };
  return { ...request, parameters: { ...(request.parameters ?? {}), personGeneration: EU_PERSON_GENERATION } };
}

/** Refus qui tiennent au modèle sollicité, pas à la demande : on passe au suivant. */
const NEXT_MODEL_CODES = new Set(['VEO_QUOTA_EXHAUSTED', 'VEO_UNAVAILABLE', 'VEO_TIMEOUT']);

/**
 * Lance un rendu, en passant au modèle Veo suivant quand le précédent est à bout de quota, en
 * panne ou muet. Un refus de facturation ou une description refusée ne changent pas de modèle.
 */
async function submitWithFallback(body: unknown): Promise<VeoGeneration> {
  const models = veoModels();
  let last: unknown = null;
  for (const [index, model] of models.entries()) {
    try {
      let payload: unknown;
      try {
        payload = await veoFetch(`models/${model}:predictLongRunning`, { method: 'POST', body: JSON.stringify(body) });
      } catch (error) {
        if (!personRefusal(error)) throw error;
        console.warn('[veo] réglage des personnes refusé dans cette région : nouvel essai avec « allow_adult »');
        payload = await veoFetch(`models/${model}:predictLongRunning`, { method: 'POST', body: JSON.stringify(withPersonGeneration(body)) });
      }
      const parsed = operationSchema.safeParse(payload);
      if (!parsed.success) throw new AppError(502, 'Réponse inattendue du service de rendu vidéo.', 'VEO_BAD_RESPONSE');
      return { requestId: encodeRequestId(index, operationId(parsed.data.name)), status: 'queued' };
    } catch (error) {
      // Quota atteint, panne ou silence de ce modèle : le suivant a son propre quota et sa propre flotte.
      if (error instanceof AppError && NEXT_MODEL_CODES.has(error.code)) {
        console.warn(`[veo] ${error.code} sur ${model}${index + 1 < models.length ? ', modèle suivant' : ''}`);
        last = error;
        continue;
      }
      /*
        Un modèle de secours qui échoue pour une raison à lui (retiré, mal nommé) ne doit pas
        masquer la panne du principal : c'est elle qu'on rend. Une description refusée, en
        revanche, est le vrai motif — elle le serait partout.
      */
      if (last !== null && !(error instanceof AppError && error.code === 'VEO_BAD_INPUT')) {
        console.warn(`[veo] le modèle de secours ${model} n’a pas pris le relais :`, error instanceof AppError ? error.code : error);
        continue;
      }
      throw error;
    }
  }
  throw last;
}

export interface VeoInput {
  prompt: string;
  negativePrompt: string;
  aspectRatio: VeoFormat;
  durationSeconds: VeoDuration;
  /** Premier plan d'une vidéo longue : rendu en 720p, seule résolution que Google sait prolonger. */
  extendable?: boolean;
  /** Résolution imposée, pour une relance aux réglages les plus sûrs. Absente : celle de la durée. */
  resolution?: string;
}

/** Résolution des prolongations, imposée par Google (« 720p only for extension »). */
export const VEO_EXTENSION_RESOLUTION = '720p';
/** Secondes ajoutées par une prolongation, et plafonds de Google (148 s au total, 141 s au plus en entrée). */
export const VEO_EXTENSION_SECONDS = 7;
export const VEO_MAX_TOTAL_SECONDS = 148;
export const VEO_MAX_INPUT_SECONDS = 141;
/** Une vidéo ne se prolonge que dans les deux jours où Google la garde. */
export const VEO_EXTENSION_WINDOW_MS = 2 * 86_400_000;

/**
 * Résolution demandée pour une durée donnée.
 *
 * Google n'accepte le 1080p et le 4K QU'EN 8 secondes (« must be 8s with 1080p/4k »,
 * ai.google.dev/gemini-api/docs/veo, lu le 28 septembre 2026). La résolution configurée était
 * envoyée pour toutes les durées : une vidéo de 4 ou 6 secondes était refusée, les points
 * rendus, et l'utilisateur repartait sans vidéo. En dessous de 8 secondes, c'est donc 720p.
 */
export function veoResolutionFor(durationSeconds: VeoDuration, extendable = false): string {
  if (extendable) return VEO_EXTENSION_RESOLUTION;
  return durationSeconds === 8 ? env.VEO_RESOLUTION : '720p';
}

/** Corps envoyé à Veo. Fonction pure, testable sans appel réseau. */
export function buildVeoRequest(input: VeoInput) {
  return {
    instances: [{ prompt: input.prompt }],
    parameters: {
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      resolution: input.resolution ?? veoResolutionFor(input.durationSeconds, input.extendable),
      negativePrompt: input.negativePrompt,
    },
  };
}

export async function submitVeoGeneration(input: VeoInput): Promise<VeoGeneration> {
  return submitWithFallback(buildVeoRequest(input));
}

/**
 * Corps d'une prolongation, tel que documenté par Google (ai.google.dev/gemini-api/docs/veo,
 * exemple REST, lu le 28 septembre 2026) : la vidéo précédente part en octets (`inlineData`),
 * et la résolution est forcément 720p. Google rend la vidéo ENTIÈRE, prolongée de 7 secondes.
 * Fonction pure, testable sans appel réseau.
 */
export function buildVeoExtensionRequest(input: { prompt: string; video: Buffer }) {
  return {
    instances: [{ prompt: input.prompt, video: { inlineData: { mimeType: 'video/mp4', data: input.video.toString('base64') } } }],
    parameters: { numberOfVideos: 1, resolution: VEO_EXTENSION_RESOLUTION },
  };
}

export async function submitVeoExtension(input: { prompt: string; video: Buffer }): Promise<VeoGeneration> {
  return submitWithFallback(buildVeoExtensionRequest(input));
}

export async function getVeoGeneration(requestId: string): Promise<VeoGeneration> {
  const { model, id } = decodeRequestId(requestId);
  const payload = await veoFetch(`models/${model}/operations/${encodeURIComponent(id)}`);
  const parsed = operationSchema.safeParse(payload);
  if (!parsed.success) throw new AppError(502, 'Réponse inattendue du service de rendu vidéo.', 'VEO_BAD_RESPONSE');

  const { done, error, response } = parsed.data;
  if (error) {
    /*
      Le texte du fournisseur reste dans le journal. Il était rendu tel quel à l'écran du client :
      « Video generation failed due to an internal server issue. Please try again in a few
      minutes… contact Gemini API support » (vu le 06/10/2026) — en anglais, au nom du
      fournisseur, et en demandant d'attendre.
    */
    const detail = error.message ?? '';
    console.error('[veo] rendu échoué chez le fournisseur :', error.code ?? '', detail.slice(0, 300));
    // Codes google.rpc : 4 délai dépassé, 8 ressources épuisées, 13 erreur interne, 14 indisponible.
    const retryable = [4, 8, 13, 14].includes(error.code ?? -1) || /internal|try again|unavailable|overload|capacity|temporar|timed? ?out/i.test(detail);
    return {
      requestId,
      status: 'failed',
      retryable,
      error: retryable
        ? 'Le rendu de cette vidéo n’a pas abouti. Vos points ont été rendus.'
        : 'Cette scène n’a pas pu être rendue : décrivez-la autrement (personnes réelles, marques et scènes sensibles sont refusées). Vos points ont été rendus.',
    };
  }
  if (!done) return { requestId, status: 'queued' };

  const uri = response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  // Terminé sans fichier : un échec, et il doit rendre les points comme tel.
  if (!uri) {
    return {
      requestId,
      status: 'failed',
      error: 'Cette scène n’a pas pu être rendue : décrivez-la autrement (personnes réelles, marques et scènes sensibles sont refusées). Vos points ont été rendus.',
    };
  }
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
