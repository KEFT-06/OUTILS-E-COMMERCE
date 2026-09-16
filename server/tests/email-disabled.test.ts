import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { closeTestApp, createTestApp, signUp } from './support/helpers';

/** Sans service d'e-mails configuré : le site le dit, sans rien promettre ni rien révéler. */

let app: Express;

before(async () => {
  app = await createTestApp();
});

after(async () => {
  await closeTestApp();
});

describe('E-mails non configurés', () => {
  it('renvoie vers l’administrateur et ne propose pas la confirmation d’adresse', async () => {
    const reset = await request(app).post('/api/auth/password-reset').send({ email: 'inconnue@exemple.com' }).expect(503);
    assert.equal(reset.body.error.code, 'EMAIL_NOT_CONFIGURED');

    const { agent } = await signUp(app, { name: 'Sans Courriel', email: 'sans-courriel@exemple.com' });
    const me = await agent.get('/api/auth/me').expect(200);
    assert.deepEqual(me.body.account.emailVerification, { verified: false, available: false });
    await agent.post('/api/account/verify-email/send').expect(503);

    const health = await request(app).get('/api/health').expect(200);
    assert.equal(health.body.providers.email, false);
  });
});
