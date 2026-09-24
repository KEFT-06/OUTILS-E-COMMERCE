import { env } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';
import type { ImageAspectRatio, ImageResult } from '@server/services/ai/imageTypes';

/**
 * Génération d'image par Cloudflare Workers AI (API REST « ai/run »).
 *
 * Deux modèles, parce qu'ils ne savent pas la même chose :
 *
 *  - « quality » (Leonardo Lucid Origin) accepte une largeur et une hauteur libres. C'est le seul
 *    des deux capable de produire une couverture verticale. Il coûte une vingtaine de fois plus
 *    cher que l'autre : réservé aux images vues de près, à l'unité.
 *  - « fast » (FLUX.1 schnell) ne produit que du carré : il REFUSE width et height, la requête
 *    échoue avec « Additional or unevaluated properties not allowed ». Mesuré sur l'API, pas
 *    déduit de la documentation. Il sert aux séries — les pages intérieures d'un conte.
 *
 * Coût, mesuré lui aussi (le champ « usage.neurons » que renvoie FLUX) :
 *   neurones = tuiles × (prix_tuile + étapes × prix_étape),   tuiles = largeur × hauteur / 512²
 * Le prix par étape se paie donc PAR TUILE : une image deux fois plus large coûte quatre fois plus.
 * La franchise Cloudflare est quotidienne (10 000 neurones, remise à zéro à minuit UTC, sans
 * report) : au-delà, l'offre gratuite refuse la génération au lieu de la facturer.
 *
 * Le jeton part en en-tête, jamais dans l'adresse ni dans un journal.
 */

const TIMEOUT_MS = 120_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * Dimensions par format. Chaque couple respecte exactement le rapport demandé et reste
 * multiple de 16, ce qu'attendent les modèles de diffusion. On vise le mégapixel : au-delà,
 * la facture monte au carré sans que la couverture soit plus lisible.
 */
const DIMENSIONS: Record<ImageAspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '2:3': { width: 832, height: 1248 },
  '3:2': { width: 1248, height: 832 },
  '3:4': { width: 768, height: 1024 },
  '4:3': { width: 1024, height: 768 },
  '4:5': { width: 896, height: 1120 },
  '5:4': { width: 1120, height: 896 },
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
};

/** Le carré est le seul format du modèle rapide : tout autre rapport doit passer par « quality ». */
const FAST_ONLY_RATIO: ImageAspectRatio = '1:1';

/**
 * Ce que le modèle ne doit pas dessiner. Lucid Origin écrit volontiers un titre inventé dès que
 * la description ressemble à une couverture de livre ; la consigne négative le retient.
 */
const NEGATIVE_PROMPT =
  'text, letters, words, typography, title, caption, signage, watermark, logo, book cover layout, ' +
  'deformed hands, extra fingers, distorted face';

interface RunPayload {
  success?: boolean;
  result?: { image?: string; usage?: { neurons?: number } };
  errors?: { code?: number; message?: string }[];
  messages?: { message?: string }[];
}

/** Dernier résultat depuis le démarrage, pour la page « État des services ». */
let lastOutcome: { ok: boolean; code: string | null; at: string; neurons?: number } | null = null;

export function lastCloudflareImageOutcome() {
  return lastOutcome;
}

export function cloudflareImagesConfigured(): boolean {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN);
}

function detailOf(payload: RunPayload | null): string {
  const parts = [...(payload?.errors ?? []).map((e) => e.message), ...(payload?.messages ?? []).map((m) => m.message)];
  return parts.filter(Boolean).join(' — ').slice(0, 300);
}

function cloudflareFailure(status: number, detail: string): AppError {
  console.error('[image cloudflare] le fournisseur a répondu', status, detail);
  if (status === 401 || status === 403) {
    return new AppError(
      503,
      'Cloudflare refuse le jeton du serveur : l’administrateur doit le vérifier (droits « Workers AI » en lecture et en écriture).',
      'CF_IMAGE_ACCESS_DENIED',
    );
  }
  // Franchise quotidienne épuisée sur l'offre gratuite : la génération est refusée, pas facturée.
  if (status === 429) {
    return new AppError(
      429,
      'La réserve d’images Cloudflare du jour est épuisée. Réessayez demain, ou passez le compte en offre payante. Vos points ont été rendus.',
      'CF_IMAGE_QUOTA_EXHAUSTED',
    );
  }
  if (status === 400 || status === 422) {
    return new AppError(502, 'Cloudflare a refusé la description de l’image. Reformulez-la : vos points ont été rendus.', 'CF_IMAGE_BAD_INPUT');
  }
  if (status >= 500) {
    return new AppError(503, 'Cloudflare est momentanément indisponible. Réessayez : vos points ont été rendus.', 'CF_IMAGE_UNAVAILABLE');
  }
  return new AppError(502, 'Cloudflare n’a pas pu produire l’image. Réessayez : vos points ont été rendus.', 'CF_IMAGE_FAILED');
}

/** Reconnaît le format d'après les premiers octets : Cloudflare ne déclare pas le type dans sa réponse JSON. */
function sniffMimeType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export interface CloudflareImageInput {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  /** « fast » : série d'images carrées, une vingtaine de fois moins cher. Défaut : « quality ». */
  tier?: 'quality' | 'fast';
  /** Nombre d'étapes de diffusion. Laissé au défaut du modèle si absent. */
  steps?: number;
}

export async function generateCloudflareImage(input: CloudflareImageInput): Promise<ImageResult> {
  try {
    const image = await produce(input);
    lastOutcome = { ok: true, code: null, at: new Date().toISOString(), ...(image.neurons ? { neurons: image.neurons } : {}) };
    return image;
  } catch (error) {
    if (error instanceof AppError) lastOutcome = { ok: false, code: error.code, at: new Date().toISOString() };
    throw error;
  }
}

async function produce(input: CloudflareImageInput): Promise<ImageResult & { neurons?: number }> {
  if (!cloudflareImagesConfigured()) throw providerUnavailable('génération d’images');

  // Le modèle rapide ne sait faire que du carré : un autre format impose le modèle de qualité.
  const tier = input.tier === 'fast' && input.aspectRatio === FAST_ONLY_RATIO ? 'fast' : 'quality';
  const model = tier === 'fast' ? env.CLOUDFLARE_IMAGE_MODEL_FAST : env.CLOUDFLARE_IMAGE_MODEL;
  const { width, height } = DIMENSIONS[input.aspectRatio];

  const fields: Record<string, string | number> =
    tier === 'fast'
      ? { prompt: input.prompt, steps: input.steps ?? 4 }
      : {
          prompt: input.prompt,
          negative_prompt: NEGATIVE_PROMPT,
          width,
          height,
          steps: input.steps ?? 20,
          guidance: 4.5,
        };

  let response: Response;
  try {
    response = await fetch(`${env.CLOUDFLARE_AI_URL.replace(/\/+$/, '')}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
      method: 'POST',
      // Le jeton part en en-tête ; `encodeRequest` ajoute le type de contenu qui convient au modèle.
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_AI_TOKEN}` },
      ...encodeRequest(model, fields),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(504, 'Cloudflare n’a pas produit l’image à temps. Réessayez : vos points ont été rendus.', 'CF_IMAGE_TIMEOUT');
  }

  const { bytes, neurons } = await readImage(response);

  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES)
    throw new AppError(502, 'L’image générée est vide ou trop lourde.', 'CF_IMAGE_SIZE');

  const mimeType = sniffMimeType(bytes);
  if (!mimeType) throw new AppError(502, 'Format d’image inattendu.', 'CF_IMAGE_FORMAT');

  return { mimeType, bytes, model, ...(typeof neurons === 'number' ? { neurons } : {}) };
}

/**
 * Comment parler au modèle. Deux formes coexistent sur la MÊME route `ai/run`, et rien ne
 * l'annonce : les modèles FLUX.2 refusent un corps JSON par un 400 « required properties at
 * '/' are 'multipart' », et n'acceptent qu'un formulaire multipart. Les autres veulent du JSON.
 *
 * La règle est déduite du nom du modèle plutôt que d'une liste à tenir à jour : la famille
 * FLUX.2 partage cette exigence, et un modèle inconnu retombe sur le JSON, qui est le cas
 * général. Mesuré sur l'API le 24 septembre 2026.
 */
function encodeRequest(model: string, fields: Record<string, string | number>): { headers?: HeadersInit; body: BodyInit } {
  if (!/flux-2/.test(model)) {
    return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) };
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  // Pas de Content-Type ici : `fetch` pose lui-même la frontière du multipart.
  return { body: form };
}

/**
 * Lit l'image, quelle que soit la façon dont le modèle la rend.
 *
 * La plupart répondent un JSON portant l'image en base64. Phoenix, lui, répond directement les
 * octets du JPEG — sans enveloppe, sans champ `success`. Le type de contenu de la réponse est
 * ce qui distingue les deux de façon fiable, et il vaut mieux que la liste des modèles qui font
 * l'un ou l'autre, qui changerait à chaque ajout au catalogue.
 */
async function readImage(response: Response): Promise<{ bytes: Buffer; neurons?: number }> {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';

  if (response.ok && contentType.startsWith('image/')) {
    return { bytes: Buffer.from(await response.arrayBuffer()) };
  }

  const payload = (await response.json().catch(() => null)) as RunPayload | null;
  if (!response.ok || !payload?.success) throw cloudflareFailure(response.status, detailOf(payload));

  const encoded = payload.result?.image;
  if (!encoded) {
    console.error('[image cloudflare] réponse sans image', detailOf(payload));
    throw new AppError(502, 'Cloudflare n’a renvoyé aucune image. Réessayez : vos points ont été rendus.', 'CF_IMAGE_MISSING');
  }

  const neurons = payload.result?.usage?.neurons;
  return { bytes: Buffer.from(encoded, 'base64'), ...(typeof neurons === 'number' ? { neurons } : {}) };
}
