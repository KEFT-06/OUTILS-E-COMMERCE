import { AppError, providerUnavailable } from '@server/middleware';
import { cloudflareImagesConfigured, generateCloudflareImage, lastCloudflareImageOutcome } from '@server/services/ai/cloudflareImage';
import { generateGeminiImage, geminiImagesConfigured, lastGeminiImageOutcome } from '@server/services/ai/geminiImage';
import type { ImageAspectRatio, ImageResult } from '@server/services/ai/imageTypes';

/**
 * Façade des générations d'images : le reste du serveur ne nomme aucun fournisseur.
 *
 * Cloudflare Workers AI passe en premier — une couverture y coûte quelques centimes contre
 * plusieurs dizaines chez Gemini. Gemini reste en secours, et c'est volontaire : la franchise
 * Cloudflare est quotidienne, et un client qui vient de payer ses points ne doit pas se voir
 * refuser sa couverture parce que la réserve du jour est vide. Le repli est journalisé, faute
 * de quoi une facture Gemini inattendue serait impossible à expliquer.
 *
 * Un refus de CONTENU (description rejetée) ne déclenche pas le repli : le second fournisseur
 * refuserait de même, en facturant l'essai.
 */

export type { ImageAspectRatio, ImageResult } from '@server/services/ai/imageTypes';

/** Pannes du fournisseur, par opposition à un refus de la description. Seules elles justifient le secours. */
const INFRASTRUCTURE_FAILURES = new Set([
  'CF_IMAGE_QUOTA_EXHAUSTED',
  'CF_IMAGE_UNAVAILABLE',
  'CF_IMAGE_TIMEOUT',
  'CF_IMAGE_FAILED',
  'CF_IMAGE_MISSING',
  'CF_IMAGE_ACCESS_DENIED',
]);

export interface GenerateImageInput {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  /**
   * « fast » : image carrée d'une série (pages d'un conte), une vingtaine de fois moins chère.
   * « quality » (défaut) : image vue de près, à l'unité — une couverture.
   */
  tier?: 'quality' | 'fast';
}

export async function generateImage(input: GenerateImageInput): Promise<ImageResult> {
  const hasCloudflare = cloudflareImagesConfigured();
  const hasGemini = geminiImagesConfigured();
  if (!hasCloudflare && !hasGemini) throw providerUnavailable('génération d’images');

  if (!hasCloudflare) return generateGeminiImage({ prompt: input.prompt, aspectRatio: input.aspectRatio });

  try {
    return await generateCloudflareImage(input);
  } catch (error) {
    const code = error instanceof AppError ? error.code : null;
    if (!hasGemini || !code || !INFRASTRUCTURE_FAILURES.has(code)) throw error;
    console.warn(`[image] Cloudflare indisponible (${code}) : repli sur Gemini, plus cher.`);
    return generateGeminiImage({ prompt: input.prompt, aspectRatio: input.aspectRatio });
  }
}

/** Dernier résultat de chaque fournisseur, pour la page « État des services ». */
export function lastImageOutcome() {
  return { cloudflare: lastCloudflareImageOutcome(), gemini: lastGeminiImageOutcome() };
}
