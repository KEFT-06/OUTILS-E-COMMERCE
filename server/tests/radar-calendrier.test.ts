import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Calendrier du radar, et son déclencheur périodique.
 *
 * Ces tests manquaient, et ce sont les plus importants du module : c'est ce calendrier qui tient
 * les deux promesses du radar.
 *
 *  · « il ne dort pas » — une surveillance jamais relevée, ou relevée hier, doit l'être ;
 *  · « une visite par jour » — une surveillance relevée il y a une heure ne doit PAS l'être.
 *    Sans cette moitié, un serveur redémarré dix fois dans la journée frapperait dix fois le
 *    site d'un tiers. C'est une question de politesse autant que de justesse.
 *
 * Et le déclencheur : en hébergement sans serveur, rien ne tourne entre deux requêtes. Sans
 * cette adresse, tout le module serait inerte en production — avec un écran qui affiche
 * « premier relevé en attente » pour toujours.
 */

const BOUTIQUE = 'store_calendrier';
const PAGE = `<html><head><title>BOUTIQUE CAL</title></head><body>${BOUTIQUE}</body></html>`;

let relevés = 0;

const fausseVitrine = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://vitrine.test');
  if (url.pathname === `/storefront/${BOUTIQUE}/products`) {
    relevés += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        data: [
          {
            id: 'prd_cal',
            name: 'Produit témoin',
            type: 'downloadable',
            status: 'published',
            pricing: { effective: { value: 5_000, currency: 'XAF' } },
            sales_count: { value: 3 },
            store: { name: 'BOUTIQUE CAL' },
          },
        ],
        pagination: { next_page_url: null },
      }),
    );
    return;
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ detail: 'Not Found' }));
});

const SECRET = 'secret-de-planificateur-de-test';

let app: Express;
let base = '';

before(async () => {
  await new Promise<void>((r) => fausseVitrine.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(fausseVitrine.address() as AddressInfo).port}`;
  app = await createTestApp({
    CHARIOW_STOREFRONT_URL: base,
    RADAR_SWEEP_INTERVAL_HOURS: '24',
    CRON_SECRET: SECRET,
    APIFY_TOKEN: '',
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => fausseVitrine.close(() => r()));
});

/** Recule la date du dernier relevé d'une surveillance, pour simuler le temps qui passe. */
async function vieillirDernierRelevé(watchId: string, heures: number): Promise<void> {
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('@server/db/client');
  const { watches } = await import('@server/db/schema');
  await getDb()
    .update(watches)
    .set({ lastSweptAt: new Date(Date.now() - heures * 3_600_000) })
    .where(eq(watches.id, watchId));
}

describe('Radar — calendrier des relevés', () => {
  it('ne relève pas deux fois le même jour, et relève dès que le délai est passé', async () => {
    const { sweepDueWatches } = await import('@server/services/radar/sweeper');

    const { agent } = await signInWithPlan(app, 'calendrier@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    const watchId = ajout.body.watch.id as string;

    // L'ajout vient de relever : rien n'est dû dans l'heure qui suit.
    await vieillirDernierRelevé(watchId, 1);
    const avantDelai = await sweepDueWatches();
    assert.equal(avantDelai.due, 0, 'une surveillance relevée il y a une heure n’est pas due');

    // Passé le délai, elle l'est.
    await vieillirDernierRelevé(watchId, 25);
    const avant = relevés;
    const apresDelai = await sweepDueWatches();
    assert.equal(apresDelai.due, 1);
    assert.equal(apresDelai.swept, 1);
    assert.equal(relevés, avant + 1, 'la vitrine du tiers est visitée exactement une fois');

    // Et juste après, plus rien : c'est la date du dernier passage qui décide, pas l'appel.
    const immediatement = await sweepDueWatches();
    assert.equal(immediatement.due, 0, 'deux appels rapprochés ne font pas deux visites');
  });

  it('ignore une surveillance mise en pause', async () => {
    const { sweepDueWatches } = await import('@server/services/radar/sweeper');
    const { eq } = await import('drizzle-orm');
    const { getDb } = await import('@server/db/client');
    const { watches } = await import('@server/db/schema');

    const { agent } = await signInWithPlan(app, 'calendrier-pause@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    const watchId = ajout.body.watch.id as string;

    await getDb().update(watches).set({ active: false }).where(eq(watches.id, watchId));
    await vieillirDernierRelevé(watchId, 48);

    const avant = relevés;
    await sweepDueWatches();
    assert.equal(relevés, avant, 'une surveillance en pause ne visite plus le site du tiers');
  });
});

describe('Radar — déclencheur périodique', () => {
  it('refuse sans secret, avec un mauvais secret, et travaille avec le bon', async () => {
    const { default: request } = await import('supertest');

    // Sans en-tête : refusé. Cette adresse modifie l'état et dépense de l'argent de collecte —
    // elle ne doit jamais être atteignable par un navigateur de passage.
    await request(app).get('/api/cron/radar').expect(401);
    await request(app).get('/api/cron/radar').set('Authorization', 'Bearer mauvais-secret-de-la-bonne-taille').expect(401);

    const { agent } = await signInWithPlan(app, 'cron@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    await vieillirDernierRelevé(ajout.body.watch.id as string, 30);

    const avant = relevés;
    const reponse = await request(app).get('/api/cron/radar').set('Authorization', `Bearer ${SECRET}`).expect(200);
    assert.equal(reponse.body.sweep.swept, 1, 'le déclencheur relève bien ce qui est dû');
    assert.equal(relevés, avant + 1);
    // Sans jeton de collecte, la découverte est absente sans faire échouer l'appel.
    assert.equal(reponse.body.discovery, null);

    // Rappelé tout de suite, il ne refait rien : le planificateur peut être trop zélé sans dégât.
    const second = await request(app).get('/api/cron/radar').set('Authorization', `Bearer ${SECRET}`).expect(200);
    assert.equal(second.body.sweep.due, 0);
    assert.equal(relevés, avant + 1);
  });
});
