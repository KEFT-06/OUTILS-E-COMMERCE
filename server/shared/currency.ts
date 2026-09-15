/**
 * Monnaies : format d'affichage et arrondi des prix. Fichier sans dépendance,
 * partagé par le serveur et le navigateur.
 *
 * Les taux eux-mêmes vivent côté serveur (server/services/currency) : le
 * navigateur reçoit des montants déjà convertis.
 */

/** Parités fixes avec l'euro, garanties par des accords monétaires : jamais lues chez un fournisseur de taux. */
export const FIXED_EUR_PARITIES: Readonly<Record<string, number>> = {
  EUR: 1,
  XAF: 655.957,
  XOF: 655.957,
  KMF: 491.96775,
  CVE: 110.265,
  BAM: 1.95583,
};

/** Devise de repli quand un pays utilise une monnaie sans taux disponible. */
export const FALLBACK_CURRENCY = 'USD';

const digitsCache = new Map<string, number>();

/** Nombre de décimales d'usage de la devise (0 pour le franc CFA ou le yen, 2 pour l'euro). */
export function fractionDigits(currency: string): number {
  const cached = digitsCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  digitsCache.set(currency, digits);
  return digits;
}

/**
 * Montant lisible en français : « 4 900 FCFA », « 7,99 € », « 16,99 $US ».
 *
 * Au-delà de 1 000, les centimes disparaissent : « 13 500 ₦ » plutôt que
 * « 13 500,00 ₦ ». L'espace fine insécable du français (U+202F), que certaines
 * polices n'affichent pas, devient une espace insécable ordinaire.
 */
export function formatMoney(amount: number, currency: string): string {
  const digits = Number.isInteger(amount) || Math.abs(amount) >= 1_000 ? 0 : fractionDigits(currency);
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
      .format(amount)
      .replace(/ /g, ' ');
  } catch {
    return `${amount.toLocaleString('fr-FR')} ${currency}`;
  }
}

/**
 * Prix « propre » dans une devise, après conversion : 9,23 $ → 8,99 $ ;
 * 13 583 ₦ → 13 500 ₦ ; 6 553 FCFA → 6 600 FCFA.
 */
export function roundPrice(value: number, currency: string): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (fractionDigits(currency) > 0 && value < 1_000) {
    return Math.max(0.99, Math.round(value) - 0.01);
  }
  const step =
    value < 100 ? 1 : value < 1_000 ? 10 : value < 10_000 ? 100 : value < 100_000 ? 500 : value < 1_000_000 ? 1_000 : 10_000;
  return Math.max(step, Math.round(value / step) * step);
}
