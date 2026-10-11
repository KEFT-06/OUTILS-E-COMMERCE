import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { closeTestApp, createAdmin, createTestApp, signUp } from './support/helpers';

/**
 * Mobile Money avec des clés de test (bac à sable) : aucun argent réel ne circule. Un client ne
 * doit donc pas se voir proposer ce moyen de paiement — il croirait avoir payé. Seule l'équipe y
 * accède, pour ses essais ; l'administration dit clairement dans quel mode on se trouve.
 */

const PUBLIC_KEY = 'pk_test_cle_publique_bac_a_sable';
const SECRET_KEY = 'sk_test_cle_secrete_bac_a_sable';
/** Ce que le faux prestataire répond aux clés : accepté, ou « invalides ou inactives ». */
let keysAccepted = true;

const fakeSebpay = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://sebpay.test');
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!keysAccepted || req.headers['x-public-key'] !== PUBLIC_KEY || req.headers['x-secret-key'] !== SECRET_KEY) {
    return send(401, { success: false, message: 'Invalid or inactive API keys.' });
  }
  if (url.pathname === '/countries') return send(200, { success: true, data: [{ country_name: 'Cameroun', country_code: 'CM', prefix: '237', currency: { code: 'XAF' } }] });
  if (url.pathname === '/operators') return send(200, { success: true, data: [{ name: 'MTN', slug: 'mtn', country: { country_code: 'CM' }, otp_required: false }] });
  send(404, { success: false, message: 'Not Found' });
});

let app: Express;

before(async () => {
  await new Promise<void>((resolve) => fakeSebpay.listen(0, '127.0.0.1', resolve));
  app = await createTestApp({
    SEBPAY_PUBLIC_KEY: PUBLIC_KEY,
    SEBPAY_SECRET_KEY: SECRET_KEY,
    SEBPAY_API_URL: `http://127.0.0.1:${(fakeSebpay.address() as AddressInfo).port}`,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => fakeSebpay.close(() => resolve()));
});

describe('Mobile Money en bac à sable', () => {
  it('n’est pas proposé aux clients, seulement à l’équipe', async () => {
    assert.equal((await request(app).get('/api/health').expect(200)).body.mobileMoneyMode, 'test');

    const { agent } = await signUp(app, { name: 'Cliente Ordinaire', email: 'cliente-bac@exemple.com' });
    await agent.patch('/api/account/profile').send({ country: 'CM' }).expect(200);
    const offer = (await agent.get('/api/billing/methods?plan=pro&period=month').expect(200)).body.mobile;
    assert.equal(offer.available, false, 'un client croirait avoir payé');
    assert.equal(offer.mode, 'test');
    const refused = await agent.post('/api/billing/mobile/checkout').send({ plan: 'pro', period: 'month', operator: 'mtn', phone: '677123456' }).expect(503);
    assert.equal(refused.body.error.code, 'MOBILE_MONEY_UNAVAILABLE');

    const admin = await createAdmin(app, 'admin-bac@smartcreator.test');
    await admin.agent.patch('/api/account/profile').send({ country: 'CM' }).expect(200);
    const staff = (await admin.agent.get('/api/billing/methods?plan=pro&period=month').expect(200)).body.mobile;
    assert.equal(staff.available, true, 'l’équipe peut l’essayer');
    assert.equal(staff.mode, 'test');
    assert.equal(staff.amount, 9900);
  });

  it('l’administration dit le mode, et quoi faire quand les clés sont refusées', async () => {
    const { checkServices } = await import('@server/services/admin/services');
    // Relu à chaque fois : le rapport est gardé quelques instants, et c'est le changement qu'on regarde ici.
    const line = async () => (await checkServices({ refresh: true })).services.find((service) => service.id === 'sebpay')!;

    const sandbox = await line();
    assert.equal(sandbox.state, 'warning');
    assert.match(sandbox.detail, /bac à sable/);
    assert.match(sandbox.action ?? '', /clés de production/);

    keysAccepted = false;
    try {
      const refused = await line();
      assert.equal(refused.state, 'error');
      assert.match(refused.detail, /compte marchand pas encore activé/);
      assert.match(refused.action ?? '', /vérification d’identité/);
      assert.ok(!JSON.stringify(refused).includes(SECRET_KEY), 'aucune clé dans la ligne');
    } finally {
      keysAccepted = true;
    }
  });
});
