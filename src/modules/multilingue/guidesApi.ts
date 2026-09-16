import type { GuideSection, ReviewLevel, TranslationCheck, TranslationStatus } from '@server/shared/guides';
import { apiRequest } from '@/shared/lib/api';
import type { CoverView } from '@/shared/lib/covers';

export { coversApi, type CoverView } from '@/shared/lib/covers';

/** Miroir client de `server/routes/guides.ts`. */

export interface GuideTranslation {
  id: string;
  language: string;
  title: string;
  sections: GuideSection[];
  checks: TranslationCheck[];
  level: ReviewLevel;
  status: TranslationStatus;
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
  words: number;
  cover: CoverView | null;
  limits: { languages: number | null; used: number };
  translations: GuideTranslation[];
  createdAt: string;
  updatedAt: string;
}

export interface GuideSummary {
  id: string;
  title: string;
  sourceLanguage: string;
  words: number;
  hasCover: boolean;
  updatedAt: string;
  translations: { language: string; level: ReviewLevel; status: TranslationStatus; outdated: boolean }[];
}

export interface GuideInput {
  title: string;
  sourceLanguage: string;
  sections: GuideSection[];
  terms: string[];
}

export interface TranslationFailure {
  language: string;
  code: string;
  message: string;
}

export interface ReviewItem {
  id: string;
  guideTitle: string;
  from: string;
  to: string;
  words: number;
  note?: string | null;
  requestedAt: string | null;
  claimedAt: string | null;
  reviewedAt: string | null;
}

export interface ReviewerDashboard {
  languages: string[];
  queue: ReviewItem[];
  mine: ReviewItem[];
  completed: ReviewItem[];
}

export interface ReviewDetail extends ReviewItem {
  source: { title: string; sections: GuideSection[]; terms: string[] };
  translation: { title: string; sections: GuideSection[]; checks: TranslationCheck[] };
}

const guidePath = (guideId: string, rest = '') => `/api/guides/${encodeURIComponent(guideId)}${rest}`;
const translationPath = (guideId: string, language: string, rest = '') =>
  guidePath(guideId, `/translations/${encodeURIComponent(language)}${rest}`);

const guideOf = (response: { guide: Guide }) => response.guide;

export const guidesApi = {
  list: () => apiRequest<{ limits: { languages: number | null }; guides: GuideSummary[] }>('/api/guides'),
  get: (guideId: string) => apiRequest<{ guide: Guide }>(guidePath(guideId)).then(guideOf),
  create: (input: GuideInput) => apiRequest<{ guide: Guide }>('/api/guides', { method: 'POST', body: input }).then(guideOf),
  update: (guideId: string, input: GuideInput) => apiRequest<{ guide: Guide }>(guidePath(guideId), { method: 'PUT', body: input }).then(guideOf),
  remove: (guideId: string) => apiRequest<void>(guidePath(guideId), { method: 'DELETE' }),
  translate: (guideId: string, languages: string[]) =>
    apiRequest<{ guide: Guide; failures: TranslationFailure[] }>(guidePath(guideId, '/translations'), { method: 'POST', body: { languages } }),
  retranslate: (guideId: string, language: string) =>
    apiRequest<{ guide: Guide }>(translationPath(guideId, language, '/retranslate'), { method: 'POST' }).then(guideOf),
  editTranslation: (guideId: string, language: string, input: { title: string; sections: GuideSection[] }) =>
    apiRequest<{ guide: Guide }>(translationPath(guideId, language), { method: 'PUT', body: input }).then(guideOf),
  validate: (guideId: string, language: string) =>
    apiRequest<{ guide: Guide }>(translationPath(guideId, language, '/validate'), { method: 'POST' }).then(guideOf),
  requestReview: (guideId: string, language: string, note: string) =>
    apiRequest<{ guide: Guide }>(translationPath(guideId, language, '/review'), {
      method: 'POST',
      body: { consent: true, ...(note.trim() ? { note: note.trim() } : {}) },
    }).then(guideOf),
  cancelReview: (guideId: string, language: string) =>
    apiRequest<{ guide: Guide }>(translationPath(guideId, language, '/review/cancel'), { method: 'POST' }).then(guideOf),
  removeTranslation: (guideId: string, language: string) =>
    apiRequest<{ guide: Guide }>(translationPath(guideId, language), { method: 'DELETE' }).then(guideOf),
};

export const reviewsApi = {
  dashboard: () => apiRequest<ReviewerDashboard>('/api/reviews'),
  setLanguages: (languages: string[]) => apiRequest<ReviewerDashboard>('/api/reviews/languages', { method: 'PUT', body: { languages } }),
  claim: (id: string) => apiRequest<{ review: ReviewDetail }>(`/api/reviews/${id}/claim`, { method: 'POST' }).then((response) => response.review),
  get: (id: string) => apiRequest<{ review: ReviewDetail }>(`/api/reviews/${id}`).then((response) => response.review),
  save: (id: string, input: { title: string; sections: GuideSection[] }) =>
    apiRequest<{ review: ReviewDetail }>(`/api/reviews/${id}`, { method: 'PUT', body: input }).then((response) => response.review),
  release: (id: string) => apiRequest<void>(`/api/reviews/${id}/release`, { method: 'POST' }),
  complete: (id: string, comment: string) =>
    apiRequest<void>(`/api/reviews/${id}/complete`, { method: 'POST', body: comment.trim() ? { comment: comment.trim() } : {} }),
};
