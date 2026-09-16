import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { closeTestApp, createTestApp, signUp } from './support/helpers';

/** Sans clé Stripe : aucun bouton de paiement ne peut aboutir, et le serveur le dit. */

let app: Express;

before(async () => {
  app = await createTestApp();
});

after(async () => {
  await closeTestApp();
});

describe('Paiement en ligne non configuré', () => {
  it('refuse le paiement et le webhook avec un message clair', async () => {
    const health = await request(app).get('/api/health').expect(200);
    assert.equal(health.body.providers.payments, false);
    assert.equal(health.body.paymentMode, null);

    const { agent } = await signUp(app, { name: 'Sans Stripe', email: 'sans-stripe@exemple.com' });
    const refused = await agent.post('/api/billing/checkout').send({ plan: 'pro', period: 'month' }).expect(503);
    assert.equal(refused.body.error.code, 'PAYMENT_NOT_CONFIGURED');

    await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').send('{}').expect(503);
  });
});
