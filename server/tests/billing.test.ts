import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { closeTestApp, createTestApp, signUp } from './helpers';

/**
 * Paiement en ligne contre un faux Stripe : aucune vraie carte, aucun vrai compte.
 * Vérifie le montant fixé par le serveur, l'activation unique du palier, le webhook
 * signé et le refus d'un paiement qui ne correspond pas à la demande.
 */

interface FakeSession {
  id: string;
  url: string;
  status: string;
  payment_status: string;
  amount_total: number;
  currency: string;
  client_reference_id: string | null;
  metadata: Record<string, string>;
}

const sessions = new Map<string, FakeSession>();
const forms: URLSearchParams[] = [];
let counter = 0;

const fakeStripe = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://stripe.test');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== 'Bearer sk_test_cle_de_test') return send(401, { error: { type: 'invalid_request_error' } });

    if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      forms.push(form);
      counter += 1;
      const id = `cs_test_${counter}`;
      const session: FakeSession = {
        id,
        url: `https://checkout.stripe.test/${id}`,
        status: 'open',
        payment_status: 'unpaid',
        amount_total: Number(form.get('line_items[0][price_data][unit_amount]')),
        currency: form.get('line_items[0][price_data][currency]') ?? '',
        client_reference_id: form.get('client_reference_id'),
        metadata: {
          userId: form.get('metadata[userId]') ?? '',
          plan: form.get('metadata[plan]') ?? '',
          periodMonths: form.get('metadata[periodMonths]') ?? '',
        },
      };
      sessions.set(id, session);
      return send(200, session);
    }
    const match = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && match) {
      const session = sessions.get(decodeURIComponent(match[1]!));
      return session ? send(200, session) : send(404, { error: { code: 'resource_missing' } });
    }
    send(404, {});
  });
});

/** Simule le paiement par carte sur la page Stripe. */
const pay = (sessionId: string, changes: Partial<FakeSession> = {}) => Object.assign(sessions.get(sessionId)!, { status: 'complete', payment_status: 'paid' }, changes);

const sessionIdOf = (checkoutUrl: string) => checkoutUrl.split('/').at(-1)!;

let app: Express;

before(async () => {
  await new Promise<void>((resolve) => fakeStripe.listen(0, '127.0.0.1', resolve));
  app = await createTestApp({
    STRIPE_API_KEY: 'sk_test_cle_de_test',
    STRIPE_WEBHOOK_SECRET: 'whsec_secret_de_test',
    STRIPE_API_URL: `http://127.0.0.1:${(fakeStripe.address() as AddressInfo).port}`,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => fakeStripe.close(() => resolve()));
});

async function paymentsFor(sessionId: string) {
  const { getDb } = await import('@server/db/client');
  const { payments } = await import('@server/db/schema');
  return getDb().select().from(payments).where(eq(payments.reference, sessionId));
}

function signed(payload: string, secret = 'whsec_secret_de_test', timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
}

describe('Paiement en ligne', () => {
  it('encaisse le prix fixé par le serveur et active le palier une seule fois', async () => {
    const { agent } = await signUp(app, { name: 'Aïcha Payeuse', email: 'aicha-paie@exemple.com' });
    await agent.patch('/api/account/profile').send({ country: 'CM' }).expect(200);

    const health = await request(app).get('/api/health').expect(200);
    assert.equal(health.body.providers.payments, true);
    assert.equal(health.body.paymentMode, 'test');

    const checkout = await agent.post('/api/billing/checkout').send({ plan: 'pro', period: 'month' }).expect(201);
    const sessionId = sessionIdOf(checkout.body.url);
    const form = forms.at(-1)!;
    assert.equal(form.get('line_items[0][price_data][currency]'), 'xaf', 'devise du pays');
    assert.equal(form.get('line_items[0][price_data][unit_amount]'), '9900', 'prix de la grille, fixé par le serveur');
    assert.equal(form.get('customer_email'), 'aicha-paie@exemple.com');
    assert.equal(form.get('mode'), 'payment');
    assert.match(form.get('success_url') ?? '', /\/app\/compte\?paiement=reussi&session=\{CHECKOUT_SESSION_ID\}$/);

    const pending = await agent.post('/api/billing/confirm').send({ sessionId }).expect(200);
    assert.equal(pending.body.status, 'pending');
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account.plan.id, 'free', 'rien n’est activé avant le paiement');

    pay(sessionId);
    const paid = await agent.post('/api/billing/confirm').send({ sessionId }).expect(200);
    assert.equal(paid.body.status, 'paid');
    assert.ok(new Date(paid.body.expiresAt).getTime() > Date.now() + 27 * 86_400_000);
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account.plan.id, 'pro');

    await agent.post('/api/billing/confirm').send({ sessionId }).expect(200);
    const recorded = await paymentsFor(sessionId);
    assert.equal(recorded.length, 1, 'un seul paiement malgré deux confirmations');
    assert.equal(recorded[0]!.method, 'card');
    assert.equal(recorded[0]!.amountFcfa, 9900);
    assert.equal(recorded[0]!.recordedBy, null);

    const { agent: stranger } = await signUp(app, { name: 'Autre Personne', email: 'autre-paie@exemple.com' });
    await stranger.post('/api/billing/confirm').send({ sessionId }).expect(404);

    const yearly = await agent.post('/api/billing/checkout').send({ plan: 'pro', period: 'year' }).expect(201);
    assert.equal(forms.at(-1)!.get('metadata[periodMonths]'), '12');
    assert.ok(sessionIdOf(yearly.body.url));

    await agent.post('/api/billing/checkout').send({ plan: 'free', period: 'month' }).expect(400);
    await request(app).post('/api/billing/checkout').send({ plan: 'pro', period: 'month' }).expect(401);
  });

  it('active le palier par le webhook signé, sans rejeu ni signature fausse', async () => {
    const { agent } = await signUp(app, { name: 'Webhook Client', email: 'webhook-client@exemple.com' });
    const checkout = await agent.post('/api/billing/checkout').send({ plan: 'plus', period: 'month' }).expect(201);
    const sessionId = sessionIdOf(checkout.body.url);
    pay(sessionId);

    const payload = JSON.stringify({ id: 'evt_test_1', type: 'checkout.session.completed', data: { object: { id: sessionId } } });
    const post = (signature: string) =>
      request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(payload);

    assert.equal((await post(signed(payload, 'whsec_faux'))).status, 400, 'signature d’un autre secret');
    assert.equal((await post(signed(payload, undefined, Math.floor(Date.now() / 1000) - 3600))).status, 400, 'événement trop ancien');
    await post(signed(payload)).expect(200);
    await post(signed(payload)).expect(200);

    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account.plan.id, 'plus');
    assert.equal((await paymentsFor(sessionId)).length, 1, 'un événement rejoué n’encaisse pas deux fois');
  });

  it('refuse un paiement dont le montant ne correspond pas à la demande', async () => {
    const { agent } = await signUp(app, { name: 'Montant Modifié', email: 'montant-modifie@exemple.com' });
    await agent.patch('/api/account/profile').send({ country: 'SN' }).expect(200);
    const checkout = await agent.post('/api/billing/checkout').send({ plan: 'max', period: 'month' }).expect(201);
    const sessionId = sessionIdOf(checkout.body.url);
    assert.equal(forms.at(-1)!.get('line_items[0][price_data][currency]'), 'xof');

    pay(sessionId, { amount_total: 100 });
    const refused = await agent.post('/api/billing/confirm').send({ sessionId }).expect(409);
    assert.equal(refused.body.error.code, 'PAYMENT_MISMATCH');
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account.plan.id, 'free');
    assert.equal((await paymentsFor(sessionId)).length, 0);
  });
});
