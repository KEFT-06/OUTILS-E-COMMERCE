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
  totalSales: number;
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
  price: number | null;
  currency: string | null;
  sales: number | null;
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
