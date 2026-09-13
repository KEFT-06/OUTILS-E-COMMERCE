/** Miroir client de `server/services/pricing`. */

export interface PriceMark {
  value: number;
  label: string;
}

export interface PriceRange {
  min: number;
  max: number;
  step: number;
  default: number;
  marks: PriceMark[];
}

export interface ProductTypeRange {
  type: string;
  label: string;
  min: number;
  typical: number;
  max: number;
}

export interface PricingConfig {
  version: string;
  updatedAt: string;
  note?: string;
  currency: string;
  currencySymbol: string;
  /** Renseigné tant que les bornes n'ont pas été révisées sur données réelles. */
  valuesStatus?: string;
  sellingPrice: PriceRange;
  adCostPerAcquisition: PriceRange;
  productTypeRanges: ProductTypeRange[];
}
