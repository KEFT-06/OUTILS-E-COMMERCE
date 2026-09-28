import type { CurrencyTotal } from '@server/services/marketplaces/types';

/**
 * Montants des boutiques : une ligne par devise, sommée en unités MINEURES entières.
 * Additionner des décimaux accumulerait des erreurs d'arrondi flottant ; additionner des
 * devises différentes n'aurait aucun sens. Commun à tous les connecteurs.
 */

/** Nombre de décimales d'une devise : 0 pour le franc CFA, 2 pour l'euro. */
export function currencyExponent(currency: string): number {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function formatMinor(amountMinor: number, currency: string): string {
  const value = amountMinor / 10 ** currencyExponent(currency);
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toLocaleString('fr-FR')} ${currency}`;
  }
}

export function formatMajor(amount: number, currency: string): string {
  return formatMinor(Math.round(amount * 10 ** currencyExponent(currency)), currency);
}

/** Ventes (montant en unités principales) → totaux par devise. */
export function totalsByCurrency(sales: { amount: number; currency: string }[]): CurrencyTotal[] {
  const totals = new Map<string, { amountMinor: number; salesCount: number }>();
  for (const sale of sales) {
    if (!Number.isFinite(sale.amount) || !/^[A-Z]{3}$/.test(sale.currency)) continue;
    const current = totals.get(sale.currency) ?? { amountMinor: 0, salesCount: 0 };
    totals.set(sale.currency, {
      amountMinor: current.amountMinor + Math.round(sale.amount * 10 ** currencyExponent(sale.currency)),
      salesCount: current.salesCount + 1,
    });
  }
  return [...totals.entries()].map(([currency, total]) => ({
    currency,
    amountMinor: total.amountMinor,
    formatted: formatMinor(total.amountMinor, currency),
    salesCount: total.salesCount,
  }));
}
