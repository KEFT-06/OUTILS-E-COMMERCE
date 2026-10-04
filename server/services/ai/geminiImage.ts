import { env } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';
import { classifyGoogle429, recordGoogleRefusal } from '@server/services/ai/googleRefusal';
import type { ImageAspectRatio, ImageResult } from '@server/services/ai/imageTypes';

/**
 * Génération d'image par Gemini (modèles « Nano Banana », API REST generateContent).
 *
 * L'offre gratuite de Google n'autorise aucune image : sans facturation activée sur le projet de la
 * clé, Google répond 429 avec un quota de 0. Ce cas devient un message clair pour l'administrateur,
 * distinct d'une vraie saturation. La clé part en en-tête, jamais dans l'adresse ni dans un journal.
 */


/** Une image, un modèle : au-delà, on passe au suivant plutôt que d'attendre. */
const TIMEOUT_MS = 90_000;
/** Budget de toute la chaîne de modèles, sous les 300 s accordés à une fonction. */
const CHAIN_BUDGET_MS = 200_000;
/** En deçà, un modèle suivant n'aurait pas le temps de rendre son image. */
const MIN_ATTEMPT_MS = 20_000;
const RETRYABLE = new Set([500, 502, 503, 504]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ACCEPTED = /^image\/(png|jpeg|webp)$/;

interface ImagePayload {
  candidates?: { finishReason?: string; content?: { parts?: { inlineData?: { mimeType?: string; data?: string }; text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { status?: string; message?: string };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Dernier résultat depuis le démarrage, pour la page « État des services » : Google ne dit qu'à la génération si les images sont ouvertes. */
let lastOutcome: { ok: boolean; code: string | null; at: string } | null = null;

export function lastGeminiImageOutcome() {
  return lastOutcome;
}

export function geminiImagesConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

/** Réponse de Google, ou null si le délai a expiré ou la connexion a été coupée. */
async function callOnce(
  model: string,
  prompt: string,
  aspectRatio: ImageAspectRatio,
  imageSize: '1K' | '2K',
  timeoutMs: number,
): Promise<{ status: number; payload: ImagePayload | null } | null> {
  const url = `${env.GEMINI_API_URL.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  return { status: response.status, payload: (await response.json().catch(() => null)) as ImagePayload | null };
}

/** Modèles Nano Banana dans l'ordre d'essai, sans doublon. */
function imageModels(): string[] {
  return [...new Set([env.GEMINI_IMAGE_MODEL, ...env.GEMINI_IMAGE_FALLBACK_MODELS])];
}

export async function generateGeminiImage(input: {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  imageSize?: '1K' | '2K';
}): Promise<ImageResult> {
  try {
    const image = await produceImage(input);
    lastOutcome = { ok: true, code: null, at: new Date().toISOString() };
    return image;
  } catch (error) {
    if (error instanceof AppError) lastOutcome = { ok: false, code: error.code, at: new Date().toISOString() };
    throw error;
  }
}

async function produceImage(input: {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  imageSize?: '1K' | '2K';
}): Promise<ImageResult> {
  if (!env.GEMINI_API_KEY) throw providerUnavailable('génération d’images');
  const imageSize = input.imageSize ?? '1K';
  const deadline = Date.now() + CHAIN_BUDGET_MS;

  /*
    Chaque modèle Nano Banana a ses propres limites chez Google. Un seul modèle, abandonné au
    premier « trop de demandes », faisait voir « service d'images très demandé » à l'auteur
    d'une couverture (29/09/2026) alors que les modèles voisins étaient libres. Désormais : un
    refus de débit fait passer au modèle suivant ; une surcharge est réessayée une fois avant.
  */
  let lastStatus: number | null = null;
  let freeTierOnly = true;
  for (const model of imageModels()) {
    for (const waitMs of [0, 2_500]) {
      if (deadline - Date.now() - waitMs < MIN_ATTEMPT_MS) break;
      await sleep(waitMs);
      const answer = await callOnce(model, input.prompt, input.aspectRatio, imageSize, Math.min(TIMEOUT_MS, deadline - Date.now()));
      if (!answer) {
        lastStatus = 504;
        freeTierOnly = false;
        console.warn(`[image gemini] ${model} n’a pas répondu à temps`);
        break;
      }
      const { status, payload } = answer;
      if (status === 200) return readImage(payload, model);

      const detail = [payload?.error?.status, payload?.error?.message].filter(Boolean).join(' — ').slice(0, 300);
      console.warn(`[image gemini] ${model} a répondu ${status} :`, detail);
      if (status === 401 || status === 403) {
        throw new AppError(503, 'Le service d’images refuse l’accès du serveur : l’administrateur doit vérifier sa configuration.', 'GEMINI_IMAGE_ACCESS_DENIED');
      }
      if (status === 400) {
        throw new AppError(502, 'L’image n’a pas pu être produite. Réessayez : vos points ont été rendus.', 'GEMINI_IMAGE_FAILED');
      }
      if (status === 429) {
        const kind = classifyGoogle429(payload);
        recordGoogleRefusal(kind, model, detail);
        // Projet de la clé bloqué (crédits épuisés, facturation absente) : les autres modèles
        // partagent ce projet et refuseraient de même. On sort tout de suite vers le secours.
        // Un modèle sans franchise gratuite (« no_free_tier »), lui, ne dit rien des suivants :
        // la chaîne continue, et ne conclut à la facturation que si tous ont refusé ainsi.
        if (kind === 'billing') {
          console.error('[image gemini] projet Google sans crédit ni facturation : les images passent par le secours.');
          throw new AppError(
            503,
            'La génération d’images n’est pas encore activée pour le site : l’administrateur doit terminer sa configuration. Vos points ont été rendus.',
            'GEMINI_IMAGE_BILLING_REQUIRED',
          );
        }
      }
      if (!(status === 429 && /free_tier|limit: 0/i.test(detail))) freeTierOnly = false;
      lastStatus = status;
      // Débit dépassé ou modèle retiré : attendre ne changera rien, le modèle suivant a sa chance.
      if (!RETRYABLE.has(status)) break;
    }
  }

  if (lastStatus === 429 && freeTierOnly) {
    throw new AppError(
      503,
      'La génération d’images n’est pas encore activée pour le site : l’administrateur doit terminer sa configuration. Vos points ont été rendus.',
      'GEMINI_IMAGE_BILLING_REQUIRED',
    );
  }
  if (lastStatus === 429) {
    throw new AppError(429, 'L’image n’a pas pu être produite. Vos points ont été rendus.', 'GEMINI_IMAGE_RATE_LIMITED');
  }
  if (lastStatus === 503) {
    throw new AppError(503, 'L’image n’a pas pu être produite. Vos points ont été rendus.', 'GEMINI_IMAGE_OVERLOADED');
  }
  if (lastStatus === 504) {
    throw new AppError(504, 'L’image n’a pas été produite à temps. Réessayez : vos points ont été rendus.', 'GEMINI_IMAGE_TIMEOUT');
  }
  throw new AppError(502, 'L’image n’a pas pu être produite. Réessayez : vos points ont été rendus.', 'GEMINI_IMAGE_FAILED');
}

function readImage(payload: ImagePayload | null, model: string): ImageResult {
  const candidate = payload?.candidates?.[0];
  const image = candidate?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
  if (!image?.data) {
    const reason = payload?.promptFeedback?.blockReason ?? candidate?.finishReason ?? '';
    if (/SAFETY|PROHIBITED|BLOCK|RECITATION/i.test(reason)) {
      throw new AppError(
        422,
        'Cette image a été refusée par le filtre de sécurité : reformulez la description. Vos points ont été rendus.',
        'GEMINI_IMAGE_BLOCKED',
      );
    }
    throw new AppError(502, 'Aucune image n’a été produite. Réessayez : vos points ont été rendus.', 'GEMINI_IMAGE_MISSING');
  }

  const mimeType = (image.mimeType ?? 'image/png').split(';')[0]!.trim();
  const bytes = Buffer.from(image.data, 'base64');
  if (!ACCEPTED.test(mimeType)) throw new AppError(502, 'Format d’image inattendu.', 'GEMINI_IMAGE_FORMAT');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES)
    throw new AppError(502, 'L’image générée est vide ou trop lourde.', 'GEMINI_IMAGE_SIZE');
  return { mimeType, bytes, model };
}
