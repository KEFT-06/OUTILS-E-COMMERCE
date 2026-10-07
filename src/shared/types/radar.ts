/**
 * Radar — ce que le serveur envoie à l'écran.
 *
 * L'écran n'assemble aucune phrase : le serveur a déjà rédigé chaque `summary`, avec les
 * chiffres dedans. Le navigateur affiche, groupe et met en forme, rien de plus — c'est ce
 * qui garantit qu'une alerte lue dans un e-mail dira exactement la même chose qu'à l'écran.
 */

export type WatchEventKind = 'appeared' | 'disappeared' | 'price_changed' | 'sales_jump';

export interface WatchSummary {
  id: string;
  label: string;
  url: string | null;
  source: 'chariow_store';
  active: boolean;
  createdAt: string;
  lastSweptAt: string | null;
  lastError: string | null;
  /** Jours de surveillance : la profondeur de l'historique, invendable par un concurrent. */
  trackedDays: number;
  liveItems: number;
  endedItems: number;
  /** Ventes cumulées depuis la création des produits encore en vente. */
  totalSales: number;
  /** Ventes faites depuis la mise sous surveillance. */
  trackedSales: number;
  /** Produits en vente dont le compte de ventes est connu. Zéro : rien à additionner. */
  itemsWithSales: number;
  /** Publicités de la boutique vues en cours au dernier contrôle. */
  activeAds: number;
  /** Début de la plus ancienne publicité connue de la boutique. */
  firstAdAt: string | null;
  adsCheckedAt: string | null;
  unreadEvents: number;
}

export interface WatchEventView {
  id: string;
  watchId: string;
  watchLabel: string;
  kind: WatchEventKind;
  summary: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  read: boolean;
}

export interface RadarDashboard {
  watches: WatchSummary[];
  events: WatchEventView[];
  countsLast7Days: Partial<Record<WatchEventKind, number>>;
  alertsEnabled: boolean;
  emailConfigured: boolean;
  /** 0 : palier sans radar. null : sans limite. */
  limit: number | null;
}

export interface WatchItemView {
  id: string;
  name: string;
  kind: string | null;
  category: string | null;
  price: number | null;
  currency: string | null;
  /** Ventes cumulées depuis la création du produit. null : non publiées. */
  sales: number | null;
  /** Ventes faites depuis la mise sous surveillance. null : non publiées. */
  salesTracked: number | null;
  /** Début de la plus ancienne publicité connue pour ce produit. */
  firstAdAt: string | null;
  activeAds: number;
  /** Publicités connues de ce produit, en cours ou arrêtées. */
  totalAds: number;
  slug: string | null;
  /** Identifiant du produit chez la plateforme, « prd_… ». */
  externalId: string;
  /** Page du produit sur sa vitrine. */
  url: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** null : encore en vente. */
  endedAt: string | null;
  trackedDays: number;
}

export interface SweepOutcome {
  observed: number;
  appeared: number;
  disappeared: number;
  priceChanged: number;
  salesJumps: number;
}

export interface RadarMeasurements {
  stores: number;
  observedDays: number;
  liveOffers: number;
  endedOffers: number;
  salesByCurrency: { currency: string; units: number; revenue: number }[];
  salesPerDay: number | null;
  medianPriceByCurrency: { currency: string; price: number }[];
  lastSweptAt: string | null;
}

export interface DiscoveredStore {
  /** Publicités de la boutique vues en cours au dernier contrôle. */
  activeAds: number;
  adsCheckedAt: string | null;
  host: string;
  label: string | null;
  /** Publicités où la boutique est apparue : un indice d'activité, pas une mesure. */
  adCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface DiscoveryView {
  stores: DiscoveredStore[];
  lastRunAt: string | null;
  /** false : aucun jeton de collecte sur ce serveur — la découverte est simplement absente. */
  configured: boolean;
  /** Seul un administrateur peut lancer une collecte : chaque passage se paie. */
  canRefresh: boolean;
}

/**
 * Mur d'espionnage : une publicité Meta qui mène à une boutique de la plateforme.
 *
 * Ni budget, ni impressions, ni portée : Meta ne les publie que pour l'Union européenne
 * (mesuré à 0 sur 43 annonces africaines). Aucun champ ne les représente, plutôt qu'un champ
 * toujours vide qui passerait pour une panne.
 */
export interface SpiedAd {
  id: string;
  externalId: string;
  storeHost: string;
  landingUrl: string;
  title: string | null;
  bodyText: string | null;
  advertiser: string | null;
  /** Adresse signée par Meta : elle expire, d'où le repli prévu à l'affichage. */
  mediaUrl: string | null;
  /** Le fichier d'origine (vidéo ou image) peut être téléchargé. */
  downloadable?: boolean;
  /** Pays où l'annonce a été vue en diffusion (ISO). */
  countries?: string[];
  mediaKind: string | null;
  startedAt: string | null;
  /** Jours pendant lesquels l'annonce a été VUE en diffusion : la donnée qui fait la valeur du mur. */
  runningDays: number | null;
  /** Jours depuis le dernier passage qui a vu cette annonce. */
  daysSinceSeen: number;
  variants: number;
  platforms: string[];
  active: boolean;
  lastSeenAt: string;
  /** Aperçu conservé sur le serveur : il ne périme pas. null : seule l'adresse de Meta. */
  thumbnailUrl: string | null;
  /** Adresse de la vidéo chez Meta, lue sur place. null ou absent : pas une vidéo, ou adresse inconnue. */
  videoUrl?: string | null;
  pageId: string | null;
  pageUrl: string | null;
  /** Photo de profil de l'annonceur (notre copie, ou l'adresse de Meta qui expire). */
  pageAvatarUrl?: string | null;
  /** Tranche d'impressions publiée par Meta (« <100 »…), pour certaines annonces seulement. */
  impressionsText?: string | null;
  ctaText: string | null;
  displayFormat: string | null;
  linkCaption: string | null;
  linkDescription: string | null;
  cards: { title: string | null; body: string | null; linkUrl: string | null; ctaText: string | null }[];
}

/** Annonce quelconque de la bibliothèque (recherche par mot-clé) : sans boutique ni lien parfois. */
export type LibraryAd = Omit<SpiedAd, 'storeHost' | 'landingUrl'> & { storeHost: string | null; landingUrl: string | null };

/** Recherche par mot-clé dans la bibliothèque publicitaire (miroir de server/services/espionnage/search.ts). */
export interface AdSearch {
  id: string;
  query: string;
  country: string;
  status: 'running' | 'done' | 'failed';
  adsFound: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  fromCache: boolean;
  ads: LibraryAd[];
  hiddenByPlan: number;
  platformAds: number;
}

export interface AdSearchOverview {
  recent: { id: string; query: string; country: string; adsFound: number; createdAt: string }[];
  quota: { used: number; limit: number | null; serverLeft: number };
  configured: boolean;
}

export interface EspionnageView {
  ads: SpiedAd[];
  /** Pays pour lesquels au moins une annonce a été relevée (ISO). */
  countries: string[];
  /** Plateformes présentes sur le mur (Chariow, Maketou, Shopify), avec leur nombre d'annonces. */
  storefronts: { id: 'chariow' | 'maketou' | 'shopify'; ads: number }[];
  total: number;
  stores: number;
  lastCollectedAt: string | null;
  configured: boolean;
  /** Annonces que le palier laisse voir ; null : tout le mur. */
  visibleLimit: number | null;
  /** Annonces correspondant aux filtres mais masquées par le palier. */
  hiddenByPlan: number;
  /** Annonces correspondant aux filtres, toutes séries confondues. */
  matching: number;
  /** Série affichée (0 = la première) et nombre de séries : « Actualiser » passe à la suivante. */
  batch: number;
  batches: number;
  /** Annonces servies par série : de quoi dire « annonces 101 à 200 sur 380 ». */
  pageSize: number;
  /** Une collecte tourne : de nouvelles annonces arrivent dans quelques minutes. */
  collecting?: boolean;
}

/** Produit d'une boutique connue, trouvé pour une niche (index du marché). */
export interface MarketProduct {
  id: string;
  name: string;
  category: string | null;
  kind: string | null;
  storeHost: string;
  storeLabel: string | null;
  storeUrl: string;
  price: number | null;
  currency: string | null;
  /** Ventes cumulées depuis la création du produit. null : non publiées. */
  sales: number | null;
  /** Ventes depuis notre premier relevé. null : non publiées. */
  salesTracked: number | null;
  firstSeenAt: string;
  firstAdAt: string | null;
  activeAds: number;
  slug: string | null;
  externalId: string;
  url: string;
  /** Début de la plus ancienne publicité connue de ce produit sur Meta, et le nombre de ses annonces. */
  productFirstAdAt: string | null;
  productAds: number;
}

export interface MarketSearch {
  niche: string;
  keywords: string[];
  products: MarketProduct[];
  stores: number;
  indexedStores: number;
  indexedProducts: number;
}

export interface StorePreviewProduct {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  currency: string | null;
  sales: number | null;
  salesTracked: number | null;
  firstSeenAt: string;
  launchedAt: string | null;
  endedAt: string | null;
  slug: string | null;
  externalId: string;
  url: string;
  /** Début de la plus ancienne publicité connue de ce produit sur Meta, et ses annonces. */
  firstAdAt: string | null;
  activeAds: number;
  totalAds: number;
}

/** Fiche d'une boutique ouverte dans le Radar sans la surveiller : catalogue connu, ventes, publicités. */
export interface StorePreview {
  host: string;
  label: string;
  url: string;
  storefront: 'chariow' | 'maketou' | 'shopify' | null;
  /** Le Radar sait relever son catalogue, donc la surveiller. */
  followable: boolean;
  /** Surveillance du compte sur cette boutique, s'il y en a déjà une. */
  watchId: string | null;
  products: StorePreviewProduct[];
  liveItems: number;
  endedItems: number;
  totalSales: number;
  itemsWithSales: number;
  /** Premier relevé du catalogue en cours : la fiche se redemande dans un instant. */
  pending: boolean;
  /** Sa vitrine n'a pas répondu au relevé : la fiche montre ce qui reste connu, ses publicités. */
  unreachable: boolean;
  /** Offres mises en avant dans ses publicités, les plus diffusées d'abord. */
  advertised: { title: string; url: string; ads: number; active: number }[];
  indexedAt: string | null;
  ads: { active: number; total: number; videos: number; firstAdAt: string | null; checkedAt: string | null };
  /** Boutiques que le palier permet de surveiller. 0 : aucune. null : sans limite. */
  limit: number | null;
}

export type AlertKind = 'winner' | 'niche_trend' | 'ad_stopped' | 'first_traction' | 'daily_scale' | 'flash_scale' | 'stockout';
export type AlertLevel = 'info' | 'opportunity' | 'major';

/** Alerte du fil : ventes du jour d'un produit, lancement flash, publicité installée arrêtée, tendance de niche. */
export interface AlertItem {
  id: string;
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  unread: boolean;
}
