/** Miroir client de `server/services/storybook`. */

export interface StorybookBrief {
  /** Code pays, validé par le serveur (`marketSchema`). */
  country: string;
  language: 'fr' | 'en';
  ageRange: '3-5' | '6-8' | '9-12';
  pages: number;
  heroName: string;
  heroDescription?: string;
  theme: string;
  culturalElements?: string;
  visualStyle?: string;
}

export interface StorybookStatus {
  generationId: string;
  status: 'pending' | 'completed' | 'failed';
  /** Lien de consultation en ligne. Le lien d'export PDF, secret, ne quitte jamais le serveur. */
  gammaUrl?: string;
  storybookId?: string;
  errorMessage?: string;
}

/** Conte rédigé par l'IA : une page = un titre, un texte et la scène à illustrer. */
export interface StoryDraft {
  title: string;
  characterSheet: string;
  coverIllustration: string;
  pages: { heading: string; text: string; illustration: string }[];
}

/** Conte enregistré sur le compte. */
export interface StorybookEntry {
  id: string;
  generationId: string;
  title: string;
  language: 'fr' | 'en';
  country: string;
  pages: number;
  status: 'pending' | 'completed' | 'failed';
  gammaUrl: string | null;
  story: StoryDraft;
  createdAt: string;
}

/** Adresse de téléchargement du PDF d'un conte (servi par le serveur). */
export const storybookPdfPath = (storybookId: string) => `/api/storybook/books/${encodeURIComponent(storybookId)}/pdf`;
