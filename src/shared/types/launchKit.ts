/** Kit de lancement — feuille de route 5.1. Miroir client de `server/services/launchKit`. */

export type KitObjective = 'sales' | 'leads' | 'traffic';

export interface CtaButton {
  id: string;
  /** Nom exact du bouton dans le gestionnaire de publicités. */
  officialName: string;
  recommendedFor: KitObjective[];
}

export interface CtaPlatform {
  id: string;
  label: string;
  source: string;
  checkedAt: string;
  buttons: CtaButton[];
}

export interface ScriptBeat {
  id: string;
  label: string;
  startSecond: number;
  endSecond: number;
  purpose: string;
}

export interface ScriptFormat {
  durationSeconds: number;
  label: string;
  beats: ScriptBeat[];
}

export interface LaunchKitConfig {
  version: string;
  updatedAt: string;
  note?: string;
  valuesStatus?: string;
  voiceOverWordsPerSecond: number;
  ctaPlatforms: CtaPlatform[];
  scriptFormats: ScriptFormat[];
}

export interface AdCopyVariant {
  primaryText: string;
  headline: string;
  description: string;
}

export interface BeatText {
  onScreen: string;
  voiceOver: string;
}

/** Saisies de l'auteur. Le kit structure et contrôle ; il n'écrit pas à sa place. */
export interface LaunchKitDraft {
  productId: string;
  objective: KitObjective;
  /** Une à trois variantes de texte publicitaire. */
  copies: AdCopyVariant[];
  /** Durée (en secondes, en texte) → identifiant du temps fort → textes. */
  scripts: Record<string, Record<string, BeatText>>;
  /** Code marché → identifiant du bouton d'appel à l'action retenu. */
  ctaByMarket: Record<string, string>;
}
