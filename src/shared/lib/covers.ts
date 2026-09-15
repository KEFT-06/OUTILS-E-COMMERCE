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
  createdAt: string;
  updatedAt: string;
}

export interface CoverInput {
  subject: 'guide' | 'product';
  subjectId: string;
  title: string;
  subtitle?: string;
  description?: string;
  style: 'illustration' | 'photo' | 'minimal';
}

export interface CoverImage {
  bytes: Uint8Array;
  mimeType: string;
  dataUrl: string;
}

export const coversApi = {
  latest: (subject: 'guide' | 'product', subjectId: string) =>
    apiRequest<{ cover: CoverView | null }>(`/api/covers?subject=${subject}&subjectId=${encodeURIComponent(subjectId)}`).then(
      (response) => response.cover,
    ),
  create: (input: CoverInput) => apiRequest<{ cover: CoverView }>('/api/covers', { method: 'POST', body: input }).then((response) => response.cover),
  refresh: (coverId: string) => apiRequest<{ cover: CoverView }>(`/api/covers/${coverId}`).then((response) => response.cover),
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
    return { bytes, mimeType, dataUrl: `data:${mimeType};base64,${btoa(binary)}` };
  },
};
