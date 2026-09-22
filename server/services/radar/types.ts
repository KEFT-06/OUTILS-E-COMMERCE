import type { WatchSource } from '@server/db/schema';

/**
 * Contrat entre le radar et ses sources.
 *
 * Le radar ne sait pas d'où viennent les articles : il compare deux relevés et en tire
 * des événements. Une nouvelle source (publicités Meta, autre plateforme) se branche en
 * implémentant `RadarSource`, sans toucher au moteur de comparaison ni à l'écran.
 */

/** Ce qu'un relevé rapporte sur un article, à un instant donné. */
export interface RadarObservation {
  /** Identifiant chez la source, stable d'un passage à l'autre. */
  externalId: string;
  name: string;
  /** Nature déclarée par la source. null : non renseignée. */
  kind: string | null;
  /**
   * Prix tel que la source le donne, sans conversion. Le radar ne le compare qu'à
   * lui-même : convertir ferait apparaître des changements de prix là où seul le
   * taux de change a bougé.
   */
  priceValue: number | null;
  currency: string | null;
  /** Ventes cumulées, quand la source les publie. */
  salesCount: number | null;
}

/** Une cible de surveillance, telle qu'elle est enregistrée. */
export interface RadarTarget {
  source: WatchSource;
  externalId: string;
  label: string;
  url: string | null;
}

export interface RadarSource {
  /** Traduit une saisie d'utilisateur (lien, sous-domaine, identifiant) en cible. */
  resolve(input: string): Promise<RadarTarget>;
  /** Relève l'état courant de la cible. Un tableau vide est une réponse valide : la boutique est vide. */
  observe(externalId: string): Promise<RadarObservation[]>;
}
