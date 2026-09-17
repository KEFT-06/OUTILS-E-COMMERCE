import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Rédaction par l'IA contre un faux Gemini : modules d'un produit et kit de
 * lancement. Le faux modèle glisse une promesse de gain, un module inconnu, un temps
 * de script inventé et une durée absente de la table ; le serveur doit les écarter
 * ou les signaler, facturer une seule fois et rembourser en cas d'échec.
 */

const prompts: string[] = [];
const models: string[] = [];

const fakeGemini = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', async () => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { contents: { parts: { text: string }[] }[] };
    const prompt = body.contents[0]!.parts[0]!.text;
    const model = decodeURIComponent(/\/models\/([^:]+):generateContent/.exec(req.url ?? '')?.[1] ?? '');
    prompts.push(prompt);
    models.push(model);
    if (prompt.includes('Titre : Panne')) return send(500, {});
    // Réponse réelle de Google quand le modèle est saturé (relevée le 16 septembre 2026).
    const overloaded = { error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } };
    if (prompt.includes('Titre : Saturé partout')) return send(503, overloaded);
    if (prompt.includes('Titre : Saturé') && model === 'gemini-3.5-flash') return send(503, overloaded);

    let answer: unknown;
    if (prompt.includes('Rédige le contenu complet')) {
      answer = {
        modules: [
          { index: 1, content: 'Choisir un emplacement ombragé.\n\n\n- Mesurer la surface\n- Prévoir [à compléter : prix local du grillage]' },
          { index: 2, content: 'Avec cette méthode, gagnez 500 000 FCFA par mois dès le premier mois.' },
          { index: 99, content: 'Module qui n’existe pas.' },
        ],
      };
    } else {
      const { getLaunchKitConfig } = await import('@server/services/launchKit');
      const config = await getLaunchKitConfig();
      const format = config.scriptFormats[0]!;
      answer = {
        copies: [
          { primaryText: 'Un poulailler propre, étape par étape.', headline: 'Le guide du poulailler', description: 'Pas à pas' },
          { primaryText: 'Vos questions sur l’élevage en ville, enfin claires.', headline: 'Élever en ville', description: 'Guide pratique' },
          { primaryText: 'Ce que personne ne vous dit sur les poules.', headline: 'Les erreurs à éviter', description: 'À lire' },
          { primaryText: 'Quatrième variante en trop.', headline: 'En trop', description: 'En trop' },
        ],
        scripts: [
          {
            durationSeconds: format.durationSeconds,
            beats: [
              ...format.beats.map((beat) => ({ id: beat.id, onScreen: `Écran ${beat.label}`, voiceOver: `Voix ${beat.label}` })),
              { id: 'temps-invente', onScreen: 'Inventé', voiceOver: 'Inventé' },
            ],
          },
          { durationSeconds: 45, beats: [{ id: 'accroche', onScreen: 'Durée absente', voiceOver: 'Durée absente' }] },
        ],
      };
    }
    send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((resolve) => fakeGemini.listen(0, '127.0.0.1', resolve));
  app = await createTestApp({ GEMINI_API_URL: `http://127.0.0.1:${(fakeGemini.address() as AddressInfo).port}` });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => fakeGemini.close(() => resolve()));
});

const PRODUCT = {
  title: 'Guide du poulailler urbain',
  subtitle: 'De 10 à 50 poules',
  typeName: 'Ebook',
  targetAudience: 'Citadins',
  transformationPromise: 'Installer un poulailler propre',
  modules: [
    { title: 'Emplacement', details: 'Ombre, sécurité' },
    { title: 'Budget', details: '' },
    { title: 'Alimentation', details: 'Deux repas par jour' },
  ],
};

const balance = async (agent: Awaited<ReturnType<typeof signInWithPlan>>['agent']) =>
  (await agent.get('/api/account/credits').expect(200)).body.credits.total as number;

describe('Rédaction par l’IA', () => {
  it('rédige les modules d’un produit et signale tout de suite une promesse de gain', async () => {
    const { agent } = await signInWithPlan(app, 'autrice@exemple.com', 'pro');
    const start = await balance(agent);

    const response = await agent.post('/api/writing/product').send({ product: PRODUCT, market: 'SN' }).expect(200);
    const result = response.body as { modules: { title: string; details: string }[]; missing: number; findings: { label: string; severity: string }[] };

    assert.equal(result.modules.length, 3, 'le module inventé est ignoré');
    assert.match(result.modules[0]!.details, /^Choisir un emplacement ombragé\.\n\n- Mesurer/);
    assert.equal(result.modules[2]!.details, 'Deux repas par jour', 'module non rédigé : texte d’origine gardé');
    assert.equal(result.missing, 1);
    assert.ok(result.findings.some((finding) => finding.severity === 'block' && finding.label.startsWith('Module 2')));

    const prompt = prompts.at(-1)!;
    assert.match(prompt, /N’invente aucun chiffre/);
    assert.match(prompt, /Marché : Sénégal/);
    assert.equal(start - (await balance(agent)), 4);
  });

  it('rédige le kit de lancement sans garder de temps ni de durée hors de la table', async () => {
    const { agent } = await signInWithPlan(app, 'lanceur@exemple.com', 'pro');
    const start = await balance(agent);
    const { getLaunchKitConfig } = await import('@server/services/launchKit');
    const format = (await getLaunchKitConfig()).scriptFormats[0]!;

    const response = await agent
      .post('/api/writing/launch-kit')
      .send({ product: { ...PRODUCT, modules: PRODUCT.modules.map((module) => module.title) }, objective: 'leads' })
      .expect(200);
    const result = response.body as { copies: unknown[]; scripts: Record<string, Record<string, unknown>>; findings: unknown[] };

    assert.equal(result.copies.length, 3);
    assert.deepEqual(Object.keys(result.scripts), [String(format.durationSeconds)], 'durée absente de la table écartée');
    assert.deepEqual(Object.keys(result.scripts[String(format.durationSeconds)]!).sort(), format.beats.map((beat) => beat.id).sort());
    assert.match(prompts.at(-1)!, /obtenir des prospects/);
    assert.equal(start - (await balance(agent)), 3);
  });

  it('rend les points quand la rédaction échoue', async () => {
    const { agent } = await signInWithPlan(app, 'malchanceuse@exemple.com', 'pro');
    const start = await balance(agent);
    const failed = await agent.post('/api/writing/product').send({ product: { ...PRODUCT, title: 'Panne' } }).expect(502);
    assert.equal(failed.body.error.code, 'WRITING_FAILED');
    assert.equal(await balance(agent), start);

    await agent.post('/api/writing/product').send({ product: { ...PRODUCT, modules: [] } }).expect(400);
  });

  it('réessaie quand Google est saturé, puis passe au modèle de secours', async () => {
    const { agent } = await signInWithPlan(app, 'patiente@exemple.com', 'pro');
    const start = await balance(agent);

    models.length = 0;
    const rescued = await agent.post('/api/writing/product').send({ product: { ...PRODUCT, title: 'Saturé' } }).expect(200);
    assert.equal(rescued.body.modules.length, PRODUCT.modules.length);
    assert.deepEqual(models, ['gemini-3.5-flash', 'gemini-3.5-flash', 'gemini-3.6-flash']);
    assert.ok(start > (await balance(agent)), 'rédaction facturée une fois');

    models.length = 0;
    const before = await balance(agent);
    const overloaded = await agent.post('/api/writing/product').send({ product: { ...PRODUCT, title: 'Saturé partout' } }).expect(503);
    assert.equal(overloaded.body.error.code, 'WRITING_OVERLOADED');
    assert.match(overloaded.body.error.message, /surchargé/);
    assert.equal(models.length, 4, 'deux tentatives par modèle, pas davantage');
    assert.equal(await balance(agent), before, 'points rendus');
  });
});
