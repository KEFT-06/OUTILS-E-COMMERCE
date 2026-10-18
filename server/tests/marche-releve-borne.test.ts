import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createAdmin, createTestApp } from './support/helpers';

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
const SECRET = 'secret-de-veille-de-test';
/** Demandes reçues par la plateforme qui refuse : ce qu'on lui a fait subir. */
let refusRecus = 0;

const fausseVitrine = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://vitrine.test');
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  // La plateforme qui refuse le serveur : une protection placée devant elle répond à sa place.
  if (url.pathname.startsWith('/storefront/store_refus')) {
    refusRecus += 1;
    res.writeHead(403, { 'content-type': 'text/html', server: 'cloudflare', 'cf-mitigated': 'challenge' });
    return res.end('<html>Attention Required</html>');
  }
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
  app = await createTestApp({ CHARIOW_STOREFRONT_URL: `http://127.0.0.1:${(fausseVitrine.address() as AddressInfo).port}`, CRON_SECRET: SECRET });
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
    assert.deepEqual(Object.values(bilan.reasons), [1]);
    assert.match(Object.keys(bilan.reasons)[0] ?? '', /relevé trop long/, 'le motif de l’échec est gardé, sans le nom de la boutique');

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

describe('Relevé du marché — quand la plateforme refuse, le passage s’arrête au lieu d’insister', () => {
  it('cinq refus à la suite : le passage s’arrête, dit pourquoi, et laisse les autres boutiques pour plus tard', async () => {
    const { indexDiscoveredStores } = await import('@server/services/market');
    const { getDb } = await import('@server/db/client');
    const { discoveredStores } = await import('@server/db/schema');
    const bientot = new Date(Date.now() + 60_000);
    // Huit boutiques jamais relevées, en tête de file : la plateforme les refuse toutes.
    await getDb()
      .insert(discoveredStores)
      .values(Array.from({ length: 8 }, (_, rang) => ({ host: `refus-${rang}.mychariow.com`, storeExternalId: `store_refus${rang}xyz`, lastSeenAt: bientot, indexedAt: null })));

    refusRecus = 0;
    const bilan = await indexDiscoveredStores(30_000, new Date(), { storeMinMs: 1_000 });
    assert.equal(bilan.halted, true, 'le passage s’est arrêté de lui-même');
    assert.deepEqual([bilan.indexed, bilan.failed], [0, 5]);
    assert.ok(bilan.remaining >= 3, `les autres attendent le passage suivant (${bilan.remaining})`);
    assert.equal(refusRecus, 5, 'cinq demandes, pas une de plus : on n’insiste pas sur une plateforme qui refuse');
    // La cause telle que l'administration la lira : le statut, et qui a répondu.
    assert.deepEqual(bilan.reasons, { 'vitrine sans réponse : réponse 403 (cloudflare, protection)': 5 });
  });

  it('le passage de veille continue : refusé sans le secret, et un compte rendu chiffré avec', async () => {
    const { default: request } = await import('supertest');
    await request(app).get('/api/cron/veille').expect(401);
    await request(app).get('/api/cron/veille').set('Authorization', 'Bearer mauvais-secret').expect(401);

    const passage = await request(app).get('/api/cron/veille').set('Authorization', `Bearer ${SECRET}`).expect(200);
    const corps = passage.body as {
      surveillances: { due: number; swept: number } | null;
      releves: { indexed: number; failed: number; remaining: number; reasons: Record<string, number> } | null;
      alertes: number | null;
      etat: { boutiques: number; boutiquesReleveesAujourdhui: number; dernierReleveDeVentes: string | null; annonces: number; alertesAuFil: number } | null;
    };
    // Les trois boutiques refusées restantes, puis celle qui attendait depuis le test précédent : relevée.
    assert.deepEqual([corps.releves?.indexed, corps.releves?.failed, corps.releves?.remaining], [1, 3, 0]);
    assert.equal(corps.surveillances?.due, 0);
    assert.equal(corps.alertes, 0);
    assert.equal(corps.etat?.boutiquesReleveesAujourdhui, 1);
    assert.equal(corps.etat?.dernierReleveDeVentes, new Date().toISOString().slice(0, 10));
    // Un compte rendu chiffré : ni nom de boutique, ni adresse.
    assert.doesNotMatch(JSON.stringify(corps), /mychariow|saine|refus-\d/);
  });
});

describe('Relevé du marché — chaque passage laisse son compte rendu', () => {
  it('l’état des services dit ce que le dernier passage a lu, ce qui a échoué et pourquoi', async () => {
    const { reportMarketRun } = await import('@server/services/market');
    await reportMarketRun('réveil de la nuit', { indexed: 12, failed: 30, launched: 0, remaining: 171, reasons: { 'relevé trop long (plus de 45 s)': 27, 'La vitrine de cette boutique est injoignable.': 3 } }, 0);

    const { agent } = await createAdmin(app, 'admin-marche@smartcreator.test');
    const services = ((await agent.get('/api/admin/services').expect(200)).body as { services: { id: string; state: string; detail: string; action: string | null }[] }).services;
    const releve = services.find((service) => service.id === 'market-reading')!;
    assert.match(releve.detail, /Dernier passage \(réveil de la nuit, .* TU\) : 12 relevées, 30 en échec, 171 en attente\./);
    assert.match(releve.detail, /Échec le plus fréquent : « relevé trop long \(plus de 45 s\) » \(27\)\./);
    assert.match(releve.detail, /dernier relevé aujourd’hui : 1 boutique lue/, 'et ce qui a réellement été relevé, compté sur les relevés eux-mêmes');
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
