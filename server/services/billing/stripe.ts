import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@server/env';
import { AppError } from '@server/middleware';

/**
 * Client Stripe minimal (API REST, sans SDK) : sessions de paiement et signature des
 * webhooks. La clé secrète reste sur le serveur ; les journaux ne gardent que le
 * code de réponse, jamais la clé ni les données de carte (Stripe seul les voit).
 */

const TIMEOUT_MS = 20_000;

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  /** open · complete · expired */
  status: string | null;
  /** paid · unpaid · no_payment_required */
  payment_status: string | null;
  amount_total: number | null;
  currency: string | null;
  client_reference_id: string | null;
  metadata: Record<string, string> | null;
}

/** Mode de la clé configurée : test (aucune carte réelle débitée) ou réel. */
export function stripeMode(): 'test' | 'live' | null {
  const key = env.STRIPE_API_KEY?.trim();
  if (!key) return null;
  return /^(sk|rk)_test_/.test(key) ? 'test' : 'live';
}

/** Encode un objet imbriqué au format attendu par Stripe : line_items[0][quantity]=1. */
export function formEncode(value: Record<string, unknown>, prefix = '', params = new URLSearchParams()): URLSearchParams {
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => {
        if (item !== null && typeof item === 'object') formEncode(item as Record<string, unknown>, `${name}[${index}]`, params);
        else params.append(`${name}[${index}]`, String(item));
      });
    } else if (typeof entry === 'object') {
      formEncode(entry as Record<string, unknown>, name, params);
    } else {
      params.append(name, String(entry));
    }
  }
  return params;
}

async function stripeRequest<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const key = env.STRIPE_API_KEY?.trim();
  if (!key) throw new AppError(503, 'Le paiement en ligne n’est pas encore configuré sur ce serveur.', 'PAYMENT_NOT_CONFIGURED');

  let response: Response;
  try {
    response = await fetch(`${env.STRIPE_API_URL.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body ? formEncode(body).toString() : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(504, 'Le service de paiement n’a pas répondu à temps. Réessayez dans un instant.', 'PAYMENT_TIMEOUT');
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { code?: string; type?: string } } | null;
    console.error('[paiements] Stripe a répondu', response.status, payload?.error?.code ?? payload?.error?.type ?? '');
    if (response.status === 401) {
      throw new AppError(503, 'L’accès au service de paiement est refusé : clé Stripe invalide sur le serveur.', 'PAYMENT_ACCESS_DENIED');
    }
    if (response.status === 404) throw new AppError(404, 'Paiement introuvable.', 'PAYMENT_NOT_FOUND');
    throw new AppError(502, 'Le service de paiement a refusé la demande. Réessayez, ou contactez l’équipe Smart Creator.', 'PAYMENT_FAILED');
  }
  return (await response.json()) as T;
}

export function createCheckoutSession(body: Record<string, unknown>, idempotencyKey: string) {
  return stripeRequest<StripeCheckoutSession>('POST', '/v1/checkout/sessions', body, idempotencyKey);
}

export function retrieveCheckoutSession(sessionId: string) {
  return stripeRequest<StripeCheckoutSession>('GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

/**
 * Vérifie l'en-tête Stripe-Signature (t=…,v1=…) : HMAC-SHA256 de « t.corps » avec le
 * secret du webhook, comparé en temps constant, et horodatage de moins de 5 minutes
 * pour qu'un événement intercepté ne puisse pas être rejoué plus tard.
 */
export function verifyWebhookSignature(rawBody: Buffer, header: string | undefined, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(',').map((part) => part.trim().split('='));
  const timestamp = Number(parts.find(([name]) => name === 't')?.[1]);
  const signatures = parts.filter(([name]) => name === 'v1').map(([, value]) => value ?? '');
  if (!Number.isFinite(timestamp) || signatures.length === 0 || Math.abs(now / 1000 - timestamp) > 300) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  return signatures.some((signature) => {
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
