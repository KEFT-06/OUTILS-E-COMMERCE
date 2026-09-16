import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Mode Vidéo → Produit contre un faux Gemini : lien YouTube et fichier audio. Vérifie
 * ce qui part au fournisseur, le produit rendu, la facturation et les refus.
 */

type Part = { text?: string; inlineData?: { mimeType: string; data: string }; fileData?: { fileUri: string } };
const requests: Part[][] = [];

const fakeGemini = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { contents: { parts: Part[] }[] };
    requests.push(body.contents[0]!.parts);
    const product = {
      title: 'Élever des poules en ville',
      subtitle: 'Ce que montre la vidéo, pas à pas',
      type: 'masterclass',
      targetAudience: 'Citadins qui débutent',
      transformationPromise: 'Installer un petit poulailler propre',
      summary: 'La vidéo présente l’installation d’un poulailler de balcon.',
      modules: [
        { title: 'Le matériel', details: 'Grillage, abreuvoir, mangeoire.' },
        { title: 'L’emplacement', details: 'À l’ombre, à l’abri du vent. [à compléter : règles de la copropriété]' },
      ],
      leadMagnet: { title: 'Liste du matériel', format: 'PDF', hook: 'Tout ce qu’il faut avant de commencer' },
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(product) }] } }] }));
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

const balance = async (agent: Awaited<ReturnType<typeof signInWithPlan>>['agent']) =>
  (await agent.get('/api/account/credits').expect(200)).body.credits.total as number;

interface VideoResult {
  product: { id: string; origin: { kind: string; label: string; url?: string }; recommendedPrice: number | null; tableOfContents: { moduleNumber: number }[] };
  findings: unknown[];
}

describe('Vidéo → Produit', () => {
  it('transforme une vidéo YouTube en produit, avec la vidéo citée comme source', async () => {
    const { agent } = await signInWithPlan(app, 'videaste@exemple.com', 'pro');
    const start = await balance(agent);

    const response = await agent.post('/api/writing/video-link').send({ url: 'https://youtu.be/dQw4w9WgXcQ?si=partage' }).expect(200);
    const { product } = response.body as VideoResult;

    const parts = requests.at(-1)!;
    assert.deepEqual(parts[0], { fileData: { fileUri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }, 'adresse canonique, vidéo avant la consigne');
    assert.match(parts[1]!.text!, /N’utilise que ce que dit ou montre la vidéo/);

    assert.ok(product.id.startsWith('video-'));
    assert.deepEqual(product.origin, { kind: 'video', label: 'Vidéo YouTube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    assert.equal(product.recommendedPrice, null, 'aucun prix inventé');
    assert.deepEqual(product.tableOfContents.map((module) => module.moduleNumber), [1, 2]);
    assert.equal(start - (await balance(agent)), 6);

    const refused = await agent.post('/api/writing/video-link').send({ url: 'https://vimeo.com/123456' }).expect(400);
    assert.equal(refused.body.error.code, 'VIDEO_LINK_INVALID');
    await agent.post('/api/writing/video-link').send({ url: 'http://www.youtube.com/watch?v=dQw4w9WgXcQ' }).expect(400);
    assert.equal(start - (await balance(agent)), 6, 'un lien refusé ne coûte rien');
  });

  it('transforme un fichier audio envoyé tel quel, et refuse les autres types et les fichiers trop lourds', async () => {
    const { agent } = await signInWithPlan(app, 'podcasteuse@exemple.com', 'pro');
    const audio = Buffer.from('ID3 enregistrement de test');

    const response = await agent
      .post('/api/writing/video-file')
      .set('Content-Type', 'audio/mpeg')
      .set('X-File-Name', encodeURIComponent('cours élevage.mp3'))
      .send(audio)
      .expect(200);
    const { product } = response.body as VideoResult;

    assert.deepEqual(requests.at(-1)![0], { inlineData: { mimeType: 'audio/mpeg', data: audio.toString('base64') } });
    assert.deepEqual(product.origin, { kind: 'video', label: 'cours élevage.mp3' });

    const unsupported = await agent.post('/api/writing/video-file').set('Content-Type', 'application/pdf').send(Buffer.from('%PDF')).expect(415);
    assert.equal(unsupported.body.error.code, 'VIDEO_TYPE_UNSUPPORTED');

    const tooLarge = await agent
      .post('/api/writing/video-file')
      .set('Content-Type', 'video/mp4')
      .send(Buffer.alloc(14 * 1024 * 1024 + 1))
      .expect(413);
    assert.equal(tooLarge.body.error.code, 'PAYLOAD_TOO_LARGE');

    await request(app).post('/api/writing/video-file').set('Content-Type', 'audio/mpeg').send(audio).expect(401);
  });
});
