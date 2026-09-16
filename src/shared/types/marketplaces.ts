/** Miroir client de `server/services/marketplaces`. */

export interface MarketplaceCapabilities {
  readProducts: boolean;
  publishProducts: boolean;
  readSales: boolean;
}

export interface MarketplaceInfo {
  id: string;
  label: string;
  capabilities: MarketplaceCapabilities;
  available: boolean;
  /** Pourquoi le connecteur est indisponible : clé absente, ou API inexistante. */
  reason?: string;
}

export interface MarketplaceProduct {
  externalId: string;
  name: string;
  type: string;
  isFree: boolean;
  price: { formatted: string; currency: string } | null;
}

export interface CurrencyTotal {
  currency: string;
  amountMinor: number;
  formatted: string;
  salesCount: number;
}

export interface SalesSummary {
  from: string;
  to: string;
  completedSales: number;
  totalsByCurrency: CurrencyTotal[];
  truncated: boolean;
  source: string;
  collectedAt: string;
}

export type SalesSummaryResponse =
  | { days: number; connected: true; range: { from: string; to: string }; summaries: SalesSummary[] }
  /** Aucune boutique reliée au compte. */
  | { days: number; connected: false; range: null; summaries: [] };
