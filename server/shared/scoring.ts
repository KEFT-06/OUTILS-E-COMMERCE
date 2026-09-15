/**
 * Contrat du score d'intensité concurrentielle tel que le navigateur le lit
 * (server/services/scoring le produit). Types seulement : partagés par le serveur
 * et le navigateur sans qu'aucun code serveur ne parte dans le bundle.
 *
 * Le champ `methodologyVersion` garde sa raison d'être : si la méthode change,
 * le panneau de traçabilité signale qu'un score ancien n'est plus comparable.
 */

export type ScoreLevel = 'Faible' | 'Moyen' | 'Élevé' | 'Très élevé';

/**
 * Origine de la mesure. `demonstration` n'est pas un détail cosmétique :
 * le CdC §9.4 interdit d'afficher une donnée fabriquée sans l'étiqueter comme telle.
 */
export type ScoreSource = 'live' | 'demonstration';

export interface ScoreCriterion {
  key: string;
  label: string;
  /** Poids en pourcentage. La somme des critères fait 100. */
  weight: number;
  /** Valeur brute mesurée, telle que collectée — jamais arrondie pour l'affichage. */
  rawValue: number;
  /** Seuil au-delà duquel le critère est considéré « élevé ». */
  highThreshold: number;
  /** Valeur normalisée sur 0–100. */
  normalized: number;
  /** Points apportés au score final : normalized × weight / 100. */
  contribution: number;
  /** Unité d'affichage de `rawValue` et `highThreshold` : '' ou ' %'. */
  unit: string;
  /** Phrase lisible expliquant le calcul. */
  explanation: string;
}

/**
 * Un score tel qu'il a été calculé et **persisté**, avec sa version de méthodologie.
 *
 * Règle non négociable (CdC §6.1) : on affiche la trace telle qu'elle a été
 * enregistrée. Recalculer à l'affichage avec des poids qui ont changé depuis
 * produirait un chiffre non traçable.
 */
export interface ScoreTrace {
  score: number;
  level: ScoreLevel;
  methodologyVersion: string;
  /** Horodatage ISO 8601 de la collecte. */
  measuredAt: string;
  /** Volume d'échantillon — sans lui, un score n'est pas interprétable. */
  sampleSize: number;
  source: ScoreSource;
  breakdown: ScoreCriterion[];
}

/** Réponse de `GET /api/scoring/methodology` — la règle publiée, faisant foi. */
export interface MethodologyDoc {
  version: string;
  criteria: { key: string; label: string; weight: number; highThreshold: number }[];
  normalization: string;
  levels: { from: number; to: number; label: string }[];
  disclaimer: string;
}
