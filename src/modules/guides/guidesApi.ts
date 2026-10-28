import type { GuideSection, ReviewLevel, TranslationCheck, TranslationStatus } from '@server/shared/guides';
import { apiRequest } from '@/shared/lib/api';
import type { CoverView } from '@/shared/lib/covers';

export { coversApi, type CoverView } from '@/shared/lib/covers';

/**
 * Lecture des guides déjà écrits : le module des guides (écriture, traduction, relecture) est retiré
 * depuis le 28/10/2026. Seuls subsistent la liste de « Mes créations » et la page d'impression.
 */

export interface GuideTranslation {
  id: string;
  language: string;
  title: string;
  sections: GuideSection[];
  checks: TranslationCheck[];
  level: ReviewLevel;
  status: TranslationStatus;
  /** Traduction en cours : sections déjà traduites sur celles à traduire. */
  progress: { done: number; total: number } | null;
  /** Le guide a changé depuis cette traduction. */
  outdated: boolean;
  words: number;
  authorValidatedAt: string | null;
  reviewRequestedAt: string | null;
  reviewNote: string | null;
  reviewClaimedAt: string | null;
  reviewedAt: string | null;
  reviewerComment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Guide {
  id: string;
  title: string;
  sourceLanguage: string;
  sections: GuideSection[];
  terms: string[];
  revision: number;
  /** Ce dont le guide est la traduction : un ouvrage, un rapport ou un conte. null : un texte collé autrefois. */
  source: { kind: 'product' | 'report' | 'storybook'; id: string } | null;
  words: number;
  cover: CoverView | null;
  translations: GuideTranslation[];
  createdAt: string;
  updatedAt: string;
}

export interface GuideSummary {
  id: string;
  title: string;
  sourceLanguage: string;
  /** Ce dont le guide est la traduction : un ouvrage, un rapport ou un conte. null : un texte collé autrefois. */
  source: { kind: 'product' | 'report' | 'storybook'; id: string } | null;
  words: number;
  hasCover: boolean;
  updatedAt: string;
  translations: { language: string; level: ReviewLevel; status: TranslationStatus; outdated: boolean }[];
}

const guidePath = (guideId: string) => `/api/guides/${encodeURIComponent(guideId)}`;

export const guidesApi = {
  list: () => apiRequest<{ guides: GuideSummary[] }>('/api/guides'),
  get: (guideId: string) => apiRequest<{ guide: Guide }>(guidePath(guideId)).then((response) => response.guide),
};
