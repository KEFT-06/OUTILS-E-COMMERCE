/**
 * Provenance d'un jeu de données affiché (feuille de route, 2.6). Types seulement,
 * partagés par le serveur et le navigateur.
 *
 * La règle du lot est sans nuance : « un graphique sans provenance affichée est
 * un graphique refusé ». Un histogramme est lu comme une mesure, pas comme une
 * illustration — sans source ni date, il emprunte une autorité qu'il n'a pas.
 */
export interface DataProvenance {
  /** D'où viennent les chiffres : « Meta Ad Library », « Recherche web »… */
  source: string;
  /** Horodatage ISO de la collecte. */
  collectedAt: string;
  /** Volume d'échantillon. Sans lui, une proportion n'est pas interprétable. */
  sampleSize?: number;
  /** Ce que compte `sampleSize` : « publicités », « pages web consultées »… */
  sampleUnit?: string;
  /**
   * true ⇒ chiffres de démonstration. Jamais déductible du reste : il faut le
   * dire explicitement, sans quoi une démo se lit comme une mesure de marché.
   */
  isDemonstration: boolean;
  /** Lien vers la source publique, quand elle en a un. */
  sourceUrl?: string;
}

/** Provenances rattachées aux blocs d'un rapport. */
export interface ReportDataProvenance {
  rates?: DataProvenance;
  searchTrends?: DataProvenance;
  adCampaigns?: DataProvenance;
}
