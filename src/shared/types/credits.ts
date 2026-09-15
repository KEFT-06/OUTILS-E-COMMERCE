/** Miroir client de `server/services/credits`. */

export interface CreditAction {
  id: string;
  label: string;
  cost: number;
  description: string;
}

export interface CreditCostTable {
  version: string;
  updatedAt: string;
  currency: string;
  /** Valeur d'un research point dans la devise ci-dessus. */
  pointValue: number;
  /** Renseigné tant que la valeur du point n'est pas validée commercialement. */
  pointValueStatus?: string;
  actions: CreditAction[];
}

/**
 * Ce que l'utilisateur doit voir **avant** de valider (CdC §8) :
 * le coût, son équivalent monétaire, le solde avant et le solde après.
 */
export interface CreditQuote {
  action: CreditAction;
  cost: number;
  monetaryEquivalent: number;
  currency: string;
  balanceBefore: number;
  balanceAfter: number;
  /** false ⇒ solde insuffisant, l'action ne peut pas être validée. */
  sufficient: boolean;
  /** Palier illimité : l'action ne prélève aucun point. */
  unlimited?: boolean;
  tableVersion: string;
  pointValueStatus?: string;
}
