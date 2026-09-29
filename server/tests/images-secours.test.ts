import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Images : un « trop de demandes » chez Google ne doit plus finir en erreur devant l'auteur
 * (couverture refusée le 29/09/2026 avec « service d'images très demandé »). Les modèles Nano
 * Banana ont chacun leurs limites : on passe de l'un à l'autre, puis, en dernier recours, à
 * l'autre moteur. Faux fournisseurs seulement.
 */

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const QUOTA = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota, please check your plan and billing details.' } };
const IMAGE = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] } }] };

/** Réponse de chaque modèle Gemini ; absent : image rendue. */
let geminiAnswers: Record<string, { status: number; body: unknown }> = {};
let geminiCalls: string[] = [];
let cloudflareCalls = 0;

const fake = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const gemini = /\/v1beta\/models\/([^:]+):generateContent/.exec(req.url ?? '');
    if (gemini) {
      const model = decodeURIComponent(gemini[1]!);
      geminiCalls.push(model);
      const answer = geminiAnswers[model];
      return answer ? send(answer.status, answer.body) : send(200, IMAGE);
    }
    if ((req.url ?? '').includes('/ai/run/')) {
      cloudflareCalls += 1;
      return send(200, { success: true, result: { image: PNG } });
    }
    send(404, {});
  });
});

before(async () => {
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  await createTestApp({
    GEMINI_API_KEY: 'cle-gemini-de-test',
    GEMINI_API_URL: base,
    CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    CLOUDFLARE_AI_TOKEN: 'jeton-de-test',
    CLOUDFLARE_AI_URL: base,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => fake.close(() => resolve()));
});

beforeEach(() => {
  geminiAnswers = {};
  geminiCalls = [];
  cloudflareCalls = 0;
});

const premium = async () => {
  const { generateImage } = await import('@server/services/ai/image');
  return generateImage({ prompt: 'Couverture d’un guide de musculation', aspectRatio: '9:16', tier: 'premium' });
};

describe('Images — modèles de secours', () => {
  it('passe au Nano Banana suivant quand le premier a atteint sa limite', async () => {
    geminiAnswers = { 'gemini-3-pro-image': { status: 429, body: QUOTA } };
    const image = await premium();
    assert.equal(image.model, 'gemini-3.1-flash-image', 'le modèle qui a rendu l’image est tracé');
    assert.deepEqual(geminiCalls, ['gemini-3-pro-image', 'gemini-3.1-flash-image'], 'un refus de débit ne se réessaie pas sur le même modèle');
    assert.equal(cloudflareCalls, 0);
  });

  it('réessaie une surcharge une fois, puis continue la chaîne', async () => {
    geminiAnswers = {
      'gemini-3-pro-image': { status: 503, body: { error: { status: 'UNAVAILABLE' } } },
      'gemini-3.1-flash-image': { status: 429, body: QUOTA },
    };
    const image = await premium();
    assert.equal(image.model, 'gemini-2.5-flash-image');
    assert.deepEqual(geminiCalls, ['gemini-3-pro-image', 'gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image']);
  });

  it('se replie sur l’autre moteur quand tous les Nano Banana refusent', async () => {
    geminiAnswers = Object.fromEntries(['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'].map((model) => [model, { status: 429, body: QUOTA }]));
    const image = await premium();
    assert.equal(cloudflareCalls, 1, 'l’image est rendue au lieu d’une erreur');
    assert.ok(image.bytes.length > 0);
  });

  it('ne se replie pas sur une description refusée : l’autre moteur la refuserait de même', async () => {
    geminiAnswers = { 'gemini-3-pro-image': { status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } } };
    await assert.rejects(premium(), (error: { code?: string }) => error.code === 'GEMINI_IMAGE_BLOCKED');
    assert.equal(cloudflareCalls, 0);
    assert.deepEqual(geminiCalls, ['gemini-3-pro-image']);
  });
});
