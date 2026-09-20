import { env } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';

/**
 * Génération d'image par Gemini (modèles « Nano Banana », API REST generateContent).
 *
 * L'offre gratuite de Google n'autorise aucune image : sans facturation activée sur le projet de la
 * clé, Google répond 429 avec un quota de 0. Ce cas devient un message clair pour l'administrateur,
 * distinct d'une vraie saturation. La clé part en en-tête, jamais dans l'adresse ni dans un journal.
 */

export type ImageAspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9';

const TIMEOUT_MS = 120_000;
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

export function lastImageOutcome() {
  return lastOutcome;
}

async function callOnce(
  prompt: string,
  aspectRatio: ImageAspectRatio,
  imageSize: '1K' | '2K',
): Promise<{ status: number; payload: ImagePayload | null }> {
  const url = `${env.GEMINI_API_URL.replace(/\/+$/, '')}/v1beta/models/${env.GEMINI_IMAGE_MODEL}:generateContent`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize } },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(504, 'Gemini n’a pas produit l’image à temps. Réessayez : vos points ont été rendus.', 'GEMINI_IMAGE_TIMEOUT');
  }
  return { status: response.status, payload: (await response.json().catch(() => null)) as ImagePayload | null };
}

export async function generateImage(input: {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  imageSize?: '1K' | '2K';
}): Promise<{ mimeType: string; bytes: Buffer; model: string }> {
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
}): Promise<{ mimeType: string; bytes: Buffer; model: string }> {
  if (!env.GEMINI_API_KEY) throw providerUnavailable('rédaction par IA');
  const imageSize = input.imageSize ?? '1K';

  let { status, payload } = await callOnce(input.prompt, input.aspectRatio, imageSize);
  // Saturation passagère chez Google : une seconde tentative ne coûte rien de plus.
  if (status === 503) {
    await sleep(3_000);
    ({ status, payload } = await callOnce(input.prompt, input.aspectRatio, imageSize));
  }

  if (status !== 200) {
    const detail = [payload?.error?.status, payload?.error?.message].filter(Boolean).join(' — ').slice(0, 300);
    console.error('[image gemini] le fournisseur a répondu', status, detail);
    if (status === 429 && /free_tier|limit: 0/i.test(detail)) {
      throw new AppError(
        503,
        'La génération d’images Gemini n’est pas activée pour le site : l’administrateur doit activer la facturation du projet Google de la clé. Vos points ont été rendus.',
        'GEMINI_IMAGE_BILLING_REQUIRED',
      );
    }
    if (status === 429)
      throw new AppError(
        429,
        'Gemini limite temporairement les images. Réessayez dans une minute : vos points ont été rendus.',
        'GEMINI_IMAGE_RATE_LIMITED',
      );
    if (status === 401 || status === 403)
      throw new AppError(503, 'Google refuse la clé Gemini du serveur : l’administrateur doit la vérifier.', 'GEMINI_IMAGE_ACCESS_DENIED');
    if (status === 503)
      throw new AppError(
        503,
        'Gemini est surchargé chez Google. Réessayez dans un instant : vos points ont été rendus.',
        'GEMINI_IMAGE_OVERLOADED',
      );
    throw new AppError(502, 'Gemini n’a pas pu produire l’image. Réessayez : vos points ont été rendus.', 'GEMINI_IMAGE_FAILED');
  }

  const candidate = payload?.candidates?.[0];
  const image = candidate?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
  if (!image?.data) {
    const reason = payload?.promptFeedback?.blockReason ?? candidate?.finishReason ?? '';
    if (/SAFETY|PROHIBITED|BLOCK|RECITATION/i.test(reason)) {
      throw new AppError(
        422,
        'Google a refusé cette image (filtre de sécurité) : reformulez la description. Vos points ont été rendus.',
        'GEMINI_IMAGE_BLOCKED',
      );
    }
    throw new AppError(502, 'Gemini n’a renvoyé aucune image. Réessayez : vos points ont été rendus.', 'GEMINI_IMAGE_MISSING');
  }

  const mimeType = (image.mimeType ?? 'image/png').split(';')[0]!.trim();
  const bytes = Buffer.from(image.data, 'base64');
  if (!ACCEPTED.test(mimeType)) throw new AppError(502, 'Format d’image inattendu.', 'GEMINI_IMAGE_FORMAT');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES)
    throw new AppError(502, 'L’image générée est vide ou trop lourde.', 'GEMINI_IMAGE_SIZE');
  return { mimeType, bytes, model: env.GEMINI_IMAGE_MODEL };
}
