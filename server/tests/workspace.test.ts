import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { closeTestApp, createTestApp, signUp } from './helpers';

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

    const swipe = [{ key: 'meta::1', note: 'À étudier' }];
    await agent.put('/api/workspace/swipe_file').send({ data: swipe }).expect(200);

    const reread = await agent.get('/api/workspace/launch_kits').expect(200);
    assert.deepEqual(reread.body.data, kits);
    assert.deepEqual((await agent.get('/api/workspace/swipe_file').expect(200)).body.data, swipe);

    // Réécriture : la dernière version remplace la précédente.
    await agent.put('/api/workspace/launch_kits').send({ data: {} }).expect(200);
    assert.deepEqual((await agent.get('/api/workspace/launch_kits').expect(200)).body.data, {});

    const { agent: other } = await signUp(app, { name: 'Autre Compte', email: 'autre-brouillons@exemple.com' });
    assert.equal((await other.get('/api/workspace/swipe_file').expect(200)).body.data, null, 'aucun brouillon d’un autre compte');

    const exported = JSON.parse((await agent.get('/api/account/data-export').expect(200)).text) as { workspace: { kind: string }[] };
    assert.deepEqual(exported.workspace.map((document) => document.kind).sort(), ['launch_kits', 'swipe_file']);

    await request(app).get('/api/workspace/swipe_file').expect(401);
  });

  it('refuse un type inconnu, une forme invalide et un brouillon trop volumineux', async () => {
    const { agent } = await signUp(app, { name: 'Limites Test', email: 'limites-brouillons@exemple.com' });

    await agent.get('/api/workspace/rapports').expect(404);
    const shape = await agent.put('/api/workspace/swipe_file').send({ data: { pas: 'une liste' } }).expect(400);
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

    const beyondParser = await agent.put('/api/workspace/swipe_file').send({ data: ['x'.repeat(6_000_000)] }).expect(413);
    assert.equal(beyondParser.body.error.code, 'PAYLOAD_TOO_LARGE');
  });
});
