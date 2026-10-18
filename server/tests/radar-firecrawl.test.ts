import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Vitrines lues par Firecrawl (décision du propriétaire, 18/10/2026) : la plateforme refuse le
 * serveur du site depuis le 11/10. Contre une fausse vitrine et un faux Firecrawl qui la lit et
 * rend la page comme le vrai — le JSON d'une API placé dans un « pre », échappé.
 *
 * Ce qui doit tenir : lecture ordinaire seulement, plafond du jour respecté (les clients avant
 * l'index du marché), un plafond ou un forfait épuisé n'est JAMAIS compté comme une panne de la
 * boutique, et les relevés versés par le collecteur font avancer radar, index et surveillances.
 */

const BOUTIQUE = 'store_vitrinefirecrawl';
const SECRET = 'secret-du-planificateur-de-test';
const PLAFOND = 12;

const catalogue = [
  { id: 'prd_cubes', name: 'Cubes et marinades naturels', slug: 'cubes', prix: 1_100, ventes: 394 },
  { id: 'prd_recettes', name: 'Pack de 400 recettes', slug: 'recettes', prix: 1_500, ventes: 3_564 },
  { id: 'prd_jus', name: 'Recettes de jus', slug: 'jus', prix: 2_000, ventes: 12 },
];

let ventesMasquees = false;

const fausseVitrine = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://vitrine.test');
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === `/storefront/${BOUTIQUE}/products`) {
    return json(200, {
      data: catalogue.map((p) => ({ id: p.id, name: p.name, slug: p.slug, type: 'downloadable', status: 'published', pricing: { current_price: { value: p.prix, currency: 'XAF' } } })),
      pagination: { next_page_url: null, has_more_pages: false },
    });
  }
  const fiche = new RegExp(`^/storefront/${BOUTIQUE}/products/(prd_[a-z0-9]+)$`).exec(url.pathname);
  if (fiche) {
    const produit = catalogue.find((p) => p.id === fiche[1]);
    if (!produit) return json(404, { message: 'Not found' });
    // Une boutique peut masquer ses ventes : la fiche rend alors `sales_count: null`.
    return json(200, { data: { id: produit.id, sales_count: ventesMasquees ? null : { value: produit.ventes }, category: { value: 'cuisine & recettes' } } });
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><title>Cuisine du pays</title></head><body><script>{"store":{"id":"${BOUTIQUE}"}}</script></body></html>`);
    return;
  }
  json(404, { detail: 'Not Found' });
});

/** Demandes reçues par le faux Firecrawl, et la réponse qu'il doit faire. */
const lectures: { url: string; proxy: unknown }[] = [];
let reponseFirecrawl: 'normale' | 'forfait-epuise' = 'normale';

const echapper = (texte: string) => texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fauxFirecrawl = createServer((req, res) => {
  let corps = '';
  req.on('data', (morceau) => (corps += morceau));
  req.on('end', async () => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url !== '/v2/scrape' || req.headers.authorization !== 'Bearer fc-cle-de-test') return json(401, { success: false });
    if (reponseFirecrawl === 'forfait-epuise') return json(402, { success: false, error: 'Insufficient credits' });
    const demande = JSON.parse(corps) as { url: string; proxy?: unknown };
    lectures.push({ url: demande.url, proxy: demande.proxy });
    const page = await fetch(demande.url);
    const texte = await page.text();
    // Comme le vrai : une réponse d'API rendue en page, son JSON dans un « pre ».
    const rawHtml = (page.headers.get('content-type') ?? '').includes('json') ? `<html><head></head><body><pre style="word-wrap: break-word;">${echapper(texte)}</pre></body></html>` : texte;
    json(200, { success: true, data: { rawHtml, metadata: { statusCode: page.status, creditsUsed: 1 } } });
  });
});

let app: Express;
let base = '';

before(async () => {
  await new Promise<void>((r) => fausseVitrine.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => fauxFirecrawl.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(fausseVitrine.address() as AddressInfo).port}`;
  app = await createTestApp({
    CHARIOW_STOREFRONT_URL: base,
    CRON_SECRET: SECRET,
    FIRECRAWL_API_KEY: 'fc-cle-de-test',
    FIRECRAWL_API_URL: `http://127.0.0.1:${(fauxFirecrawl.address() as AddressInfo).port}`,
    RADAR_FIRECRAWL_DAILY_PAGES: String(PLAFOND),
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => fausseVitrine.close(() => r()));
  await new Promise<void>((r) => fauxFirecrawl.close(() => r()));
});

beforeEach(async () => {
  const { getDb } = await import('@server/db/client');
  const { providerDailyUsage } = await import('@server/db/schema');
  await getDb().delete(providerDailyUsage);
  lectures.length = 0;
  reponseFirecrawl = 'normale';
  ventesMasquees = false;
});

/** Pages déjà lues aujourd'hui, comme si d'autres relevés étaient passés avant. */
async function dejaLues(pages: number) {
  const { getDb } = await import('@server/db/client');
  const { providerDailyUsage } = await import('@server/db/schema');
  await getDb().insert(providerDailyUsage).values({ day: new Date().toISOString().slice(0, 10), provider: 'firecrawl', units: pages });
}

async function surveillance(id: string) {
  const { getDb } = await import('@server/db/client');
  const { watches } = await import('@server/db/schema');
  const { eq } = await import('drizzle-orm');
  const [row] = await getDb().select().from(watches).where(eq(watches.id, id));
  return row!;
}

describe('Radar — vitrines lues par Firecrawl', () => {
  it('lit page, catalogue et fiches par Firecrawl, en lecture ordinaire, et compte chaque page', async () => {
    const { agent } = await signInWithPlan(app, 'firecrawl-ajout@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);

    assert.equal(ajout.body.watch.totalSales, 3_970, 'les ventes des trois fiches, lues dans le « pre » rendu par Firecrawl');
    assert.equal(ajout.body.watch.itemsWithSales, 3);
    assert.equal(lectures.length, 5, 'la page de la boutique, son catalogue, trois fiches');
    assert.ok(
      lectures.every((lecture) => lecture.proxy === 'basic'),
      'jamais le mode furtif',
    );
    const { firecrawlPagesToday } = await import('@server/services/radar/sources/firecrawl');
    assert.equal(await firecrawlPagesToday(), 5, 'chaque page lue est comptée au plafond du jour');
  });

  it('ne lit plus les fiches d’une boutique qui masque ses ventes : deux fiches vides suffisent', async () => {
    ventesMasquees = true;
    const { agent } = await signInWithPlan(app, 'firecrawl-masquees@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    assert.equal(ajout.body.watch.itemsWithSales, 0, 'aucune vente inventée : « — », pas zéro');
    assert.equal(lectures.length, 4, 'la page, le catalogue et deux fiches — pas la troisième');
  });

  it('plafond du jour atteint : le relevé attend, sans échec compté ni surveillance mise en pause', async () => {
    const { agent } = await signInWithPlan(app, 'firecrawl-plafond@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    const id = ajout.body.watch.id as string;
    const avant = await surveillance(id);

    const { getDb } = await import('@server/db/client');
    const { providerDailyUsage } = await import('@server/db/schema');
    await getDb().delete(providerDailyUsage);
    await dejaLues(PLAFOND);
    lectures.length = 0;

    // Le relevé de l'ajout, frais, sert la surveillance : ni erreur, ni attente, et rien à repayer.
    const releve = await agent.post(`/api/radar/watches/${id}/sweep`).expect(200);
    assert.equal(releve.body.outcome.pending, undefined);
    assert.equal(lectures.length, 0, 'aucune page demandée au-delà du plafond');

    const apres = await surveillance(id);
    assert.equal(apres.failureCount, 0, 'la boutique n’a pas échoué');
    assert.equal(apres.lastError, null);
    assert.equal(apres.active, true);
    assert.equal(apres.lastSweptAt?.getTime(), avant.lastSweptAt?.getTime(), 'la date du passage ne bouge pas : la surveillance reste due');

    // Relevé vieux de quarante heures : plus rien de frais à servir. Actualiser dit « en attente », sans erreur.
    const { getDb: db } = await import('@server/db/client');
    const { marketProducts, watches } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    await db().update(marketProducts).set({ lastSeenAt: new Date(Date.now() - 40 * 3_600_000) }).where(eq(marketProducts.storeExternalId, BOUTIQUE));
    const attente = await agent.post(`/api/radar/watches/${id}/sweep`).expect(200);
    assert.equal(attente.body.outcome.pending, true);
    assert.equal(lectures.length, 0);

    // Le tour du planificateur s'arrête là, sans compter d'échec.
    await db().update(watches).set({ lastSweptAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(watches.id, id));
    const { sweepDueWatches } = await import('@server/services/radar/sweeper');
    const tour = await sweepDueWatches(new Date(), 10_000);
    assert.equal(tour.budgetReached, true);
    assert.equal(tour.failed, 0);
    assert.equal((await surveillance(id)).failureCount, 0);
  });

  it('forfait Firecrawl épuisé (402) : ni l’index ni les surveillances ne comptent la boutique en échec', async () => {
    const { getDb } = await import('@server/db/client');
    const { discoveredStores } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const host = '127.0.0.1';
    const ancienne = new Date(Date.now() - 5 * 86_400_000);
    await getDb().insert(discoveredStores).values({ host, storeExternalId: BOUTIQUE, label: 'Cuisine du pays', lastSeenAt: new Date(), indexedAt: ancienne }).onConflictDoNothing();
    reponseFirecrawl = 'forfait-epuise';

    const { indexDiscoveredStores } = await import('@server/services/market');
    const bilan = await indexDiscoveredStores(10_000, new Date(), { storeMinMs: 1_000 });
    assert.equal(bilan.budgetReached, true);
    assert.equal(bilan.failed, 0, 'un forfait épuisé n’est pas une boutique en panne');
    assert.deepEqual(bilan.reasons, {});
    const [ligne] = await getDb().select().from(discoveredStores).where(eq(discoveredStores.host, host));
    assert.equal(ligne?.indexedAt?.getTime(), ancienne.getTime(), 'sa date de relevé ne bouge pas : elle sera lue au renouvellement');
    await getDb().delete(discoveredStores).where(eq(discoveredStores.host, host));
  });

  it('l’index du marché laisse un tiers du plafond aux clients', async () => {
    const { getDb } = await import('@server/db/client');
    const { discoveredStores } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const host = '127.0.0.1';
    await getDb().insert(discoveredStores).values({ host, storeExternalId: BOUTIQUE, label: 'Cuisine du pays', lastSeenAt: new Date(), indexedAt: null }).onConflictDoNothing();
    await dejaLues(Math.floor((PLAFOND * 2) / 3));

    const { indexDiscoveredStores } = await import('@server/services/market');
    const bilan = await indexDiscoveredStores(10_000, new Date(), { storeMinMs: 1_000 });
    assert.equal(bilan.budgetReached, true, 'les deux tiers sont pris : l’index s’arrête');
    assert.equal(lectures.length, 0);
    await getDb().delete(discoveredStores).where(eq(discoveredStores.host, host));

    // Ce qu'un client ouvre passe encore : il reste le tiers qui lui est gardé.
    const { agent } = await signInWithPlan(app, 'firecrawl-tiers@exemple.test', 'pro');
    await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    assert.ok(lectures.length > 0);
  });
});

describe('Relevés de vitrines versés par le collecteur', () => {
  const vitrine = (ventes: number[]) => ({
    store: { externalId: BOUTIQUE, host: 'cuisine-du-pays.mychariow.com', label: 'Cuisine du pays' },
    catalog: catalogue.map((p) => ({ id: p.id, name: p.name, slug: p.slug, type: 'downloadable', status: 'published', pricing: { current_price: { value: p.prix, currency: 'XAF' } } })),
    details: Object.fromEntries(catalogue.map((p, rang) => [p.id, { sales_count: { value: ventes[rang] }, category: { value: 'cuisine' } }])),
  });

  it('donne le plan dans l’ordre, met à jour index et surveillances, et remet en route une surveillance en pause', async () => {
    const { getDb } = await import('@server/db/client');
    const { discoveredStores, marketProducts, spiedAds, watches, watchEvents } = await import('@server/db/schema');
    const { eq, inArray } = await import('drizzle-orm');
    const { userId } = await signInWithPlan(app, 'firecrawl-collecteur@exemple.test', 'pro');
    const ilYA = (jours: number) => new Date(Date.now() - jours * 86_400_000);

    // Une surveillance mise en pause par les refus de la plateforme, avec ses articles d'il y a douze jours.
    const [suivie] = await getDb()
      .insert(watches)
      .values({ userId, source: 'chariow_store', externalId: BOUTIQUE, label: 'Cuisine du pays', url: 'https://cuisine-du-pays.mychariow.com', active: false, failureCount: 5, lastError: 'La vitrine de cette boutique ne répond pas en ce moment.', lastSweptAt: ilYA(1) })
      .returning();
    const { applyObservations } = await import('@server/services/radar/sweep');
    await applyObservations(suivie!, catalogue.map((p) => ({ externalId: p.id, name: p.name, kind: 'downloadable', priceValue: p.prix, currency: 'XAF', salesCount: p.ventes - 100 > 0 ? p.ventes - 100 : 0 })), ilYA(12));
    await getDb().update(watches).set({ active: false, failureCount: 5, lastError: 'La vitrine de cette boutique ne répond pas en ce moment.', lastSweptAt: ilYA(1) }).where(eq(watches.id, suivie!.id));

    // Encore active, mais refusée par la plateforme il y a une heure : son dernier relevé RÉUSSI est ancien, elle est due.
    await getDb().insert(watches).values({ userId, source: 'chariow_store', externalId: 'store_refuseehier', label: 'Refusée hier', url: 'https://refusee-hier.mychariow.com', active: true, failureCount: 2, lastError: 'La vitrine de cette boutique ne répond pas en ce moment.', lastSweptAt: new Date(Date.now() - 3_600_000) });

    const hotes = ['pub-active.mychariow.com', 'sans-pub.mychariow.com', 'lue-ce-matin.mychariow.com', 'autre-plateforme.example.com'];
    await getDb().insert(discoveredStores).values([
      { host: hotes[1]!, lastSeenAt: ilYA(10), indexedAt: ilYA(9) },
      { host: hotes[0]!, lastSeenAt: ilYA(1), indexedAt: ilYA(2), storeExternalId: 'store_pubactive01' },
      { host: hotes[2]!, lastSeenAt: ilYA(1), indexedAt: new Date(Date.now() - 2 * 3_600_000) },
      { host: hotes[3]!, lastSeenAt: ilYA(1), indexedAt: null },
    ]);
    await getDb().insert(spiedAds).values({ externalId: 'plan-pub-1', storeHost: hotes[0]!, landingUrl: `https://${hotes[0]}/p/x`, advertiser: 'Pub active', variants: 1, platforms: ['FACEBOOK'], active: true, lastSeenAt: ilYA(1) });

    try {
      await request(app).get('/api/cron/vitrines').expect(401);
      const { body: plan } = await request(app).get('/api/cron/vitrines').set('Authorization', `Bearer ${SECRET}`).expect(200);
      const nos = (plan.stores as { host: string; reason: string; externalId: string | null; activeAds: number }[]).filter((s) => [...hotes, 'cuisine-du-pays.mychariow.com', 'refusee-hier.mychariow.com'].includes(s.host));
      assert.deepEqual(
        nos.map((s) => [s.host, s.reason]),
        [
          ['cuisine-du-pays.mychariow.com', 'surveillance'],
          ['refusee-hier.mychariow.com', 'surveillance'],
          ['pub-active.mychariow.com', 'publicite'],
          ['sans-pub.mychariow.com', 'index'],
        ],
        'surveillées, puis en publicité, puis les autres ; ni la boutique lue ce matin ni une autre plateforme',
      );
      assert.equal(nos[2]!.externalId, 'store_pubactive01');
      assert.equal(nos[2]!.activeAds, 1);

      // Une adresse qui n'est pas une vitrine est refusée : le versement ne décide pas de ce qui est indexé.
      await request(app).post('/api/cron/vitrines').set('Authorization', `Bearer ${SECRET}`).send({ ...vitrine([1, 2, 3]), store: { externalId: BOUTIQUE, host: 'evil.example.com', label: null } }).expect(400);

      const { body } = await request(app).post('/api/cron/vitrines').set('Authorization', `Bearer ${SECRET}`).send(vitrine([394, 3_564, 12])).expect(200);
      assert.equal(body.products, 3);
      const deLaBoutique = await getDb().select({ id: watches.id }).from(watches).where(eq(watches.externalId, BOUTIQUE));
      assert.equal(body.watches, deLaBoutique.length, 'chaque compte qui suit la boutique reçoit le relevé');
      assert.equal(body.resumed, 1, 'la surveillance en pause reprend');
      assert.equal(body.events, 3, '+100 ventes sur chacun des trois produits depuis douze jours');

      const reprise = await surveillance(suivie!.id);
      assert.equal(reprise.active, true);
      assert.equal(reprise.failureCount, 0);
      assert.equal(reprise.lastError, null);
      const evenements = await getDb().select().from(watchEvents).where(eq(watchEvents.watchId, suivie!.id));
      assert.ok(evenements.some((e) => e.kind === 'sales_jump' && /100 ventes de plus sur « Pack de 400 recettes » \(total 3564\)/.test(e.summary)));

      const indexes = await getDb().select().from(marketProducts).where(eq(marketProducts.storeExternalId, BOUTIQUE));
      const recettes = indexes.find((p) => p.externalId === 'prd_recettes');
      assert.equal(recettes?.salesCount, 3_564, 'l’index du marché a les ventes du jour');
      assert.equal(recettes?.storeHost, 'cuisine-du-pays.mychariow.com');

      const fin = await request(app).post('/api/cron/vitrines').set('Authorization', `Bearer ${SECRET}`).send({ done: true, summary: { indexed: 1, failed: 0, remaining: 2, reasons: {} } }).expect(200);
      assert.equal(typeof fin.body.alertes, 'number', 'les alertes sont recalculées à la clôture');
    } finally {
      await getDb().delete(spiedAds).where(eq(spiedAds.externalId, 'plan-pub-1'));
      await getDb().delete(discoveredStores).where(inArray(discoveredStores.host, hotes));
    }
  });
});

/*
  Demande du propriétaire (18/10/2026) : « quand on clique sur Voir dans Radar d'une boutique, on
  affiche toutes les informations nécessaires automatiquement — à la demande », pas seulement ce
  que le collecteur a relevé à l'avance.
*/
describe('Fiche d’une boutique — lecture à la demande', () => {
  it('relit à l’ouverture une boutique relevée il y a plus de six heures, sans repayer sa page, et une seule fois', async () => {
    const { indexStoreCatalog } = await import('@server/services/market');
    const host = 'cuisine-a-la-demande.mychariow.com';
    const ilYA7h = new Date(Date.now() - 7 * 3_600_000);
    await indexStoreCatalog(
      { externalId: BOUTIQUE, host, label: 'Cuisine du pays' },
      catalogue.map((p) => ({ externalId: p.id, name: p.name, kind: 'downloadable', priceValue: p.prix, currency: 'XAF', salesCount: Math.max(0, p.ventes - 50) })),
      ilYA7h,
    );
    lectures.length = 0;

    const { agent } = await signInWithPlan(app, 'fiche-a-la-demande@exemple.test', 'pro');
    const { body } = await agent.get(`/api/radar/store?host=${host}`).expect(200);
    assert.equal(body.refreshing, false, 'lue dans le temps de la réponse');
    assert.equal(body.totalSales, 3_970, 'les ventes d’aujourd’hui, et non celles d’il y a sept heures');
    assert.ok(Date.now() - new Date(body.indexedAt).getTime() < 60_000, 'le catalogue est daté de cette lecture');
    assert.equal(lectures.length, 4, 'le catalogue et trois fiches : l’identifiant connu évite de relire la page de la boutique');
    assert.ok(lectures.every((lecture) => lecture.proxy === 'basic'));

    // Rouverte aussitôt : ses chiffres sont frais, rien n'est relu ni payé.
    lectures.length = 0;
    await agent.get(`/api/radar/store?host=${host}`).expect(200);
    assert.equal(lectures.length, 0);
  });
});
