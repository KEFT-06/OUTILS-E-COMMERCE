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

const DAY_MS = 86_400_000;

/** Seuil au-delà duquel une publicité est dite « établie » (CdC §6.1). */
export const ESTABLISHED_AFTER_DAYS = 14;

export function isAdActive(ad: IngestedAd, at: Date): boolean {
  return !ad.endedAt || new Date(ad.endedAt) > at;
}

/**
 * Durée de diffusion observée à l'instant `at`, en jours, non arrondie.
 *
 * La fin retenue est la plus précoce entre l'arrêt programmé et l'instant de
 * collecte. Une publicité active dont l'arrêt est planifié dans dix jours n'a
 * pas encore dix jours de diffusion de plus : la version précédente comptait
 * jusqu'à cette date future et surestimait la durée de vie moyenne.
 */
export function adLifetimeDays(ad: IngestedAd, at: Date): number {
  const start = new Date(ad.startedAt).getTime();
  const plannedEnd = ad.endedAt ? new Date(ad.endedAt).getTime() : at.getTime();
  const end = Math.min(plannedEnd, at.getTime());
  return Math.max(0, (end - start) / DAY_MS);
}

/** Publicité enrichie des mêmes calculs que ceux qui alimentent le score. */
export interface AnnotatedAd extends IngestedAd {
  /** Arrondi au dixième, pour l'affichage uniquement. */
  lifetimeDays: number;
  isActive: boolean;
  /** Même définition que le signal `establishedAds` : active et diffusée > 14 jours. */
  isEstablished: boolean;
}

/**
 * Le client affiche ces valeurs au lieu de les recalculer : une règle recopiée
 * dans le navigateur finirait par diverger de celle qui produit le score, et la
 * galerie contredirait alors l'indicateur qu'elle est censée illustrer.
 */
export function annotateAd(ad: IngestedAd, at: Date): AnnotatedAd {
  const isActive = isAdActive(ad, at);
  const lifetime = adLifetimeDays(ad, at);

  return {
    ...ad,
    lifetimeDays: Math.round(lifetime * 10) / 10,
    isActive,
    isEstablished: isActive && lifetime > ESTABLISHED_AFTER_DAYS,
  };
}

/**
 * Dérive les signaux du moteur de scoring à partir des publicités collectées.
 *
 * Centralisé ici, et non dans chaque adaptateur : deux sources différentes
 * doivent produire des signaux calculés de la même façon, sans quoi les scores
 * ne sont plus comparables entre elles.
 */
export function deriveSignals(ads: IngestedAd[], collectedAt: Date): RawSignals {
  const activeAds = ads.filter((ad) => isAdActive(ad, collectedAt));

  const uniqueAdvertisers = new Set(activeAds.map((ad) => ad.advertiserId)).size;

  const lifetimes = activeAds.map((ad) => adLifetimeDays(ad, collectedAt));

  const averageLifetimeDays =
    lifetimes.length > 0
      ? Math.round((lifetimes.reduce((sum, d) => sum + d, 0) / lifetimes.length) * 10) / 10
      : 0;

  const establishedAds = lifetimes.filter((days) => days > ESTABLISHED_AFTER_DAYS).length;

  return {
    uniqueAdvertisers,
    activeAds: activeAds.length,
    averageLifetimeDays,
    establishedAds,
  };
}
