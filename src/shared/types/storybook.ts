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
  /** Lien de consultation Gamma. Le lien d'export PDF, secret, ne quitte jamais le serveur. */
  gammaUrl?: string;
  errorMessage?: string;
}
