/**
 * Contrat commun aux fournisseurs d'images (Cloudflare Workers AI, Gemini).
 *
 * Dans un fichier à part pour qu'aucun fournisseur n'ait à importer l'autre : la façade
 * server/services/ai/image.ts est seule à les connaître tous les deux.
 */

export type ImageAspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9';

export interface ImageResult {
  mimeType: string;
  bytes: Buffer;
  /** Modèle réellement employé, conservé avec la génération pour la traçabilité. */
  model: string;
}
