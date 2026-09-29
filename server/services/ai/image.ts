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

/**
 * Pannes du fournisseur, par opposition à un refus de la description. Seules elles justifient le secours.
 *
 * Les codes de Gemini manquaient : le secours des visuels premium (couvertures, publicités) ne
 * pouvait jamais se déclencher, et un « trop de demandes » chez Google finissait en erreur
 * devant l'auteur alors que l'autre moteur était libre (29/09/2026).
 */
const INFRASTRUCTURE_FAILURES = new Set([
  'CF_IMAGE_QUOTA_EXHAUSTED',
  'CF_IMAGE_UNAVAILABLE',
  'CF_IMAGE_TIMEOUT',
  'CF_IMAGE_FAILED',
  'CF_IMAGE_MISSING',
  'CF_IMAGE_ACCESS_DENIED',
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
   * Ce que l'image doit valoir, d'où découle le fournisseur — et non l'inverse.
   *
   * « fast » : image carrée d'une série (pages d'un conte), une vingtaine de fois moins chère.
   * « quality » (défaut) : image vue de près, à l'unité — une couverture de PDF.
   * « premium » : image que le PUBLIC du client verra, dans une publicité qu'il paie pour
   *   diffuser. Voir `PREMIUM_D_ABORD` pour ce que cela change et ce que cela coûte.
   */
  tier?: 'premium' | 'quality' | 'fast';
}

/**
 * Les visuels publicitaires passent par Gemini en premier ; tout le reste par Cloudflare.
 *
 * Comparé le 27 septembre 2026 sur la même consigne publicitaire, en 9:16 : Nano Banana Pro
 * rend une scène d'Abidjan reconnaissable — circulation, palmiers, lumière de fin de journée —
 * là où FLUX.2 rendait un intérieur qui pourrait être partout. Pour un outil dont la promesse
 * est d'ancrer les créatifs dans le pays du client, l'écart porte précisément sur ce qu'on vend.
 *
 * Il coûte neuf fois plus : 0,134 $ contre 0,015 $. Sur un point facturé (~0,42 $), la marge
 * passe de vingt-huit fois à trois fois — tenable, et réservé aux images qu'un public verra.
 * Une couverture de PDF, lue par son seul auteur, ne justifie pas cette dépense.
 *
 * GARDE-FOU VÉRIFIÉ, ET NON SUPPOSÉ. Sur une consigne nue, ce modèle a ajouté de lui-même un
 * slogan et le logo d'un opérateur télécom bien réel du marché visé. Avec les deux lignes que
 * `buildPrompt` envoie déjà — « No text, no logos, no watermarks » et « No real brand logos » —
 * la scène est restée muette. C'est ce garde-fou, et lui seul, qui rend ce modèle utilisable
 * ici : le retirer de la consigne ferait produire des publicités portant la marque d'autrui.
 */
const PREMIUM_D_ABORD = 'premium';

export async function generateImage(input: GenerateImageInput): Promise<ImageResult> {
  const hasCloudflare = cloudflareImagesConfigured();
  const hasGemini = geminiImagesConfigured();
  if (!hasCloudflare && !hasGemini) throw providerUnavailable('génération d’images');

  const chezGemini = () => generateGeminiImage({ prompt: input.prompt, aspectRatio: input.aspectRatio });

  if (!hasCloudflare) return chezGemini();

  if (input.tier === PREMIUM_D_ABORD && hasGemini) {
    try {
      return await chezGemini();
    } catch (error) {
      const code = error instanceof AppError ? error.code : null;
      // Un refus de CONTENU ne se replie pas : le second fournisseur refuserait de même.
      if (!code || !INFRASTRUCTURE_FAILURES.has(code)) throw error;
      console.warn(`[image] Gemini indisponible (${code}) : repli sur Cloudflare pour un visuel premium.`);
      return generateCloudflareImage({ ...input, tier: 'quality' });
    }
  }

  // Cloudflare ne connaît pas « premium » : il n'a pas de palier au-dessus de « quality ».
  const chezCloudflare = { ...input, tier: input.tier === PREMIUM_D_ABORD ? ('quality' as const) : input.tier };

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
