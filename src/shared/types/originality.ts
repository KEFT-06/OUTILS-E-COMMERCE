/** Miroir client de `server/services/originality`. */

export interface OriginalityReference {
  label: string;
  text: string;
}

export interface OriginalityMatch {
  label: string;
  /** Part des mots du texte repris de cette référence. */
  overlapPercent: number;
  /** Passages repris les plus longs (ponctuation non restituée). */
  passages: string[];
}

export interface OriginalityVerdict {
  /** false ⇒ aucune mesure fiable possible ; `unmeasurableReason` dit pourquoi. */
  measurable: boolean;
  unmeasurableReason?: string;
  originalityPercent: number | null;
  threshold: number;
  /** true ⇒ originalité sous le seuil : l'export est refusé. */
  blocking: boolean;
  wordCount: number;
  referencesCompared: number;
  matches: OriginalityMatch[];
  /** Portée de la mesure — toujours affichée avec le verdict. */
  scopeNotice: string;
  configVersion: string;
  checkedAt: string;
}
