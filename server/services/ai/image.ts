import { AppError, providerUnavailable } from '@server/middleware';
import { cloudflareImagesConfigured, generateCloudflareImage, lastCloudflareImageOutcome } from '@server/services/ai/cloudflareImage';
import { generateGeminiImage, geminiImagesConfigured, lastGeminiImageOutcome } from '@server/services/ai/geminiImage';
import type { ImageAspectRatio, ImageResult } from '@server/services/ai/imageTypes';

/**
 * Façade des générations d'images : le reste du serveur ne nomme aucun fournisseur.
 *
 * Cloudflare Workers AI (FLUX.2 / FLUX.1 schnell) passe en premier pour TOUS les paliers —
 * pile gratuite Smart Translator. Gemini image reste le secours quand la franchise
 * quotidienne Cloudflare est vide ou que le service est en panne.
 *
 * Un refus de CONTENU (description rejetée) ne déclenche pas le repli : le second fournisseur
 * refuserait de même, en facturant l'essai.
 */

export type { ImageAspectRatio, ImageResult } from '@server/services/ai/imageTypes';

/**
 * Pannes du fournisseur, par opposition à un refus de la description. Seules elles justifient le secours.
 */
const INFRASTRUCTURE_FAILURES = new Set([
  'CF_IMAGE_QUOTA_EXHAUSTED',
  'CF_IMAGE_UNAVAILABLE',
  'CF_IMAGE_TIMEOUT',
  'CF_IMAGE_FAILED',
  'CF_IMAGE_MISSING',
  'CF_IMAGE_ACCESS_DENIED',
  'CF_IMAGE_FLAGGED',
  'GEMINI_IMAGE_RATE_LIMITED',
  'GEMINI_IMAGE_OVERLOADED',
  'GEMINI_IMAGE_TIMEOUT',
  'GEMINI_IMAGE_FAILED',
  'GEMINI_IMAGE_MISSING',
  'GEMINI_IMAGE_ACCESS_DENIED',
  'GEMINI_IMAGE_BILLING_REQUIRED',
]);

export interface GenerateImageInput {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  /**
   * « fast » : carré rapide (FLUX.1 schnell). « quality » / « premium » : FLUX.2 (format libre).
   * « premium » n'ouvre plus Gemini en premier — même moteur gratuit, Gemini en secours seulement.
   */
  tier?: 'premium' | 'quality' | 'fast';
}

export async function generateImage(input: GenerateImageInput): Promise<ImageResult> {
  const hasCloudflare = cloudflareImagesConfigured();
  const hasGemini = geminiImagesConfigured();
  if (!hasCloudflare && !hasGemini) throw providerUnavailable('génération d’images');

  const chezGemini = () => generateGeminiImage({ prompt: input.prompt, aspectRatio: input.aspectRatio });

  if (!hasCloudflare) return chezGemini();

  // Cloudflare ne connaît pas « premium » : il n'a pas de palier au-dessus de « quality ».
  const chezCloudflare = { ...input, tier: input.tier === 'premium' ? ('quality' as const) : input.tier };

  try {
    return await generateCloudflareImage(chezCloudflare);
  } catch (error) {
    const code = error instanceof AppError ? error.code : null;
    if (!hasGemini || !code || !INFRASTRUCTURE_FAILURES.has(code)) throw error;
    console.warn(`[image] Cloudflare indisponible (${code}) : repli sur Gemini, plus cher.`);
    return chezGemini();
  }
}

/** Dernier résultat de chaque fournisseur, pour la page « État des services ». */
export function lastImageOutcome() {
  return { cloudflare: lastCloudflareImageOutcome(), gemini: lastGeminiImageOutcome() };
}
