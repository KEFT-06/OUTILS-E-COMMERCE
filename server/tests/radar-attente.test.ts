import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Capture du propriétaire, 18/10/2026 : des boutiques qu'il venait d'ajouter affichaient « 0 en
 * vente », « relevée à l'instant » et « Dernier relevé en échec : La vitrine de cette boutique ne
 * répond pas en ce moment » — et le bouton d'actualisation renvoyait la même erreur. La plateforme
 * refuse le serveur depuis le 11/10 ; le collecteur des vitrines, lui, les lit.
 *
 * Ce qui doit tenir : une boutique s'ajoute même quand sa vitrine refuse le serveur ; le relevé
 * frais du collecteur sert la surveillance ; un refus de la plateforme n'est jamais présenté comme
 * une panne, et ne met plus une surveillance en pause.
 */

const BOUTIQUE = 'store_attente0001';
const SECRET = 'secret-du-planificateur-attente';
/** true : la vitrine refuse le serveur sur toutes ses adresses, comme la plateforme depuis le 11/10/2026. */
let muette = true;
let ventes = [120, 40];

const fausseVitrine = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://vitrine.test');
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (muette) return json(500, { message: 'Server Error' });
  if (url.pathname === `/storefront/${BOUTIQUE}/products`) {
    return json(200, {
      data: [
        { id: 'prd_guide', name: 'Guide du manioc', slug: 'guide', type: 'downloadable', status: 'published', pricing: { current_price: { value: 3_000, currency: 'XAF' } } },
        { id: 'prd_pack', name: 'Pack recettes', slug: 'pack', type: 'downloadable', status: 'published', pricing: { current_price: { value: 2_000, currency: 'XAF' } } },
      ],
      pagination: { next_page_url: null, has_more_pages: false },
    });
  }
  const fiche = new RegExp(`^/storefront/${BOUTIQUE}/products/(prd_[a-z]+)$`).exec(url.pathname);
  if (fiche) return json(200, { data: { sales_count: { value: fiche[1] === 'prd_guide' ? ventes[0] : ventes[1] }, category: { value: 'cuisine' } } });
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><title>Manioc et Cie</title></head><body><script>{"store":{"id":"${BOUTIQUE}"}}</script></body></html>`);
    return;
  }
  json(404, { detail: 'Not Found' });
});

let app: Express;
let base = '';

before(async () => {
  await new Promise<void>((r) => fausseVitrine.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(fausseVitrine.address() as AddressInfo).port}`;
  app = await createTestApp({ CHARIOW_STOREFRONT_URL: base, CRON_SECRET: SECRET });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => fausseVitrine.close(() => r()));
});

describe('Radar — vitrine qui refuse le serveur', () => {
  it('met la boutique sous surveillance quand même, en attente de son premier relevé, sans jamais parler de panne', async () => {
    muette = true;
    const { agent } = await signInWithPlan(app, 'attente-ajout@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    const id = ajout.body.watch.id as string;
    assert.equal(ajout.body.watch.lastReadAt, null, 'pas encore lue : pas de chiffres, et pas « 0 produit »');
    assert.equal(ajout.body.firstSweep, null);

    // Actualiser : pas d'erreur, l'écran dit que les chiffres arriveront.
    for (let essai = 0; essai < 6; essai += 1) {
      const releve = await agent.post(`/api/radar/watches/${id}/sweep`).expect(200);
      assert.equal(releve.body.outcome.pending, true);
    }
    const { body } = await agent.get('/api/radar').expect(200);
    const suivie = body.watches.find((watch: { id: string }) => watch.id === id);
    assert.equal(suivie.active, true, 'six refus de la plateforme ne mettent pas la surveillance en pause');

    // La vitrine répond de nouveau : l'identifiant se lit sur sa page, puis le catalogue.
    muette = false;
    const lue = await agent.post(`/api/radar/watches/${id}/sweep`).expect(200);
    assert.equal(lue.body.outcome.observed, 2);
    assert.equal(lue.body.outcome.pending, undefined);
    const apres = (await agent.get('/api/radar').expect(200)).body.watches.find((watch: { id: string }) => watch.id === id);
    assert.equal(apres.label, 'Manioc et Cie', 'le nom de la boutique remplace son adresse');
    assert.equal(apres.totalSales, 160);
    assert.ok(apres.lastReadAt, 'la date des chiffres est celle de ce relevé');
  });

  it('se sert du relevé frais du collecteur quand la vitrine refuse, et seulement s’il est frais', async () => {
    muette = false;
    ventes = [120, 40];
    const { agent } = await signInWithPlan(app, 'attente-index@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    const id = ajout.body.watch.id as string;
    assert.equal(ajout.body.watch.totalSales, 160);

    // Le collecteur relit la boutique : +30 ventes sur le guide. Le serveur, lui, est refusé.
    const { indexStoreCatalog } = await import('@server/services/market');
    const lecture = new Date();
    await indexStoreCatalog(
      { externalId: BOUTIQUE, host: 'manioc.mychariow.com', label: 'Manioc et Cie' },
      [
        { externalId: 'prd_guide', name: 'Guide du manioc', kind: 'downloadable', priceValue: 3_000, currency: 'XAF', salesCount: 150 },
        { externalId: 'prd_pack', name: 'Pack recettes', kind: 'downloadable', priceValue: 2_000, currency: 'XAF', salesCount: 40 },
      ],
      lecture,
    );
    muette = true;
    const releve = await agent.post(`/api/radar/watches/${id}/sweep`).expect(200);
    assert.equal(releve.body.outcome.pending, undefined, 'un relevé frais existe : il est appliqué');
    assert.equal(releve.body.outcome.salesJumps, 1);
    const carte = (await agent.get('/api/radar').expect(200)).body.watches.find((watch: { id: string }) => watch.id === id);
    assert.equal(carte.totalSales, 190);
    assert.equal(carte.lastError, null, 'rien n’a échoué');
    assert.equal(new Date(carte.lastReadAt).getTime(), lecture.getTime(), 'les chiffres sont datés du relevé du collecteur');
    const fil = await agent.get('/api/radar').expect(200);
    assert.ok((fil.body.events as { summary: string }[]).some((event) => /30 ventes de plus sur « Guide du manioc »/.test(event.summary)));

    // Le même relevé, redemandé : rien de neuf, rien d'échoué.
    const encore = await agent.post(`/api/radar/watches/${id}/sweep`).expect(200);
    assert.equal(encore.body.outcome.salesJumps, 0);
    assert.equal(encore.body.outcome.pending, undefined);

    // Trente heures plus tard, ce relevé n'est plus frais : la surveillance attend le suivant.
    const { sweepWatch } = await import('@server/services/radar/sweep');
    const { getDb } = await import('@server/db/client');
    const { watches } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const [ligne] = await getDb().select().from(watches).where(eq(watches.id, id));
    await assert.rejects(sweepWatch(ligne!, new Date(lecture.getTime() + 31 * 3_600_000)), { code: 'RADAR_SOURCE_UNAVAILABLE' });
  });

  it('le collecteur lit une boutique en attente : elle prend son identifiant, son nom et ses chiffres', async () => {
    const { userId } = await signInWithPlan(app, 'attente-collecteur@exemple.test', 'pro');
    const { getDb } = await import('@server/db/client');
    const { watches } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const [enAttente] = await getDb()
      .insert(watches)
      .values({ userId, source: 'chariow_store', externalId: 'host:attente-vitrine.mychariow.com', label: 'attente-vitrine.mychariow.com', url: 'https://attente-vitrine.mychariow.com', failureCount: 1 })
      .returning();

    const { body: plan } = await request(app).get('/api/cron/vitrines').set('Authorization', `Bearer ${SECRET}`).expect(200);
    const entree = (plan.stores as { host: string; externalId: string | null; reason: string }[]).find((s) => s.host === 'attente-vitrine.mychariow.com');
    assert.deepEqual(entree && { externalId: entree.externalId, reason: entree.reason }, { externalId: null, reason: 'surveillance' }, 'au plan, son identifiant reste à lire sur sa page');

    await request(app)
      .post('/api/cron/vitrines')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({
        store: { externalId: 'store_vitrineattente', host: 'attente-vitrine.mychariow.com', label: 'Vitrine en attente' },
        catalog: [{ id: 'prd_unique', name: 'Produit unique', type: 'downloadable', status: 'published', pricing: { current_price: { value: 1_000, currency: 'XAF' } } }],
        details: { prd_unique: { sales_count: { value: 9 } } },
      })
      .expect(200);
    const [resolue] = await getDb().select().from(watches).where(eq(watches.id, enAttente!.id));
    assert.equal(resolue?.externalId, 'store_vitrineattente');
    assert.equal(resolue?.label, 'Vitrine en attente');
    assert.equal(resolue?.failureCount, 0);
  });
});

describe('Correction 0052 — fausses nouveautés du premier relevé', () => {
  it('retire les « Nouveau produit » du premier relevé, et garde les vraies nouveautés et les retours', async () => {
    const { readFileSync } = await import('node:fs');
    const { sql, eq } = await import('drizzle-orm');
    const { getDb } = await import('@server/db/client');
    const { watches, watchItems, watchEvents } = await import('@server/db/schema');
    const { userId } = await signInWithPlan(app, 'correction-0052@exemple.test', 'pro');
    const depart = new Date('2026-10-18T13:20:00.123Z');
    const lendemain = new Date('2026-10-19T09:00:00.456Z');
    const [suivie] = await getDb().insert(watches).values({ userId, source: 'chariow_store', externalId: 'store_correction52', label: 'Correction', url: 'https://correction.mychariow.com' }).returning();
    const id = suivie!.id;
    await getDb().insert(watchItems).values([
      { watchId: id, externalId: 'prd_a', name: 'A', firstSeenAt: depart, lastSeenAt: lendemain },
      { watchId: id, externalId: 'prd_b', name: 'B', firstSeenAt: depart, lastSeenAt: lendemain },
      { watchId: id, externalId: 'prd_c', name: 'C', firstSeenAt: lendemain, lastSeenAt: lendemain },
    ]);
    await getDb().insert(watchEvents).values([
      { watchId: id, kind: 'appeared', summary: 'Nouveau produit : « A »', payload: { name: 'A' }, occurredAt: depart },
      { watchId: id, kind: 'appeared', summary: 'Nouveau produit : « B »', payload: { name: 'B' }, occurredAt: depart },
      { watchId: id, kind: 'appeared', summary: '« B » est de retour en vente.', payload: { name: 'B', returned: true }, occurredAt: depart },
      { watchId: id, kind: 'sales_jump', summary: '5 ventes de plus sur « A »', payload: {}, occurredAt: depart },
      { watchId: id, kind: 'appeared', summary: 'Nouveau produit : « C »', payload: { name: 'C' }, occurredAt: lendemain },
    ]);

    await getDb().execute(sql.raw(readFileSync('server/db/migrations/0052_retirer_fausses_nouveautes.sql', 'utf8')));

    const restants = (await getDb().select().from(watchEvents).where(eq(watchEvents.watchId, id))).map((event) => event.summary).sort();
    assert.deepEqual(restants, ['5 ventes de plus sur « A »', 'Nouveau produit : « C »', '« B » est de retour en vente.']);
  });
});
