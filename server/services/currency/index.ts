import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { env } from '@server/env';
import { findCountry } from '@server/shared/countries';
import { FALLBACK_CURRENCY, FIXED_EUR_PARITIES, fractionDigits } from '@server/shared/currency';

/**
 * Taux de change, base EUR.
 *
 * - Au démarrage : taux de repli de server/config/exchange-rates.json, pour que
 *   les prix s'affichent même hors ligne.
 * - Puis toutes les 12 heures : taux ouverts d'ExchangeRate-API, sans clé. La
 *   requête ne contient que la devise de base ; aucune donnée d'utilisateur.
 * - Les parités fixes (franc CFA, escudo, franc comorien, mark bosnien) écrasent
 *   toujours le taux lu : elles sont garanties par des accords monétaires.
 */

export interface RatesSnapshot {
  base: 'EUR';
  rates: Readonly<Record<string, number>>;
  updatedAt: string;
  source: 'live' | 'fallback';
}

const REFRESH_INTERVAL_MS = 12 * 3_600_000;
const REQUEST_TIMEOUT_MS = 8_000;
const FALLBACK_PATH = join(process.cwd(), 'server', 'config', 'exchange-rates.json');

const ratesSchema = z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive());

let snapshot: RatesSnapshot | null = null;
let timer: NodeJS.Timeout | null = null;

function withParities(rates: Record<string, number>): Record<string, number> {
  return { ...rates, ...FIXED_EUR_PARITIES };
}

async function loadFallback(): Promise<RatesSnapshot> {
  const file = z
    .object({ fetchedAt: z.string(), rates: ratesSchema })
    .parse(JSON.parse(await readFile(FALLBACK_PATH, 'utf8')));
  return { base: 'EUR', rates: withParities(file.rates), updatedAt: file.fetchedAt, source: 'fallback' };
}

export async function getRates(): Promise<RatesSnapshot> {
  snapshot ??= await loadFallback();
  return snapshot;
}

/** Interroge le service de taux ; garde les taux actuels en cas d'échec. */
export async function refreshRates(): Promise<boolean> {
  if (env.EXCHANGE_RATES_URL === 'off') return false;
  try {
    const response = await fetch(env.EXCHANGE_RATES_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = z
      .object({ result: z.literal('success'), base_code: z.literal('EUR'), time_last_update_unix: z.number(), rates: ratesSchema })
      .parse(await response.json());
    snapshot = {
      base: 'EUR',
      rates: withParities(payload.rates),
      updatedAt: new Date(payload.time_last_update_unix * 1000).toISOString(),
      source: 'live',
    };
    return true;
  } catch (error) {
    console.warn('[devises] taux non rafraîchis, conservation des précédents :', error instanceof Error ? error.message : error);
    await getRates();
    return false;
  }
}

export function startExchangeRateRefresher(): void {
  if (timer || env.EXCHANGE_RATES_URL === 'off') return;
  void refreshRates();
  timer = setInterval(() => void refreshRates(), REFRESH_INTERVAL_MS);
  timer.unref();
}

export function stopExchangeRateRefresher(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Convertit un montant ; null si l'une des devises n'a pas de taux. */
export function convertAmount(amount: number, from: string, to: string, rates: RatesSnapshot): number | null {
  if (from === to) return amount;
  const fromRate = rates.rates[from];
  const toRate = rates.rates[to];
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
}

/** Devise d'affichage pour un pays : la sienne si un taux existe, sinon le dollar. */
export function currencyForCountry(country: string | null | undefined, rates: RatesSnapshot): string {
  const currency = findCountry(country)?.currency;
  return currency && rates.rates[currency] ? currency : FALLBACK_CURRENCY;
}

export function isSupportedCurrency(currency: string, rates: RatesSnapshot): boolean {
  return Boolean(rates.rates[currency]);
}

/** Montant en plus petite unité de la devise (centimes), et inversement. */
export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * 10 ** fractionDigits(currency));
}

export function fromMinorUnits(minor: number, currency: string): number {
  return minor / 10 ** fractionDigits(currency);
}

/** Utilisé par les tests. */
export function resetRates(): void {
  snapshot = null;
}
