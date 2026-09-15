import { apiRequest } from '@/shared/lib/api';
import { readApiError } from '@/shared/lib/apiError';
import type { DigitalProductIdea } from '@/shared/types/analysis';
import type { AdCopyVariant, KitObjective, LaunchKitDraft } from '@/shared/types/launchKit';

/** Taille maximale d'un fichier envoyé au mode Vidéo → Produit. */
export const VIDEO_FILE_MAX_BYTES = 14 * 1024 * 1024;

export interface VideoProductResult {
  product: DigitalProductIdea;
  findings: WritingFinding[];
}

/** Rédaction par l'IA (server/services/writing) : modules d'un produit et textes du kit de lancement. */

export interface WritingFinding {
  label: string;
  severity: 'block' | 'warn';
  category: string;
  matched: string;
  rewriteHint: string;
}

export interface ProductWritingResult {
  modules: { title: string; details: string }[];
  /** Modules que le modèle n'a pas rédigés : leur contenu d'origine est gardé. */
  missing: number;
  findings: WritingFinding[];
}

export interface LaunchKitWritingResult {
  copies: AdCopyVariant[];
  scripts: LaunchKitDraft['scripts'];
  findings: WritingFinding[];
}

export const writingApi = {
  product: (body: {
    product: {
      title: string;
      subtitle: string;
      typeName: string;
      targetAudience: string;
      transformationPromise: string;
      modules: { title: string; details: string }[];
    };
    market: string | null;
  }) => apiRequest<ProductWritingResult>('/api/writing/product', { method: 'POST', body }),

  launchKit: (body: {
    product: { title: string; subtitle: string; targetAudience: string; transformationPromise: string; modules: string[] };
    objective: KitObjective;
    market: string | null;
  }) => apiRequest<LaunchKitWritingResult>('/api/writing/launch-kit', { method: 'POST', body }),

  videoLink: (url: string) => apiRequest<VideoProductResult>('/api/writing/video-link', { method: 'POST', body: { url } }),

  /** Le fichier part tel quel, sans passer par le JSON : 14 Mo au plus. */
  videoFile: async (file: File): Promise<VideoProductResult> => {
    const response = await fetch('/api/writing/video-file', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name.slice(0, 120)) },
      body: file,
    });
    if (!response.ok) throw await readApiError(response, `La vidéo n’a pas pu être transformée (${response.status}).`);
    return (await response.json()) as VideoProductResult;
  },
};
