import { RawSignals } from '@server/services/scoring';

/**
 * Contrat d'ingestion publicitaire — feuille de route 2.1.
 *
 * Le cahier des charges impose un « module interchangeable ». La raison est
 * concrète : l'accès étendu à la Meta Ad Library dépend d'une App Review et
 * d'une Business Verification dont le délai d'instruction dépasse souvent celui
 * du développement (CdC §6.11.5). Le produit ne peut pas être architecturé en
 * supposant que cette source sera disponible à une date donnée.
 *
 * Tout ce que le reste de l'application connaît de l'ingestion tient donc dans
 * cette interface. Changer de source revient à écrire une nouvelle implémentation,
 * pas à modifier le moteur de scoring, les routes ou l'interface.
 */

/** Une publicité collectée, réduite à ce dont le scoring a besoin. */
export interface IngestedAd {
  /** Identifiant chez la source, pour la déduplication. */
  externalId: string;
  advertiserName: string;
  /** Identifiant de l'annonceur chez la source : deux noms identiques ≠ un annonceur. */
  advertiserId: string;
  /** Début de diffusion, ISO 8601. */
  startedAt: string;
  /** Fin de diffusion, ISO 8601. Absent ⇒ toujours active à la collecte. */
  endedAt?: string;
  /** Pays ou marché de diffusion, code ISO. */
  market: string;
  creativeBody?: string;
  landingPageUrl?: string;
}

export interface IngestionQuery {
  /** Terme ou niche recherchée. */
  niche: string;
  /** Marché ciblé, code ISO pays. */
  market?: string;
  /** Nombre maximum de publicités à collecter. */
  limit?: number;
}

export interface IngestionResult {
  ads: IngestedAd[];
  /** Signaux prêts pour `computeCompetitiveScore`, dérivés des publicités. */
  signals: RawSignals;
  /** Nom lisible de la source, affiché à l'utilisateur sous les graphiques. */
  sourceLabel: string;
  /** Horodatage ISO de la collecte. */
  collectedAt: string;
  /**
   * true ⇒ données de démonstration. Porté jusqu'à l'écran : un jeu de test qui
   * perd cette étiquette en route devient indiscernable d'une mesure de marché.
   */
  isDemonstration: boolean;
  /** Lien public vers la source, quand il existe. */
  sourceUrl?: string;
}

export interface AdIngestionAdapter {
  /** Identifiant court, utilisé en configuration : « meta », « fixture ». */
  readonly id: string;
  /** Nom lisible de la source. */
  readonly label: string;
  /**
   * Indique si l'adaptateur peut fonctionner (clés présentes, quotas, etc.).
   * Une route doit pouvoir répondre « indisponible, et voici pourquoi » sans
   * avoir à déclencher un appel réseau qui échouera.
   */
  isAvailable(): { available: true } | { available: false; reason: string };
  fetchAds(query: IngestionQuery): Promise<IngestionResult>;
}

/**
 * Dérive les signaux du moteur de scoring à partir des publicités collectées.
 *
 * Centralisé ici, et non dans chaque adaptateur : deux sources différentes
 * doivent produire des signaux calculés de la même façon, sans quoi les scores
 * ne sont plus comparables entre elles.
 */
export function deriveSignals(ads: IngestedAd[], collectedAt: Date): RawSignals {
  const activeAds = ads.filter((ad) => !ad.endedAt || new Date(ad.endedAt) > collectedAt);

  const uniqueAdvertisers = new Set(activeAds.map((ad) => ad.advertiserId)).size;

  const lifetimes = activeAds.map((ad) => {
    const start = new Date(ad.startedAt).getTime();
    const end = ad.endedAt ? new Date(ad.endedAt).getTime() : collectedAt.getTime();
    return Math.max(0, (end - start) / 86_400_000);
  });

  const averageLifetimeDays =
    lifetimes.length > 0
      ? Math.round((lifetimes.reduce((sum, d) => sum + d, 0) / lifetimes.length) * 10) / 10
      : 0;

  // « Établie » = diffusée depuis plus de 14 jours (CdC §6.1).
  const establishedAds = lifetimes.filter((days) => days > 14).length;

  return {
    uniqueAdvertisers,
    activeAds: activeAds.length,
    averageLifetimeDays,
    establishedAds,
  };
}
