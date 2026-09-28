import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Copie des vidéos Veo dans le stockage de Supabase, contre un faux Google et un faux
 * Supabase : aucun vrai service n'est appelé.
 *
 * Google n'en garde une que deux jours. Ce que ces tests verrouillent : la copie part dès la
 * fin du rendu, dans un espace PRIVÉ créé au premier dépôt, avec la clé en en-tête ; elle est
 * servie ensuite même quand Google a effacé l'original ; et un dépôt manqué est rattrapé par
 * le balayage de nuit.
 */

const MODELE = 'veo-3.1-fast-generate-preview';
const MP4 = Buffer.from('00000018667479706d7034320000000069736f6d', 'hex');
const CLE = 'sb_secret_cle_de_test_0000000000';

let compteur = 0;
let googleEfface = false;
let stockagePanne = false;
let espaceCree: Record<string, unknown> | null = null;
const objets = new Map<string, Buffer>();
const clesRecues: (string | undefined)[] = [];

const faux = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://faux.test');
    const envoyer = (code: number, corps: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corps));
    };

    // ——— Faux Google ———
    if (url.pathname === '/v1beta/files/video:download') {
      if (googleEfface) return envoyer(404, { error: { message: 'Not Found' } });
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(MP4.length) });
      res.end(MP4);
      return;
    }
    if (req.method === 'POST' && url.pathname === `/v1beta/models/${MODELE}:predictLongRunning`) {
      compteur += 1;
      return envoyer(200, { name: `models/${MODELE}/operations/op-${String(compteur).padStart(4, '0')}` });
    }
    const suivi = new RegExp(`^/v1beta/models/${MODELE}/operations/(op-\\d{4})$`).exec(url.pathname);
    if (req.method === 'GET' && suivi) {
      return envoyer(200, {
        name: `models/${MODELE}/operations/${suivi[1]!}`,
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${base}/v1beta/files/video:download` } }] } },
      });
    }

    // ——— Faux Supabase Storage ———
    if (url.pathname.startsWith('/storage/v1/')) {
      clesRecues.push(req.headers.apikey as string | undefined);
      if (req.headers.authorization !== `Bearer ${CLE}`) return envoyer(401, { message: 'Unauthorized' });
      if (req.method === 'POST' && url.pathname === '/storage/v1/bucket') {
        espaceCree = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        return envoyer(200, { name: 'creatifs' });
      }
      const depot = /^\/storage\/v1\/object\/creatifs\/(.+)$/.exec(url.pathname);
      if (req.method === 'POST' && depot) {
        if (stockagePanne) return envoyer(503, { message: 'indisponible' });
        if (!espaceCree) return envoyer(400, { statusCode: '404', error: 'Bucket not found' });
        objets.set(depot[1]!, Buffer.concat(chunks));
        return envoyer(200, { Key: `creatifs/${depot[1]!}` });
      }
      const lecture = /^\/storage\/v1\/object\/authenticated\/creatifs\/(.+)$/.exec(url.pathname);
      if (req.method === 'GET' && lecture) {
        const objet = objets.get(lecture[1]!);
        if (!objet) return envoyer(404, { message: 'Object not found' });
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(objet.length) });
        res.end(objet);
        return;
      }
    }

    envoyer(404, { error: { message: 'Not Found' } });
  });
});

let app: Express;
let base = '';

before(async () => {
  await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(faux.address() as AddressInfo).port}`;
  app = await createTestApp({
    GEMINI_API_KEY: 'cle-google-de-test',
    GEMINI_API_URL: base,
    SUPABASE_API_SECRET_KEY: CLE,
    SUPABASE_URL: base,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => faux.close(() => r()));
});

const BRIEF = {
  productName: 'Formation bureautique',
  awarenessLevel: 'solution_aware',
  format: '9:16',
  market: 'CM',
  sceneDescription: 'une formatrice devant son ordinateur, lumière du matin',
  purpose: 'content',
  duration: 6,
};

/** La copie part après la réponse : on attend qu'elle arrive, sans dormir au hasard. */
async function attendreObjet(requestId: string): Promise<Buffer | undefined> {
  for (let essai = 0; essai < 50 && !objets.has(`veo/${requestId}.mp4`); essai += 1) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return objets.get(`veo/${requestId}.mp4`);
}

describe('Copie des vidéos Veo', () => {
  it('copie la vidéo terminée dans un espace privé, puis la sert même effacée chez Google', async () => {
    googleEfface = false;
    stockagePanne = false;
    const { agent } = await signInWithPlan(app, 'veo-archive@exemple.test', 'pro');
    const lance = await agent.post('/api/creatives/videos').send(BRIEF).expect(202);
    const requestId = lance.body.requestId as string;

    const suivi = await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(suivi.body.status, 'completed');
    assert.equal(suivi.body.retentionDays, null, 'l’écran ne promet plus deux jours seulement');

    assert.deepEqual(await attendreObjet(requestId), MP4, 'la vidéo est copiée à l’identique');
    assert.equal(espaceCree?.public, false, 'l’espace de stockage est privé');
    assert.ok(clesRecues.every((cle) => cle === CLE), 'la clé part en en-tête à chaque appel');

    // Deux jours plus tard : Google a effacé l'original. La copie prend le relais.
    googleEfface = true;
    const fichier = await agent.get(`/api/creatives/requests/${requestId}/file`).buffer(true).expect(200);
    assert.deepEqual(Buffer.from(fichier.body as Buffer), MP4);
    assert.equal(fichier.headers['content-type'], 'video/mp4');
  });

  it('rattrape au balayage de nuit une copie manquée au premier dépôt', async () => {
    googleEfface = false;
    stockagePanne = true;
    const { agent } = await signInWithPlan(app, 'veo-archive-rattrapage@exemple.test', 'pro');
    const lance = await agent.post('/api/creatives/videos').send(BRIEF).expect(202);
    const requestId = lance.body.requestId as string;
    await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    // Laisse le dépôt en arrière-plan échouer.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(objets.has(`veo/${requestId}.mp4`), false);

    stockagePanne = false;
    const { archivePendingVideos } = await import('@server/services/creatives/archive');
    const resultat = await archivePendingVideos();
    assert.ok(resultat.archived >= 1);
    assert.deepEqual(objets.get(`veo/${requestId}.mp4`), MP4);
  });
});
