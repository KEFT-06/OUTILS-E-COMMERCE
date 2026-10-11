import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { apiRequest } from './api';
import { ApiError } from './apiError';

/**
 * Une lecture tombée sur une panne passagère est redemandée une fois, sans rien montrer ; une
 * action, elle, n'est jamais rejouée à l'insu de celui qui l'a lancée.
 */

const vraiFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = vraiFetch;
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const interne = () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'Une erreur interne est survenue.' } });

/** Répond dans l'ordre donné, et compte les demandes reçues. */
function serveur(reponses: Array<() => Response | Promise<Response>>) {
  const demandes: Array<{ path: string; method: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    demandes.push({ path: String(input), method: init?.method ?? 'GET' });
    const suivante = reponses[Math.min(demandes.length, reponses.length) - 1]!;
    return suivante();
  }) as typeof fetch;
  return demandes;
}

describe('lecture redemandée après une panne passagère', () => {
  it('une erreur interne puis une réponse : le visiteur ne voit que la réponse', async () => {
    const demandes = serveur([interne, () => json(200, { products: ['guide'] })]);
    assert.deepEqual(await apiRequest('/api/workspace/custom_products'), { products: ['guide'] });
    assert.equal(demandes.length, 2);
  });

  it('un réseau coupé puis rétabli, une base momentanément indisponible, une coupure de l’hébergeur : même chose', async () => {
    for (const panne of [
      () => Promise.reject(new TypeError('fetch failed')),
      () => json(503, { error: { code: 'DATABASE_UNAVAILABLE', message: 'Le service est momentanément indisponible.' } }),
      () => new Response('An error occurred', { status: 504 }),
    ]) {
      const demandes = serveur([panne, () => json(200, { ok: true })]);
      assert.deepEqual(await apiRequest('/api/auth/me'), { ok: true });
      assert.equal(demandes.length, 2);
    }
  });

  it('une seule nouvelle demande : la panne qui dure est dite', async () => {
    const demandes = serveur([interne]);
    await assert.rejects(apiRequest('/api/auth/me'), (error: unknown) => error instanceof ApiError && error.code === 'INTERNAL_ERROR');
    assert.equal(demandes.length, 2);
  });

  it('un refus qui a une raison n’est pas redemandé', async () => {
    for (const refus of [
      () => json(404, { error: { code: 'NOT_FOUND', message: 'Introuvable.' } }),
      () => json(429, { error: { code: 'RATE_LIMITED', message: 'Trop de demandes.' } }),
      () => json(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'Ce service est momentanément indisponible.' } }),
    ]) {
      const demandes = serveur([refus]);
      await assert.rejects(apiRequest('/api/espionnage'));
      assert.equal(demandes.length, 1);
    }
  });

  it('une action n’est jamais rejouée : ni création, ni paiement, ni génération', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const demandes = serveur([interne, () => json(200, { ok: true })]);
      await assert.rejects(apiRequest('/api/billing/checkout', { method, body: method === 'DELETE' ? undefined : { plan: 'pro' } }));
      assert.equal(demandes.length, 1, method);
    }
  });

  it('une lecture abandonnée par l’écran n’est pas redemandée', async () => {
    const abandon = new AbortController();
    const demandes = serveur([
      () => {
        abandon.abort();
        return interne();
      },
      () => json(200, { ok: true }),
    ]);
    await assert.rejects(apiRequest('/api/espionnage', { signal: abandon.signal }));
    assert.equal(demandes.length, 1);
  });
});
