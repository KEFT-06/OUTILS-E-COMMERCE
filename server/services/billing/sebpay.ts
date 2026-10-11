import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@server/env';
import { AppError } from '@server/middleware';

/**
 * Client SebPay (Mobile Money), d'après sa documentation publique lue le 11/10/2026
 * (new.sebpay.bj/fr/docs) :
 *
 *  - en-têtes `X-Public-Key` et `X-Secret-Key` sur chaque appel ;
 *  - `POST /collections` envoie la demande de paiement sur le téléphone du client ;
 *  - `GET /collections/{référence}` rend son état : pending, approved ou rejected ;
 *  - `GET /operators?country=CM` et `GET /countries` disent ce qui est ouvert, et quels
 *    opérateurs exigent un code de confirmation (`otp_required`, `ussd_code`) ;
 *  - toute réponse est enveloppée : `{ success, data, message }`.
 *
 * Les clés restent sur le serveur. Les journaux ne gardent que le code de réponse et le code
 * d'erreur de SebPay — jamais une clé, jamais un numéro de téléphone.
 */

/** Envoi d'une demande de paiement : l'opérateur peut mettre du temps à l'accepter. */
const TIMEOUT_MS = 25_000;
/** Lecture d'un état : l'écran qui attend la refera dans quelques secondes. */
const STATUS_TIMEOUT_MS = 12_000;
/** Listes de référence : elles ne doivent jamais retenir l'ouverture d'un écran. */
const REFERENCE_TIMEOUT_MS = 8_000;

export function sebpayConfigured(): boolean {
  return Boolean(env.SEBPAY_PUBLIC_KEY?.trim() && env.SEBPAY_SECRET_KEY?.trim());
}

/** Mode des clés : « test » (bac à sable, aucun argent réel) ou « live ». null : non configuré. */
export function sebpayMode(): 'test' | 'live' | null {
  if (!sebpayConfigured()) return null;
  return /_test_/.test(`${env.SEBPAY_PUBLIC_KEY} ${env.SEBPAY_SECRET_KEY}`) ? 'test' : 'live';
}

interface Envelope {
  success?: boolean;
  data?: unknown;
  message?: string;
  errors?: { code?: string } | null;
}

const closed = () =>
  new AppError(503, 'Le paiement par Mobile Money est momentanément fermé : aucun montant n’a été débité.', 'MOBILE_MONEY_CLOSED');

async function sebpayRequest(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  if (!sebpayConfigured()) throw closed();

  let response: Response;
  try {
    response = await fetch(`${env.SEBPAY_API_URL.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        'X-Public-Key': env.SEBPAY_PUBLIC_KEY!.trim(),
        'X-Secret-Key': env.SEBPAY_SECRET_KEY!.trim(),
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AppError(504, 'Le service de paiement n’a pas répondu : aucun montant n’a été débité.', 'PAYMENT_TIMEOUT');
  }

  const payload = (await response.json().catch(() => null)) as Envelope | null;
  if (response.ok && payload?.success !== false) return payload?.data ?? payload;

  const code = payload?.errors?.code ?? '';
  console.error('[paiements] SebPay a répondu', response.status, code);
  // Clés refusées, compte inactif ou adresse du serveur non autorisée : rien que le client puisse corriger.
  if (response.status === 401 || response.status === 403 || code === 'IP_NOT_ALLOWED') throw closed();
  if (response.status === 404) throw new AppError(404, 'Paiement introuvable.', 'PAYMENT_NOT_FOUND');
  if (response.status === 429 || response.status >= 500) {
    throw new AppError(502, 'Le paiement n’a pas pu démarrer : aucun montant n’a été débité.', 'PAYMENT_FAILED');
  }
  throw new AppError(
    400,
    'L’opérateur a refusé la demande : vérifiez le numéro, l’opérateur choisi et, s’il est demandé, le code de confirmation. Aucun montant n’a été débité.',
    'PAYMENT_REFUSED',
  );
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** La liste portée par une réponse, qu'elle soit rendue telle quelle ou rangée sous une clé. */
function listOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.map(record);
  const holder = record(data);
  for (const key of ['data', 'operators', 'countries', 'items']) {
    if (Array.isArray(holder[key])) return (holder[key] as unknown[]).map(record);
  }
  return [];
}

export interface MobileOperator {
  slug: string;
  name: string;
  /** L'opérateur exige un code que le client obtient en composant `ussdCode` sur son téléphone. */
  otpRequired: boolean;
  ussdCode: string | null;
}

export interface MobileCountry {
  /** Code ISO à deux lettres. */
  code: string;
  name: string;
  /** Indicatif téléphonique, en chiffres seulement. */
  prefix: string;
  currency: string | null;
}

const isoOf = (value: unknown): string => {
  const holder = record(value);
  return text(holder.country_code ?? holder.code ?? holder.iso ?? holder.iso2 ?? (typeof value === 'string' ? value : '')).toUpperCase();
};

/**
 * Lectures de référence gardées quelques minutes : elles changent rarement, et chaque écran de
 * paiement les demande. Un refus est gardé lui aussi, moins longtemps : des clés refusées ou un
 * prestataire en panne ne sont pas sollicités de nouveau à chaque visite de la page « Mon compte ».
 */
const memory = new Map<string, { at: number; value?: unknown; error?: unknown }>();
const REFERENCE_TTL_MS = 10 * 60_000;
const REFUSAL_TTL_MS = 2 * 60_000;

async function remembered<T>(key: string, read: () => Promise<T>): Promise<T> {
  const known = memory.get(key);
  if (known && Date.now() - known.at < (known.error ? REFUSAL_TTL_MS : REFERENCE_TTL_MS)) {
    if (known.error) throw known.error;
    return known.value as T;
  }
  try {
    const value = await read();
    memory.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    memory.set(key, { at: Date.now(), error });
    throw error;
  }
}

/** Oublie les lectures de référence (tests). */
export function resetSebpayMemory(): void {
  memory.clear();
}

export function listCountries(): Promise<MobileCountry[]> {
  return remembered('pays', async () =>
    listOf(await sebpayRequest('GET', '/countries', undefined, REFERENCE_TIMEOUT_MS))
      .map((entry) => {
        const currency = entry.currency;
        return {
          code: isoOf(entry),
          name: text(entry.country_name ?? entry.name),
          prefix: text(entry.prefix).replace(/\D/g, ''),
          currency: (typeof currency === 'string' ? currency : text(record(currency).code ?? record(currency).currency_code ?? record(currency).iso)).toUpperCase() || null,
        };
      })
      .filter((country) => /^[A-Z]{2}$/.test(country.code)),
  );
}

export function listOperators(country: string): Promise<MobileOperator[]> {
  const iso = country.toUpperCase();
  return remembered(`opérateurs:${iso}`, async () =>
    listOf(await sebpayRequest('GET', `/operators?country=${encodeURIComponent(iso)}`, undefined, REFERENCE_TIMEOUT_MS))
      // Le filtre par pays est appliqué ici aussi : une liste entière ne doit pas proposer l'opérateur d'un autre pays.
      .filter((entry) => {
        const of = isoOf(entry.country);
        return !of || of === iso;
      })
      .filter((entry) => entry.is_active !== false && entry.active !== false && !/^(inactive|disabled)$/i.test(text(entry.status)))
      .map((entry) => ({
        slug: text(entry.slug).toLowerCase(),
        name: text(entry.name) || text(entry.slug),
        otpRequired: entry.otp_required === true,
        ussdCode: text(entry.ussd_code) || null,
      }))
      .filter((operator) => /^[a-z0-9_-]{2,40}$/.test(operator.slug)),
  );
}

export interface Collection {
  transactionId: string | null;
  status: 'pending' | 'approved' | 'rejected';
  amount: number | null;
  currency: string | null;
  /** Adresse où le client valide son paiement, pour les opérateurs qui en ont une. */
  providerLink: string | null;
}

/** Les états de SebPay, et les variantes de sa page « codes de statut », ramenés à trois. */
export function collectionStatus(value: unknown): Collection['status'] {
  const status = text(value).toLowerCase();
  if (/^(approved|success|successful|succeeded|completed|paid)$/.test(status)) return 'approved';
  if (/^(rejected|failed|failure|cancell?ed|expired|declined)$/.test(status)) return 'rejected';
  return 'pending';
}

const KNOWN_STATUS = /^(approved|success|successful|succeeded|completed|paid|rejected|failed|failure|cancell?ed|expired|declined|pending|processing|initiated|in_progress)$/;

/**
 * La collecte portée par une réponse. La documentation la rend à plat ; si elle arrivait rangée
 * sous une clé (« transaction », « collection »), on la lit quand même : un paiement approuvé que
 * nous ne saurions pas lire resterait sans palier.
 */
function collectionOf(data: unknown): Collection {
  let entry = record(data);
  if (entry.status === undefined) {
    for (const key of ['transaction', 'collection', 'payment', 'data']) {
      if (record(entry[key]).status !== undefined) {
        entry = record(entry[key]);
        break;
      }
    }
  }
  // Un état que nous ne connaissons pas est consigné (le mot seul) : c'est le signe que le contrat a changé.
  const status = text(entry.status).toLowerCase();
  if (status && !KNOWN_STATUS.test(status)) console.warn('[paiements] état Mobile Money inconnu :', status.slice(0, 40));
  const amount = Number(entry.amount);
  const link = text(entry.provider_link);
  return {
    transactionId: text(entry.transaction_id ?? entry.id) || null,
    status: collectionStatus(entry.status),
    amount: Number.isFinite(amount) ? amount : null,
    currency: text(entry.currency).toUpperCase() || null,
    providerLink: /^https:\/\//i.test(link) ? link : null,
  };
}

export async function createCollection(input: {
  amount: number;
  currency: string;
  phone: string;
  operator: string;
  country: string;
  reference: string;
  callbackUrl: string;
  otpCode?: string;
}): Promise<Collection> {
  return collectionOf(
    await sebpayRequest('POST', '/collections', {
      amount: input.amount,
      currency: input.currency,
      phone: input.phone,
      operator: input.operator,
      country: input.country,
      external_reference: input.reference,
      callback_url: input.callbackUrl,
      ...(input.otpCode ? { otp_code: input.otpCode } : {}),
    }),
  );
}

export async function getCollection(reference: string): Promise<Collection> {
  return collectionOf(await sebpayRequest('GET', `/collections/${encodeURIComponent(reference)}`, undefined, STATUS_TIMEOUT_MS));
}

/**
 * La notification porte-t-elle bien la signature de SebPay ? HMAC-SHA256 du corps reçu, calculé
 * avec la clé secrète. La documentation ne dit pas comment il est écrit : l'hexadécimal et le
 * base64 sont acceptés, avec ou sans le préfixe « sha256= ».
 */
export function signatureMatches(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  const given = header?.trim().replace(/^sha256=/i, '');
  if (!given) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return [Buffer.from(given, 'hex'), Buffer.from(given, 'base64')].some((candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected));
}
