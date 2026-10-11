import { AD_FRAMEWORK_IDS } from '@server/shared/adFrameworks';
import { type VideoLanguageCode, isVideoLanguage } from '@server/shared/languages';
import type { AwarenessLevel } from '@/shared/types/creatives';

/**
 * La publicité dont on part pour créer la sienne.
 *
 * L'Espionnage la passe aux Créatifs dans l'état de navigation (« Créer ma vidéo à partir de
 * cette publicité »). Elle sert de repère sous les yeux : on reprend un angle, jamais le texte
 * ni les images d'un autre annonceur.
 */
export interface AdReference {
  annonceur: string;
  titre: string;
  texte: string;
  /** L'annonce d'origine est une vidéo (sinon une image). */
  video: boolean;
  /** Annonce du mur dont la vidéo peut être regardée par l'outil ; absent : seul son texte est connu. */
  adId?: string;
}

/** Ce que l'outil a vu dans la vidéo d'une publicité, et la scène qu'il en tire pour l'auteur (server/services/espionnage/study.ts). */
export interface AdStudy {
  hook: string;
  beats: { moment: string; shows: string; says: string }[];
  whyItWorks: string[];
  format: '9:16' | '16:9' | '1:1';
  durationSeconds: number;
  brief: { sceneDescription: string; onScreenText: string; visualStyle: string; audience: string };
}

const texteDe = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const AWARENESS: readonly AwarenessLevel[] = ['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware'];

/**
 * Ce dont on part pour créer une vidéo sans rien ressaisir : un ouvrage de « Mes créations », un
 * script du dossier, un conte, un kit de lancement (voir `videoStart.ts`).
 *
 * Seul le titre est obligatoire. Tout le reste est ce que l'écran d'origine sait déjà ; ce qui
 * manque reste à écrire dans le brief, comme avant.
 */
export interface ProductStart {
  titre: string;
  /** Texte à l'écran proposé. */
  promesse: string;
  public: string;
  /** Scène déjà écrite — celle d'un script, d'un conte. */
  scene: string;
  /** Méthode publicitaire du script d'où l'on vient, et le message de chacun de ses temps. */
  methode: string | null;
  temps: string[];
  niveau: AwarenessLevel | null;
  format: '9:16' | '16:9' | null;
  langue: VideoLanguageCode | null;
  /** Code du pays du public, quand l'écran d'origine le connaît. */
  marche: string | null;
  /** D'où l'on vient, tel qu'on le dit à l'écran : « le script AIDA de votre dossier ». */
  origine: string;
}

/** Ce qu'un écran d'origine remet aux Créatifs : le titre, et ce qu'il sait d'autre. */
export type ProductStartInput = Pick<ProductStart, 'titre'> & Partial<ProductStart>;

/** Lit le point de départ dans l'état de navigation ; `null` quand on n'arrive pas d'un ouvrage. */
export function readProductStart(state: unknown): ProductStart | null {
  const produit = (state as { produit?: unknown } | null)?.produit;
  if (!produit || typeof produit !== 'object') return null;
  const brut = produit as Record<string, unknown>;
  const titre = texteDe(brut.titre, 120);
  if (!titre) return null;
  const methode = typeof brut.methode === 'string' && AD_FRAMEWORK_IDS.includes(brut.methode) ? brut.methode : null;
  return {
    titre,
    promesse: texteDe(brut.promesse, 120),
    public: texteDe(brut.public, 300),
    scene: texteDe(brut.scene, 1500),
    methode,
    temps: methode && Array.isArray(brut.temps) ? brut.temps.slice(0, 6).map((temps) => texteDe(temps, 200)) : [],
    niveau: AWARENESS.includes(brut.niveau as AwarenessLevel) ? (brut.niveau as AwarenessLevel) : null,
    format: brut.format === '9:16' || brut.format === '16:9' ? brut.format : null,
    langue: isVideoLanguage(brut.langue) ? brut.langue : null,
    marche: typeof brut.marche === 'string' && /^[A-Z]{2}$/.test(brut.marche) ? brut.marche : null,
    origine: texteDe(brut.origine, 120),
  };
}

/** Lit la référence dans l'état de navigation ; `null` quand on n'arrive pas d'une publicité. */
export function readAdReference(state: unknown): AdReference | null {
  const reference = (state as { reference?: unknown } | null)?.reference;
  if (!reference || typeof reference !== 'object') return null;
  const brut = reference as Record<string, unknown>;
  const annonceur = texteDe(brut.annonceur, 120);
  if (!annonceur) return null;
  const adId = typeof brut.adId === 'string' && /^[0-9a-f-]{36}$/.test(brut.adId) ? brut.adId : undefined;
  return { annonceur, titre: texteDe(brut.titre, 160), texte: texteDe(brut.texte, 900), video: brut.video === true, ...(adId ? { adId } : {}) };
}
