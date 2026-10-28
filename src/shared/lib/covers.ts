import { apiRequest } from '@/shared/lib/api';

/**
 * Couvertures générées (guides multilingues, ebooks du Studio), servies par
 * `/api/covers`. L'image vit sur le serveur : elle se relit ici pour être
 * intégrée à un export.
 */

export interface CoverView {
  id: string;
  subject: 'guide' | 'product';
  subjectId: string;
  status: 'pending' | 'ready' | 'failed';
  mimeType: string | null;
  /**
   * designed : couverture complète — livre en relief, titre et points forts dans l'image ; elle se
   * montre telle quelle. illustration : image sans texte, sur laquelle la mise en page pose le titre.
   */
  layout: 'designed' | 'illustration';
  createdAt: string;
  updatedAt: string;
}


/** Ce que l'écran sait de l'ouvrage au moment de demander sa couverture. */
export interface CoverImage {
  bytes: Uint8Array;
  mimeType: string;
  dataUrl: string;
  /** L'image porte déjà le titre : un export la pose telle quelle. */
  complete: boolean;
}

/** La couverture porte-t-elle déjà son titre ? */
export const isCompleteCover = (cover: Pick<CoverView, 'layout' | 'status'> | null | undefined): boolean => cover?.status === 'ready' && cover.layout === 'designed';

export const coversApi = {
  latest: (subject: 'guide' | 'product', subjectId: string) =>
    apiRequest<{ cover: CoverView | null }>(`/api/covers?subject=${subject}&subjectId=${encodeURIComponent(subjectId)}`).then(
      (response) => response.cover,
    ),
  /** Les couvertures prêtes du compte pour un type de sujet, une par sujet. */
  mine: (subject: 'guide' | 'product') => apiRequest<{ covers: CoverView[] }>(`/api/covers/mine?subject=${subject}`).then((response) => response.covers),
  remove: (coverId: string) => apiRequest<void>(`/api/covers/${coverId}`, { method: 'DELETE' }),
  imageUrl: (cover: Pick<CoverView, 'id' | 'updatedAt'>) => `/api/covers/${cover.id}/image?v=${encodeURIComponent(cover.updatedAt)}`,
  /** Image prête, lue pour être intégrée à un export (PDF, DOCX, HTML). */
  async image(coverId: string): Promise<CoverImage> {
    const response = await fetch(`/api/covers/${coverId}/image`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('La couverture n’a pas pu être chargée.');
    const mimeType = response.headers.get('content-type')?.split(';')[0] ?? 'image/png';
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return { bytes, mimeType, dataUrl: `data:${mimeType};base64,${btoa(binary)}`, complete: response.headers.get('x-cover-layout') === 'designed' };
  },
};
