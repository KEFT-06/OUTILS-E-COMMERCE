import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Refus 429 de Google : débit de la minute, quota du jour, ou projet sans crédit. Le site les
 * confondait en « service très demandé ». Ils appellent trois réactions différentes : changer
 * de modèle, attendre, ou prévenir l'administrateur sans insister. Faux Google seulement.
 */

const refus = (message: string, quotaId?: string, quotaValue?: string) => ({
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message,
    details: quotaId ? [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId, quotaValue }] }] : [],
  },
});
const CREDITS = refus('Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.');
const SANS_FRANCHISE = refus('Quota exceeded for metric: generate_content_free_tier_requests, limit: 0');
const IMAGE = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' } }] } }] };
const MINUTE = refus('You exceeded your current quota, please check your plan and billing details.', 'GenerateRequestsPerMinutePerProjectPerModel', '10');

let reponses: Record<string, { status: number; body: unknown }> = {};
let appels: string[] = [];

const faux = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = req.url ?? '';
    appels.push(`${req.method} ${url.replace(/\?.*$/, '')}`);
    const lancement = /\/v1beta\/models\/([^:/]+):predictLongRunning/.exec(url);
    if (lancement) {
      const r = reponses[lancement[1]!];
      return r ? send(r.status, r.body) : send(200, { name: `models/${lancement[1]}/operations/opvideo42` });
    }
    const suivi = /\/v1beta\/models\/([^/]+)\/operations\/([^/?]+)/.exec(url);
    if (suivi) return send(200, { name: `models/${suivi[1]}/operations/${suivi[2]}`, done: false });
    const texte = /\/v1beta\/models\/([^:]+):generateContent/.exec(url);
    if (texte) {
      const r = reponses[decodeURIComponent(texte[1]!)];
      return r ? send(r.status, r.body) : send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ ok: 'oui' }) }] } }] });
    }
    send(404, {});
  });
});

before(async () => {
  await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
  await createTestApp({ GEMINI_API_KEY: 'cle-gemini-de-test', GEMINI_API_URL: `http://127.0.0.1:${(faux.address() as AddressInfo).port}` });
});
after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => faux.close(() => r()));
});
beforeEach(() => {
  reponses = {};
  appels = [];
});

describe('Refus de Google', () => {
  it('distingue débit de la minute, quota du jour et projet sans crédit', async () => {
    const { classifyGoogle429 } = await import('@server/services/ai/googleRefusal');
    assert.equal(classifyGoogle429(CREDITS), 'billing');
    // Sans franchise gratuite sur CE modèle : le refus ne vaut pas pour les autres.
    assert.equal(classifyGoogle429(SANS_FRANCHISE), 'no_free_tier');
    assert.equal(classifyGoogle429(refus('quota', 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', '0')), 'no_free_tier');
    assert.equal(classifyGoogle429(MINUTE), 'per_minute');
    assert.equal(classifyGoogle429(refus('quota', 'GenerateRequestsPerDayPerProjectPerModel', '250')), 'per_day');
    assert.equal(classifyGoogle429(null), 'unknown');
  });

  it('arrête la rédaction sans insister quand le projet de la clé n’a plus de crédit', async () => {
    reponses = { 'gemini-3.6-flash': { status: 429, body: CREDITS } };
    const { generateJson } = await import('@server/services/ai/gemini');
    await assert.rejects(
      generateJson({ service: { name: 'service de test', code: 'TEST', log: 'test' }, prompt: 'Réponds.', responseSchema: { type: 'OBJECT' }, parse: (v) => v, timeoutMs: 30_000 }),
      (error: { code?: string; message?: string }) => error.code === 'TEST_INSUFFICIENT_CREDITS' && !/saturé|très demandé/.test(error.message ?? ''),
    );
    assert.equal(appels.length, 1, 'un seul appel : les autres modèles partagent le même projet');
    const { lastGoogleRefusal } = await import('@server/services/ai/googleRefusal');
    assert.equal(lastGoogleRefusal()?.kind, 'billing', 'la cause est gardée pour l’état des services');
  });

  it('essaie les modèles d’image suivants quand le premier n’a pas de franchise gratuite', async () => {
    // Constaté en production le 04/10/2026 : le modèle principal refusait ainsi, et le site
    // annonçait « images pas encore activées » sans essayer les modèles voisins.
    reponses = { 'gemini-3-pro-image': { status: 429, body: SANS_FRANCHISE }, 'gemini-3.1-flash-image': { status: 200, body: IMAGE } };
    const { generateGeminiImage } = await import('@server/services/ai/geminiImage');
    const image = await generateGeminiImage({ prompt: 'Une couturière dans son atelier', aspectRatio: '1:1' });
    assert.equal(image.model, 'gemini-3.1-flash-image');
    assert.equal(appels.length, 2, 'le modèle refusé, puis le suivant');
  });

  it('ne conclut à la facturation que si tous les modèles d’image refusent faute de franchise', async () => {
    reponses = Object.fromEntries(['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'].map((m) => [m, { status: 429, body: SANS_FRANCHISE }]));
    const { generateGeminiImage } = await import('@server/services/ai/geminiImage');
    await assert.rejects(generateGeminiImage({ prompt: 'Une couturière', aspectRatio: '1:1' }), (error: { code?: string }) => error.code === 'GEMINI_IMAGE_BILLING_REQUIRED');
    assert.equal(appels.length, 3, 'chaque modèle a eu sa chance');
  });

  it('n’essaie aucun autre modèle d’image quand le projet n’a plus de crédit', async () => {
    reponses = { 'gemini-3-pro-image': { status: 429, body: CREDITS } };
    const { generateGeminiImage } = await import('@server/services/ai/geminiImage');
    await assert.rejects(generateGeminiImage({ prompt: 'Une couturière', aspectRatio: '1:1' }), (error: { code?: string }) => error.code === 'GEMINI_IMAGE_BILLING_REQUIRED');
    assert.equal(appels.length, 1);
  });

  it('passe la vidéo au modèle lite quand le quota du modèle principal est atteint, et la suit au bon endroit', async () => {
    reponses = { 'veo-3.1-fast-generate-preview': { status: 429, body: MINUTE } };
    const { getVeoGeneration, submitVeoGeneration } = await import('@server/services/veo');
    const lance = await submitVeoGeneration({ prompt: 'Une couturière dans son atelier', negativePrompt: '', aspectRatio: '9:16', durationSeconds: 8 });
    assert.equal(lance.status, 'queued');
    assert.deepEqual(appels, ['POST /v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning', 'POST /v1beta/models/veo-3.1-lite-generate-preview:predictLongRunning']);

    appels = [];
    await getVeoGeneration(lance.requestId);
    assert.deepEqual(appels, ['GET /v1beta/models/veo-3.1-lite-generate-preview/operations/opvideo42'], 'le suivi interroge le modèle qui a lancé le rendu');
  });

  it('ne change pas de modèle vidéo quand le projet n’a plus de crédit', async () => {
    reponses = { 'veo-3.1-fast-generate-preview': { status: 429, body: CREDITS } };
    const { submitVeoGeneration } = await import('@server/services/veo');
    await assert.rejects(
      submitVeoGeneration({ prompt: 'Une couturière', negativePrompt: '', aspectRatio: '16:9', durationSeconds: 8 }),
      (error: { code?: string }) => error.code === 'VEO_BILLING_REQUIRED',
    );
    assert.equal(appels.length, 1);
  });
});
