/**
 * Contrat des connecteurs marketplace — feuille de route 5.2 (adapter pattern).
 *
 * Chariow sert de gabarit : c'est le seul à publier une API documentée. Maketou
 * et Taliopay se brancheront sur cette même interface une fois le partenariat
 * négocié, sans que l'interface ni les routes aient à changer.
 *
 * Les capacités sont déclarées, pas supposées : un connecteur qui ne peut pas
 * publier de produit le dit, et l'écran n'affiche pas de bouton qui échouerait.
 */

export interface MarketplaceCapabilities {
  readProducts: boolean;
  publishProducts: boolean;
  readSales: boolean;
}

export interface MarketplaceProduct {
  externalId: string;
  name: string;
  type: string;
  isFree: boolean;
  /** Prix tel que publié par la marketplace ; null pour un produit gratuit ou sans prix. */
  price: { formatted: string; currency: string } | null;
  thumbnailUrl?: string;
}

export interface CurrencyTotal {
  currency: string;
  /** Somme en unités mineures, telle que renvoyée par la marketplace. */
  amountMinor: number;
  formatted: string;
  salesCount: number;
}

/**
 * Agrégat des ventes encaissées sur une période.
 *
 * Aucune donnée personnelle : les ventes portent e-mail et nom des clients, et
 * rien de cela n'a à quitter le serveur pour afficher un chiffre d'affaires.
 */
export interface SalesSummary {
  /** Bornes incluses, format AAAA-MM-JJ. */
  from: string;
  to: string;
  completedSales: number;
  /** Une ligne par devise : additionner des devises différentes n'aurait aucun sens. */
  totalsByCurrency: CurrencyTotal[];
  /** true ⇒ pagination plafonnée, les chiffres sont des minima. */
  truncated: boolean;
  source: string;
  collectedAt: string;
}

export interface MarketplaceAdapter {
  readonly id: string;
  readonly label: string;
  readonly capabilities: MarketplaceCapabilities;
  isAvailable(): { available: true } | { available: false; reason: string };
  listProducts(): Promise<{ products: MarketplaceProduct[]; truncated: boolean }>;
  salesSummary(range: { from: string; to: string }): Promise<SalesSummary>;
}
