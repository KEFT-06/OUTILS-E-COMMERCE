import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Nouvelles tentatives auprès de Google, contre un faux service.
 *
 * Seul le 503 était réessayé. Un ebook enchaîne des dizaines d'appels : un 429 (débit par
 * minute) ou une réponse tronquée faisait échouer tout l'ouvrage, alors que la même demande
 * passait quelques secondes plus tard. À l'inverse, une demande refusée pour ce qu'elle est
 * (400) ne doit pas être répétée : elle échouerait pareil, et ferait attendre pour rien.
 */

/** Réponses à servir dans l'ordre ; au-delà, une réponse valide. */
let script: { status: number; body: unknown; headers?: Record<string, string> }[] = [];
let calls = 0;
/** Modèle appelé à chaque tentative, lu dans l'adresse. */
let models: string[] = [];

const VALID = { candidates: [{ content: { parts: [{ text: JSON.stringify({ ok: 'oui' }) }] } }] };
const TRUNCATED = { candidates: [{ content: { parts: [{ text: '{"ok": "o' }] } }] };

const fakeGoogle = createServer((req, res) => {
  models.push(decodeURIComponent(/models\/([^:]+):/.exec(req.url ?? '')?.[1] ?? ''));
  req.resume();
  req.on('end', () => {
    const next = script[calls] ?? { status: 200, body: VALID };
    calls += 1;
    res.writeHead(next.status, { 'content-type': 'application/json', ...next.headers });
    res.end(JSON.stringify(next.body));
  });
});

before(async () => {
  await new Promise<void>((resolve) => fakeGoogle.listen(0, '127.0.0.1', resolve));
  await createTestApp({ GEMINI_API_URL: `http://127.0.0.1:${(fakeGoogle.address() as AddressInfo).port}` });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => fakeGoogle.close(() => resolve()));
});

beforeEach(() => {
  script = [];
  calls = 0;
  models = [];
});

async function ask(): Promise<{ ok: string }> {
  const { generateJson } = await import('@server/services/ai/gemini');
  return generateJson({
    service: { name: 'service de test', code: 'TEST', log: 'test' },
    prompt: 'Réponds.',
    responseSchema: { type: 'OBJECT' },
    parse: (value) => {
      const ok = (value as { ok?: unknown }).ok;
      if (typeof ok !== 'string') throw new Error('illisible');
      return { ok };
    },
    timeoutMs: 60_000,
  });
}

describe('Gemini — nouvelles tentatives', () => {
  it('réessaie après un 429 en respectant le délai demandé par Google', async () => {
    script = [
      {
        status: 429,
        body: { error: { status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1s' }] } },
      },
    ];
    const started = Date.now();
    assert.deepEqual(await ask(), { ok: 'oui' });
    assert.equal(calls, 2);
    assert.ok(Date.now() - started >= 900, 'le délai de Google est respecté');
  });

  it('réessaie après une panne interne ou une coupure de passerelle', async () => {
    script = [
      { status: 500, body: { error: { status: 'INTERNAL' } } },
      { status: 504, body: { error: { status: 'DEADLINE_EXCEEDED' } } },
    ];
    assert.deepEqual(await ask(), { ok: 'oui' });
    assert.equal(calls, 3);
  });

  it('redemande une fois une réponse tronquée, pas davantage', async () => {
    script = [{ status: 200, body: TRUNCATED }];
    assert.deepEqual(await ask(), { ok: 'oui' });
    assert.equal(calls, 2);

    script = [
      { status: 200, body: TRUNCATED },
      { status: 200, body: TRUNCATED },
    ];
    calls = 0;
    await assert.rejects(ask(), (error: { code?: string }) => error.code === 'TEST_UNREADABLE');
    assert.equal(calls, 2, 'une seule nouvelle demande : la réponse est facturée');
  });

  it('ne répète pas une demande refusée pour ce qu’elle est', async () => {
    script = [{ status: 400, body: { error: { status: 'INVALID_ARGUMENT' } } }];
    await assert.rejects(ask(), (error: { code?: string }) => error.code === 'TEST_FAILED');
    assert.equal(calls, 1);
  });

  it('annonce la saturation quand toutes les tentatives sont refusées', async () => {
    script = Array.from({ length: 6 }, () => ({ status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED' } } }));
    await assert.rejects(ask(), (error: { code?: string; message?: string }) => error.code === 'TEST_RATE_LIMITED');
    assert.equal(calls, 6, 'deux tentatives par modèle, pas davantage');
  });

  it('passe au modèle de dernier recours quand le principal et le secours refusent', async () => {
    // Le cas vu en production : un ebook de seize sections épuisait les limites des deux versions récentes.
    script = Array.from({ length: 4 }, () => ({ status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED' } } }));
    assert.deepEqual(await ask(), { ok: 'oui' });
    assert.deepEqual(models, ['gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash', 'gemini-2.5-flash']);
  });
});
