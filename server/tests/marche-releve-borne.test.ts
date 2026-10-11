import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Le relevé de nuit tient dans son temps, et le fil des alertes dit ce qui est sous veille.
 *
 * Question du propriétaire, 11/10/2026 : « dans les alertes on mentionne aucune alerte pour
 * l'instant, est-ce que c'est vrai ? ». Constat en production : zéro alerte en effet — mais 36
 * boutiques sur 40 n'avaient pas été relues depuis cinq jours. Le relevé ne regardait l'heure
 * qu'entre deux boutiques : une vitrine lente lui faisait dépasser le temps de la requête, et ni
 * les alertes ni la suite du relevé, placées après lui, n'étaient atteintes.
 */

const LENTE = 'store_vitrinelente';
const SAINE = 'store_vitrinesaine';
const prises = new Set<Socket>();

const fausseVitrine = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://vitrine.test');
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  // La vitrine lente accepte la demande et ne répond jamais.
  if (url.pathname.startsWith(`/storefront/${LENTE}/`)) return;
  if (url.pathname === `/storefront/${SAINE}/products`) {
    return json(200, {
      data: [{ id: 'prd_sain1', name: 'Guide du potager en ville', slug: 'guide-potager', type: 'downloadable', status: 'published', pricing: { type: 'one_time', current_price: { value: 5_000, currency: 'XAF' } } }],
      pagination: { next_page_url: null, has_more_pages: false },
    });
  }
  if (url.pathname === `/storefront/${SAINE}/products/prd_sain1`) {
    return json(200, { data: { id: 'prd_sain1', name: 'Guide du potager en ville', sales_count: { value: 42, formatted: '42' }, category: { value: 'home_and_garden', label: 'Home' } } });
  }
  json(404, { detail: 'Not Found' });
});
fausseVitrine.on('connection', (socket) => {
  prises.add(socket);
  socket.on('close', () => prises.delete(socket));
});

let app: Express;

before(async () => {
  await new Promise<void>((resolve) => fausseVitrine.listen(0, '127.0.0.1', resolve));
  app = await createTestApp({ CHARIOW_STOREFRONT_URL: `http://127.0.0.1:${(fausseVitrine.address() as AddressInfo).port}` });
});

after(async () => {
  await closeTestApp();
  for (const socket of prises) socket.destroy();
  await new Promise<void>((resolve) => fausseVitrine.close(() => resolve()));
});

describe('Relevé du marché — une vitrine lente n’emporte pas les autres', () => {
  it('compte la boutique lente en échec à son délai, relève la suivante, et rend la main dans son temps', async () => {
    const { indexDiscoveredStores } = await import('@server/services/market');
    const { alertWatch } = await import('@server/services/alerts');
    const { getDb } = await import('@server/db/client');
    const { discoveredStores, marketProducts } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const now = new Date();
    await getDb().insert(discoveredStores).values([
      // La lente passe en premier : jamais relevée.
      { host: 'lente.mychariow.com', storeExternalId: LENTE, lastSeenAt: now, indexedAt: null },
      { host: 'saine.mychariow.com', storeExternalId: SAINE, lastSeenAt: now, indexedAt: new Date(now.getTime() - 30 * 3_600_000) },
    ]);

    const depart = Date.now();
    const bilan = await indexDiscoveredStores(20_000, now, { storeCapMs: 400, storeMinMs: 1_000 });
    assert.deepEqual({ relevees: bilan.indexed, echecs: bilan.failed, attente: bilan.remaining }, { relevees: 1, echecs: 1, attente: 0 });
    assert.ok(Date.now() - depart < 8_000, `le relevé rend la main (${Date.now() - depart} ms) au lieu d’attendre la vitrine lente`);

    const [produit] = await getDb().select().from(marketProducts).where(eq(marketProducts.storeHost, 'saine.mychariow.com'));
    assert.equal(produit?.salesCount, 42, 'la boutique suivante est bien relevée, ventes comprises');

    // Ce que le fil des alertes en sait : une boutique relevée aujourd'hui.
    const veille = await alertWatch(now);
    assert.equal(veille.stores, 1);
    assert.deepEqual(veille.readings, [{ day: now.toISOString().slice(0, 10), stores: 1 }]);
  });

  it('n’entame pas une boutique de plus quand le temps manque : elle attend le maillon suivant, sans être marquée relevée', async () => {
    const { indexDiscoveredStores } = await import('@server/services/market');
    const { getDb } = await import('@server/db/client');
    const { discoveredStores } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    await getDb().insert(discoveredStores).values({ host: 'attente.mychariow.com', storeExternalId: SAINE, lastSeenAt: new Date(), indexedAt: null });

    const bilan = await indexDiscoveredStores(500, new Date(), { storeMinMs: 1_000 });
    assert.equal(bilan.indexed + bilan.failed, 0, 'aucune boutique entamée');
    assert.ok(bilan.remaining >= 1, 'elle reste due');
    const [store] = await getDb().select().from(discoveredStores).where(eq(discoveredStores.host, 'attente.mychariow.com'));
    assert.equal(store?.indexedAt, null);
  });
});

describe('Alertes — le fil dit ce qui est sous veille', () => {
  it('rend, avec les alertes, les boutiques sous veille et les jours où elles ont été relevées', async () => {
    const { agent } = await signInWithPlan(app, 'veille@exemple.test', 'pro');
    const fil = (await agent.get('/api/alerts').expect(200)).body as { alerts: unknown[]; watch: { stores: number; readings: { day: string; stores: number }[] } };
    assert.deepEqual(fil.alerts, []);
    assert.equal(fil.watch.stores, 1);
    assert.equal(fil.watch.readings[0]?.day, new Date().toISOString().slice(0, 10));
  });

  it('l’écran ne confond pas « rien ne bouge » et « rien n’a été relevé »', async () => {
    const { etatDeLaVeille } = await import('../../src/modules/alertes/veille');
    const midi = Date.parse('2026-10-11T12:00:00Z');
    assert.match(etatDeLaVeille({ stores: 213, readings: [{ day: '2026-10-11', stores: 198 }] }, midi), /^213 boutiques sous veille, dont 198 relevées aujourd’hui\./);
    assert.match(etatDeLaVeille({ stores: 213, readings: [{ day: '2026-10-10', stores: 190 }] }, midi), /dont 190 relevées hier\./);
    // Relevé arrêté depuis cinq jours : l'écran le dit, au lieu de laisser croire que rien ne bouge.
    const arrete = etatDeLaVeille({ stores: 213, readings: [{ day: '2026-10-06', stores: 200 }] }, midi);
    assert.match(arrete, /leur dernier relevé date du 6 octobre/);
    assert.doesNotMatch(arrete, /dès qu’un produit décolle/);
    // Index encore vide, ou état inconnu : la phrase d'attente, sans chiffre inventé.
    assert.equal(etatDeLaVeille(null, midi), 'Les alertes arrivent ici dès qu’un produit décolle ou qu’un concurrent bouge.');
    assert.match(etatDeLaVeille({ stores: 12, readings: [] }, midi), /^12 boutiques sous veille\. Leurs ventes se comparent d’un jour sur l’autre/);
  });
});
