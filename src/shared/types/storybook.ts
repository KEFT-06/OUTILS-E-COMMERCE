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
  /** Illustrations terminées sur illustrations attendues, couverture comprise. Absent : avancée inconnue. */
  progress?: { done: number; total: number };
}

/** Conte rédigé par l'IA : une page = un titre, un texte et la scène à illustrer. */
export interface StoryDraft {
  title: string;
  characterSheet: string;
  /** Personnages secondaires récurrents, dessinés avec le principal pour rester identiques d'une page à l'autre. */
  cast?: { name: string; sheet: string }[];
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
  /** Rangs dont l'illustration peut être affichée : 0 pour la couverture, puis 1 à N pour les pages. */
  pictures: number[];
  createdAt: string;
}

/** Adresse de téléchargement du PDF d'un conte (servi par le serveur). */
export const storybookPdfPath = (storybookId: string) => `/api/storybook/books/${encodeURIComponent(storybookId)}/pdf`;

/** Adresse de l'illustration d'une page (0 : la couverture). */
export const storybookPicturePath = (storybookId: string, position: number) =>
  `/api/storybook/books/${encodeURIComponent(storybookId)}/pages/${position}`;
