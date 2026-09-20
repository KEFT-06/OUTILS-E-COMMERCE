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

/** Plafond absolu, tous paliers confondus (server/services/plans). */
export const EBOOK_PAGES_CEILING = 250;

/** Rédaction d'un ebook long, menée par tranches sur le serveur. */
export interface EbookJob {
  id: string;
  /** « ebook » : contenu d'un produit. « market_report » : dossier développant une analyse. */
  kind: 'ebook' | 'market_report';
  title: string;
  productId: string;
  status: 'queued' | 'outline' | 'writing' | 'completed' | 'failed';
  targetPages: number;
  sectionsDone: number;
  sectionsTotal: number;
  wordsWritten: number;
  pagesWritten: number;
  outline: { chapters: { index: number; title: string }[] } | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface EbookResult {
  title: string;
  productId: string;
  chapters: { title: string; content: string }[];
  words: number;
  pages: number;
}

/** Au-delà, un dossier de marché se répète : l'étude n'a pas plus de matière. */
export const MARKET_REPORT_PAGES_CEILING = 100;

export const ebookApi = {
  /** Dossier stratégique développant une analyse : les faits sont relus côté serveur. */
  startMarketReport: (body: { reportId: string; targetPages: number }) =>
    apiRequest<{ job: EbookJob }>('/api/writing/market-report', { method: 'POST', body }),

  start: (body: {
    productId: string;
    title: string;
    subtitle: string;
    typeName: string;
    targetAudience: string;
    transformationPromise: string;
    chapters: { title: string; details: string }[];
    market: string | null;
    targetPages: number;
  }) => apiRequest<{ job: EbookJob }>('/api/writing/ebook', { method: 'POST', body }),

  active: () => apiRequest<{ job: EbookJob | null }>('/api/writing/ebook/active'),

  /** Le suivi renvoie l'avancement, et relance au passage la tranche suivante. */
  follow: (id: string) => apiRequest<{ job: EbookJob }>(`/api/writing/ebook/${encodeURIComponent(id)}`),

  /** Renonce à une rédaction en cours : points rendus, compte libéré tout de suite. */
  cancel: (id: string) => apiRequest<{ job: EbookJob }>(`/api/writing/ebook/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  result: (id: string) => apiRequest<EbookResult>(`/api/writing/ebook/${encodeURIComponent(id)}/result`),
};

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
