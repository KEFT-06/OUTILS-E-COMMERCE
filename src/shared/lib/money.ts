import { useCallback, useEffect, useMemo, useState } from 'react';
import { findCountry } from '@server/shared/countries';
import { formatMoney, roundPrice } from '@server/shared/currency';
import { useAuth } from '@/features/auth/AuthContext';
import { guessCountryCode } from '@/shared/lib/geo';

/**
 * Montants affichés dans la devise du pays de l'utilisateur, et dans aucune autre
 * (décision du propriétaire du 29/09/2026).
 *
 * Un montant arrive dans la devise où il a été mesuré — prix d'une boutique concurrente,
 * vente sur Chariow, valeur du point en FCFA, médiane d'un marché en dollars. Il est converti ici
 * avant d'être montré. Ce qui ne peut pas être converti (taux inconnu) s'affiche « — » plutôt
 * que dans une devise étrangère.
 */

interface Rates {
  base: string;
  rates: Record<string, number>;
  updatedAt: string;
}

let cache: Rates | null = null;
let pending: Promise<Rates | null> | null = null;

/** Taux de change, chargés une fois pour toute la session (réponse gardée par le réseau de l'hébergeur). */
export function loadRates(): Promise<Rates | null> {
  if (cache) return Promise.resolve(cache);
  pending ??= fetch('/api/currency/rates')
    .then((response) => (response.ok ? (response.json() as Promise<Rates>) : null))
    .then((rates) => {
      cache = rates;
      pending = null;
      return rates;
    })
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

/** Libellés non normalisés rencontrés dans les données : « FCFA », « € », « $ ». */
const ALIASES: Record<string, string> = { FCFA: 'XAF', CFA: 'XAF', 'F CFA': 'XAF', '€': 'EUR', $: 'USD', 'US$': 'USD' };

export function normalizeCurrency(currency: string | null | undefined): string | null {
  const value = currency?.trim();
  if (!value) return null;
  return ALIASES[value] ?? ALIASES[value.toUpperCase()] ?? value.toUpperCase();
}

export function convertMoney(amount: number, from: string, to: string, rates: Rates | null): number | null {
  if (from === to) return amount;
  const fromRate = rates?.rates[from];
  const toRate = rates?.rates[to];
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
}

/** Devise du pays de l'utilisateur ; sans pays renseigné, celle du pays deviné par le fuseau. */
export function useUserCurrency(): string {
  const { account } = useAuth();
  return useMemo(() => {
    if (account?.country) return account.currency;
    return findCountry(guessCountryCode())?.currency ?? account?.currency ?? 'USD';
  }, [account?.country, account?.currency]);
}

export interface MoneyFormatOptions {
  /** Prix « propre » après conversion : 6 553 FCFA → 6 600 FCFA. */
  round?: boolean;
  /** Préfixe « ≈ » quand le montant a été converti. */
  approx?: boolean;
}

export function useMoney() {
  const currency = useUserCurrency();
  const [rates, setRates] = useState<Rates | null>(cache);

  useEffect(() => {
    if (rates) return;
    let cancelled = false;
    void loadRates().then((loaded) => {
      if (!cancelled && loaded) setRates(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [rates]);

  /** Montant dans la devise de l'utilisateur, ou null s'il n'est pas convertible. */
  const convert = useCallback(
    (amount: number, from?: string | null): number | null => {
      const source = normalizeCurrency(from) ?? currency;
      return convertMoney(amount, source, currency, rates);
    },
    [currency, rates],
  );

  const format = useCallback(
    (amount: number | null | undefined, from?: string | null, options: MoneyFormatOptions = {}): string => {
      if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
      const source = normalizeCurrency(from) ?? currency;
      const converted = convertMoney(amount, source, currency, rates);
      if (converted === null) return rates ? '—' : '…';
      const value = options.round && source !== currency ? roundPrice(converted, currency) : converted;
      return `${options.approx && source !== currency ? '≈ ' : ''}${formatMoney(value, currency)}`;
    },
    [currency, rates],
  );

  return { currency, rates, convert, format, ready: rates !== null };
}
