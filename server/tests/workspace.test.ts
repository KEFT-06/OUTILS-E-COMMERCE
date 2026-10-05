import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { closeTestApp, createTestApp, signUp } from './support/helpers';

/** Brouillons conservés sur le compte : lecture, enregistrement, isolement et limites. */

let app: Express;

before(async () => {
  app = await createTestApp();
});

after(async () => {
  await closeTestApp();
});

describe('Brouillons de l’espace de travail', () => {
  it('enregistre et relit les brouillons de chaque compte, et eux seuls', async () => {
    const { agent } = await signUp(app, { name: 'Fatou Brouillons', email: 'fatou@exemple.com' });

    const empty = await agent.get('/api/workspace/launch_kits').expect(200);
    assert.deepEqual(empty.body, { data: null, updatedAt: null });

    const kits = { p1: { productId: 'p1', objective: 'sales', copies: [{ primaryText: 'Texte', headline: 'Titre', description: '' }], scripts: {}, ctaByMarket: {} } };
    const saved = await agent.put('/api/workspace/launch_kits').send({ data: kits }).expect(200);
    assert.ok(saved.body.updatedAt);

    const products = [{ id: 'produit-1', title: 'Guide du poulailler' }];
    await agent.put('/api/workspace/custom_products').send({ data: products }).expect(200);

    const reread = await agent.get('/api/workspace/launch_kits').expect(200);
    assert.deepEqual(reread.body.data, kits);
    assert.deepEqual((await agent.get('/api/workspace/custom_products').expect(200)).body.data, products);

    // Réécriture : la dernière version remplace la précédente.
    await agent.put('/api/workspace/launch_kits').send({ data: {} }).expect(200);
    assert.deepEqual((await agent.get('/api/workspace/launch_kits').expect(200)).body.data, {});

    const { agent: other } = await signUp(app, { name: 'Autre Compte', email: 'autre-brouillons@exemple.com' });
    assert.equal((await other.get('/api/workspace/custom_products').expect(200)).body.data, null, 'aucun brouillon d’un autre compte');

    const exported = JSON.parse((await agent.get('/api/account/data-export').expect(200)).text) as { workspace: { kind: string }[] };
    assert.deepEqual(exported.workspace.map((document) => document.kind).sort(), ['custom_products', 'launch_kits']);

    await request(app).get('/api/workspace/custom_products').expect(401);
  });

  it('refuse un type inconnu, une forme invalide et un brouillon trop volumineux', async () => {
    const { agent } = await signUp(app, { name: 'Limites Test', email: 'limites-brouillons@exemple.com' });

    await agent.get('/api/workspace/rapports').expect(404);
    await agent.get('/api/workspace/swipe_file').expect(404);
    const shape = await agent.put('/api/workspace/custom_products').send({ data: { pas: 'une liste' } }).expect(400);
    assert.equal(shape.body.error.code, 'WORKSPACE_INVALID');
    await agent.put('/api/workspace/product_drafts').send({ data: ['pas', 'un objet'] }).expect(400);

    const huge = { p1: { details: 'x'.repeat(600_000) } };
    const tooLarge = await agent.put('/api/workspace/launch_kits').send({ data: huge }).expect(413);
    assert.equal(tooLarge.body.error.code, 'WORKSPACE_TOO_LARGE');

    // Les produits rédigés en entier ont plus de place : 600 Ko passent, 4,5 Mo non.
    await agent.put('/api/workspace/product_drafts').send({ data: huge }).expect(200);
    await agent.put('/api/workspace/custom_products').send({ data: [{ details: 'x'.repeat(600_000) }] }).expect(200);
    const tooLargeProducts = await agent.put('/api/workspace/custom_products').send({ data: [{ details: 'x'.repeat(4_500_000) }] }).expect(413);
    assert.equal(tooLargeProducts.body.error.code, 'WORKSPACE_TOO_LARGE');

    const beyondParser = await agent.put('/api/workspace/custom_products').send({ data: ['x'.repeat(6_000_000)] }).expect(413);
    assert.equal(beyondParser.body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  it('conserve le catalogue personnel des niches : niches ajoutées et catalogues créés', async () => {
    const { agent } = await signUp(app, { name: 'Awa Catalogue', email: 'catalogue-niches@exemple.com' });
    assert.equal((await agent.get('/api/workspace/niche_catalog').expect(200)).body.data, null);

    const catalogue = {
      catalogs: [{ id: 'perso-1', label: 'Études bibliques' }],
      niches: [
        { name: 'Animer un groupe d’étude biblique', catalogId: 'perso-1' },
        { name: 'Élevage d’escargots à petite échelle', catalogId: 'agriculture' },
      ],
    };
    await agent.put('/api/workspace/niche_catalog').send({ data: catalogue }).expect(200);
    assert.deepEqual((await agent.get('/api/workspace/niche_catalog').expect(200)).body.data, catalogue);

    // Une liste à la place de l'objet attendu est refusée, et le catalogue enregistré reste intact.
    await agent.put('/api/workspace/niche_catalog').send({ data: [] }).expect(400);
    assert.deepEqual((await agent.get('/api/workspace/niche_catalog').expect(200)).body.data, catalogue);

    const { agent: other } = await signUp(app, { name: 'Autre Catalogue', email: 'autre-catalogue@exemple.com' });
    assert.equal((await other.get('/api/workspace/niche_catalog').expect(200)).body.data, null, 'le catalogue d’un compte ne se voit pas d’un autre');
  });
});

describe('Historique des niches analysées', () => {
  it('efface tout l’historique du compte, et celui-là seulement', async () => {
    const { getDb } = await import('@server/db/client');
    const { reports } = await import('@server/db/schema');
    const { agent, account } = await signUp(app, { name: 'Awa Historique', email: 'historique@exemple.com' });
    const { agent: other, account: otherAccount } = await signUp(app, { name: 'Autre Historique', email: 'autre-historique@exemple.com' });
    await getDb()
      .insert(reports)
      .values([
        { userId: account.id, query: 'poulets', nicheName: 'Élevage de poulets en ville', market: 'CM', report: {} },
        { userId: account.id, query: 'diabète', nicheName: 'Gestion du diabète', market: 'CI', report: {} },
        { userId: otherAccount.id, query: 'savon', nicheName: 'Savon artisanal', market: 'SN', report: {} },
      ]);
    assert.equal((await agent.get('/api/reports').expect(200)).body.reports.length, 2);

    const effacement = await agent.delete('/api/reports').expect(200);
    assert.deepEqual(effacement.body, { deleted: 2 });
    assert.deepEqual((await agent.get('/api/reports').expect(200)).body.reports, []);
    assert.equal((await other.get('/api/reports').expect(200)).body.reports.length, 1, 'l’historique d’un autre compte n’est pas touché');

    // Rien à effacer : la demande aboutit quand même. Sans session : refusée.
    assert.deepEqual((await agent.delete('/api/reports').expect(200)).body, { deleted: 0 });
    await request(app).delete('/api/reports').expect(401);
  });
});
