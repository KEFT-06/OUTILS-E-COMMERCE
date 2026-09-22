import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Rendu vidéo par fal.ai, contre un faux fal : dépôt en file, suivi, puis relais du fichier.
 *
 * Ce que ces tests verrouillent tient à des écarts mesurés sur la vraie API, qu'aucune
 * documentation ne met en avant : l'en-tête d'authentification n'est pas « Bearer », la durée
 * voyage en texte et non en nombre, et l'identifiant du modèle fait partie de l'adresse de
 * suivi — un identifiant de demande seul ne retrouve rien.
 */

const MODELE = 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video';
const SUIVI = new RegExp(`^/${MODELE}/requests/(req-video-\\d{4})(/status)?$`);

interface Depot {
  chemin: string;
  autorisation: string | undefined;
  corps: Record<string, unknown>;
}

const depots: Depot[] = [];
/** Pilote le faux fal depuis un test : « credit » le fait répondre comme un compte à sec. */
let mode: 'file' | 'termine' | 'credit' = 'file';
/** Un identifiant par dépôt : la base refuse deux générations de même référence. */
let compteur = 0;

const MP4 = Buffer.from('00000018667479706d703432', 'hex');

const fauxFal = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://fal.test');
    const envoyer = (code: number, corps: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corps));
    };

    if (url.pathname === '/media/video.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(MP4.length) });
      res.end(MP4);
      return;
    }

    // Dépôt d'une demande : POST /{modèle}
    if (req.method === 'POST' && url.pathname === `/${MODELE}`) {
      depots.push({
        chemin: url.pathname,
        autorisation: req.headers.authorization,
        corps: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      });
      if (mode === 'credit') {
        envoyer(402, { detail: 'Insufficient balance' });
        return;
      }
      compteur += 1;
      envoyer(200, { status: 'IN_QUEUE', request_id: `req-video-${String(compteur).padStart(4, '0')}`, queue_position: 2 });
      return;
    }

    const suivi = SUIVI.exec(url.pathname);
    if (req.method === 'GET' && suivi) {
      // Avec « /status » : l'état. Sans : le résultat, que le serveur ne lit qu'une fois terminé.
      if (suivi[2]) {
        envoyer(200, { status: mode === 'termine' ? 'COMPLETED' : 'IN_PROGRESS', request_id: suivi[1] });
        return;
      }
      const base = `http://127.0.0.1:${(fauxFal.address() as AddressInfo).port}`;
      envoyer(200, { video: { url: `${base}/media/video.mp4` } });
      return;
    }

    envoyer(404, { detail: 'Not Found' });
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((r) => fauxFal.listen(0, '127.0.0.1', r));
  app = await createTestApp({
    FAL_KEY: 'cle-fal-de-test',
    FAL_API_URL: `http://127.0.0.1:${(fauxFal.address() as AddressInfo).port}`,
    FAL_VIDEO_MODEL: MODELE,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => fauxFal.close(() => r()));
});

const BRIEF = {
  productName: 'Poulailler de balcon',
  awarenessLevel: 'problem_aware',
  format: '9:16',
  market: 'CM',
  sceneDescription: 'Une famille installe un petit poulailler sur son balcon, au lever du jour.',
  purpose: 'content',
  duration: 5,
};

describe('Rendu vidéo par fal.ai', () => {
  it('dépose la demande avec la bonne clé, le bon modèle et une durée en texte', async () => {
    mode = 'file';
    const { agent } = await signInWithPlan(app, 'video-fal@exemple.test', 'pro');
    const reponse = await agent.post('/api/creatives/videos').send(BRIEF).expect(202);

    assert.equal(reponse.body.status, 'queued', 'IN_QUEUE devient « queued » pour le client');
    assert.match(reponse.body.requestId, /^req-video-\d{4}$/);

    const depot = depots.at(-1)!;
    assert.equal(depot.chemin, `/${MODELE}`, 'le modèle fait partie du chemin');
    // « Key », et non « Bearer » : un Bearer rend un 401 sans explication.
    assert.equal(depot.autorisation, 'Key cle-fal-de-test');
    // Le schéma de Kling n'accepte la durée qu'en texte ; le nombre est refusé par un 422 muet.
    assert.equal(depot.corps.duration, '5');
    assert.equal(depot.corps.aspect_ratio, '9:16');
    assert.match(String(depot.corps.negative_prompt), /watermark/);
  });

  it('suit la génération puis relaie le fichier à son seul auteur', async () => {
    mode = 'file';
    const { agent } = await signInWithPlan(app, 'video-suivi@exemple.test', 'pro');
    const { body: lance } = await agent.post('/api/creatives/videos').send(BRIEF).expect(202);
    const id = lance.requestId as string;

    const enCours = await agent.get(`/api/creatives/requests/${id}`).expect(200);
    assert.equal(enCours.body.status, 'in_progress');

    mode = 'termine';
    const fini = await agent.get(`/api/creatives/requests/${id}`).expect(200);
    assert.equal(fini.body.status, 'completed');
    assert.equal(fini.body.mediaType, 'video');

    const fichier = await agent.get(`/api/creatives/requests/${id}/file`).buffer(true).expect(200);
    assert.equal(fichier.headers['content-type'], 'video/mp4');

    // Le créatif d'autrui n'existe pas : ni son état, ni son fichier.
    const { agent: autre } = await signInWithPlan(app, 'video-intrus@exemple.test', 'pro');
    await autre.get(`/api/creatives/requests/${id}`).expect(404);
    await autre.get(`/api/creatives/requests/${id}/file`).expect(404);
  });

  it('dit clairement que le crédit fal.ai est épuisé, et rend les points', async () => {
    mode = 'credit';
    const { agent } = await signInWithPlan(app, 'video-sans-credit@exemple.test', 'pro');
    const avant = (await agent.get('/api/auth/me').expect(200)).body.account.credits.total as number;

    const refus = await agent.post('/api/creatives/videos').send(BRIEF).expect(503);
    assert.equal(refus.body.error.code, 'FAL_OUT_OF_CREDIT');
    assert.match(refus.body.error.message, /recharger/, 'le message dit à l’administrateur quoi faire');

    const apres = (await agent.get('/api/auth/me').expect(200)).body.account.credits.total as number;
    assert.equal(apres, avant, 'un rendu refusé ne coûte aucun point');
  });
});
