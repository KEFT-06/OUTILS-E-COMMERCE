import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Images : FLUX (Cloudflare) d'abord, Gemini en secours. Un « trop de demandes » chez
 * Google ne doit plus finir en erreur devant l'auteur. Faux fournisseurs seulement.
 */

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const QUOTA = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota, please check your plan and billing details.' } };
const IMAGE = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] } }] };
const CF_QUOTA = { success: false, errors: [{ code: 3009, message: 'Quota exceeded: daily neuron limit' }] };

/** Réponse de chaque modèle Gemini ; absent : image rendue. */
let geminiAnswers: Record<string, { status: number; body: unknown }> = {};
let geminiCalls: string[] = [];
let cloudflareCalls = 0;
/** Nombre d'images que Cloudflare « écarte » avant d'en rendre une. */
let cloudflareFlags = 0;
/** Si vrai, Cloudflare refuse pour quota (déclenche le secours Gemini). */
let cloudflareQuota = false;
const FLAGGED = { success: false, errors: [{ code: 3030, message: 'AiError: Your output has been flagged. Please choose another prompt / input image combination' }] };

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
      if (cloudflareQuota) return send(429, CF_QUOTA);
      if (cloudflareCalls <= cloudflareFlags) return send(400, FLAGGED);
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
  cloudflareFlags = 0;
  cloudflareQuota = false;
});

const premium = async () => {
  const { generateImage } = await import('@server/services/ai/image');
  return generateImage({ prompt: 'Couverture d’un guide de musculation', aspectRatio: '9:16', tier: 'premium' });
};

describe('Images — FLUX d’abord, modèles de secours', () => {
  it('confie premium à Cloudflare (FLUX) sans appeler Gemini', async () => {
    const image = await premium();
    assert.equal(cloudflareCalls, 1);
    assert.equal(geminiCalls.length, 0);
    assert.ok(image.bytes.length > 0);
  });

  it('passe au Nano Banana suivant quand Cloudflare est à sec et le premier Gemini a atteint sa limite', async () => {
    cloudflareQuota = true;
    geminiAnswers = { 'gemini-3-pro-image': { status: 429, body: QUOTA } };
    const image = await premium();
    assert.equal(image.model, 'gemini-3.1-flash-image', 'le modèle qui a rendu l’image est tracé');
    assert.equal(cloudflareCalls, 1);
    assert.deepEqual(geminiCalls, ['gemini-3-pro-image', 'gemini-3.1-flash-image'], 'un refus de débit ne se réessaie pas sur le même modèle');
  });

  it('réessaie une surcharge Gemini une fois, puis continue la chaîne, après quota Cloudflare', async () => {
    cloudflareQuota = true;
    geminiAnswers = {
      'gemini-3-pro-image': { status: 503, body: { error: { status: 'UNAVAILABLE' } } },
      'gemini-3.1-flash-image': { status: 429, body: QUOTA },
    };
    const image = await premium();
    assert.equal(image.model, 'gemini-2.5-flash-image');
    assert.deepEqual(geminiCalls, ['gemini-3-pro-image', 'gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image']);
  });

  it('refait une image écartée par le filtre Cloudflare, au lieu d’accuser la description', async () => {
    cloudflareFlags = 1;
    const { generateImage } = await import('@server/services/ai/image');
    const image = await generateImage({ prompt: 'Une formatrice devant son ordinateur', aspectRatio: '3:4', tier: 'quality' });
    assert.equal(cloudflareCalls, 2, 'un second tirage');
    assert.equal(geminiCalls.length, 0);
    assert.ok(image.bytes.length > 0);
  });

  it('passe à Gemini quand le filtre Cloudflare écarte deux tirages de suite', async () => {
    cloudflareFlags = 2;
    const { generateImage } = await import('@server/services/ai/image');
    const image = await generateImage({ prompt: 'Une formatrice devant son ordinateur', aspectRatio: '3:4', tier: 'quality' });
    assert.equal(cloudflareCalls, 2);
    assert.deepEqual(geminiCalls, ['gemini-3-pro-image'], 'l’image est rendue par l’autre moteur');
    assert.equal(image.model, 'gemini-3-pro-image');
  });

  it('ne se replie pas plus loin sur une description refusée par Gemini après quota Cloudflare', async () => {
    cloudflareQuota = true;
    geminiAnswers = { 'gemini-3-pro-image': { status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } } };
    await assert.rejects(premium(), (error: { code?: string }) => error.code === 'GEMINI_IMAGE_BLOCKED');
    assert.equal(cloudflareCalls, 1);
    assert.deepEqual(geminiCalls, ['gemini-3-pro-image']);
  });
});
