import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { closeTestApp, createTestApp, signUp } from './support/helpers';

/**
 * Correctifs de l'audit de sécurité : routes coûteuses réservées aux comptes, réponses
 * jamais gardées en cache, corps encodés en formulaire ignorés, registre protégé contre
 * les clés héritées, fichiers relayés limités aux types image et vidéo, HTTPS obligatoire.
 */

let app: Express;

before(async () => {
  app = await createTestApp();
});

after(closeTestApp);

describe('Audit de sécurité', () => {
  it('réserve les vérificateurs de conformité et d’originalité aux comptes connectés', async () => {
    const compliance = await request(app).post('/api/compliance/check').send({ text: 'Gagnez 1 000 000 FCFA en une semaine' }).expect(401);
    assert.equal(compliance.body.error.code, 'AUTH_REQUIRED');
    await request(app).post('/api/originality/check').send({ text: 'Un texte à comparer.' }).expect(401);

    const { agent } = await signUp(app, { name: 'Awa Conformité', email: 'awa-conformite@exemple.com' });
    const checked = await agent.post('/api/compliance/check').send({ text: 'Un guide pratique pour tenir sa comptabilité.' });
    assert.notEqual(checked.status, 401, 'un compte connecté passe');
  });

  it('interdit la mise en cache des réponses de l’API', async () => {
    const health = await request(app).get('/api/health').expect(200);
    assert.equal(health.headers['cache-control'], 'no-store');
  });

  it('ignore un corps encodé en formulaire, que seul un envoi intersite produirait', async () => {
    const response = await request(app)
      .post('/api/contact')
      .type('form')
      .send({ name: 'Robot', email: 'robot@exemple.com', topic: 'question', message: 'Message envoyé par un formulaire piégé.' })
      .expect(400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  });

  it('ne confond pas une propriété héritée avec une marketplace', async () => {
    const { agent } = await signUp(app, { name: 'Koffi Registre', email: 'koffi-registre@exemple.com' });
    for (const id of ['__proto__', 'constructor', 'toString']) {
      const response = await agent.get(`/api/marketplaces/${id}/products`).expect(404);
      assert.equal(response.body.error.code, 'MARKETPLACE_UNKNOWN', id);
    }
  });

  it('ne relaie un fichier généré que sous un type image ou vidéo attendu', async () => {
    const { servedMediaType } = await import('@server/services/creatives');
    assert.equal(servedMediaType('image/webp', 'image'), 'image/webp');
    assert.equal(servedMediaType('video/webm; codecs=vp9', 'video'), 'video/webm');
    assert.equal(servedMediaType('text/html; charset=utf-8', 'image'), 'image/png');
    assert.equal(servedMediaType('image/svg+xml', 'image'), 'image/png');
    assert.equal(servedMediaType('application/javascript', 'video'), 'video/mp4');
    assert.equal(servedMediaType(null, 'video'), 'video/mp4');
  });

  it('redirige HTTP vers HTTPS sur l’adresse publique, jamais vers l’hôte annoncé par le visiteur', async () => {
    const { default: express } = await import('express');
    const { httpsRedirect } = await import('@server/middleware');
    const site = express();
    site.set('trust proxy', 1);
    site.use(httpsRedirect('https://smart-creator.example'));
    site.all('*', (_req, res) => {
      res.status(200).send('servi');
    });

    const redirected = await request(site)
      .post('/api/contact?sujet=aide')
      .set('X-Forwarded-Proto', 'http')
      .set('Host', 'site-piege.example')
      .expect(308);
    assert.equal(redirected.headers.location, 'https://smart-creator.example/api/contact?sujet=aide');

    await request(site).get('/conditions').set('X-Forwarded-Proto', 'https').expect(200);
    await request(site).get('/api/health').set('X-Forwarded-Proto', 'http').expect(200);

    const local = express();
    local.use(httpsRedirect('http://localhost:3001'));
    local.all('*', (_req, res) => {
      res.status(200).send('servi');
    });
    await request(local).get('/').expect(200);
  });
});
