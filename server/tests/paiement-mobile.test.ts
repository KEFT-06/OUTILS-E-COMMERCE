import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { closeTestApp, createTestApp, signUp } from './support/helpers';

/**
 * Paiement d'un palier par Mobile Money, contre un faux SebPay : aucune demande ne part sur un
 * vrai téléphone, aucun argent ne circule.
 *
 * Ce qui est verrouillé ici : le montant est fixé par le serveur ; le palier ne s'active que sur
 * la parole du prestataire, relue chez lui ; une notification forgée n'active rien ; un paiement
 * validé après que l'écran a été quitté trouve quand même son palier.
 */

interface FakeCollection {
  transaction_id: string;
  external_reference: string;
  status: string;
  amount: number;
  currency: string;
  provider_link?: string;
}

const PUBLIC_KEY = 'pk_live_cle_publique_de_test';
const SECRET_KEY = 'sk_live_cle_secrete_de_test';

const collections = new Map<string, FakeCollection>();
const requests: Record<string, unknown>[] = [];
let counter = 0;
/** Panne simulée du prestataire sur ses listes de référence. */
let referenceDown = false;

const fakeSebpay = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://sebpay.test');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-public-key'] !== PUBLIC_KEY || req.headers['x-secret-key'] !== SECRET_KEY) {
      return send(401, { success: false, message: 'Invalid or inactive API keys.' });
    }
    if (req.method === 'GET' && url.pathname === '/countries') {
      if (referenceDown) return send(500, { success: false, message: 'Internal Server Error' });
      return send(200, {
        success: true,
        message: 'ok',
        data: [
          { id: '1', country_name: 'Cameroun', country_code: 'CM', prefix: '+237', currency: { code: 'XAF', name: 'Franc CFA' } },
          { id: '2', country_name: "Côte d'Ivoire", country_code: 'CI', prefix: '225', currency: { code: 'XOF' } },
        ],
      });
    }
    if (req.method === 'GET' && url.pathname === '/operators') {
      const all = [
        { id: '10', name: 'MTN', slug: 'mtn', code: 'MTN_CM', country: { country_code: 'CM' }, otp_required: false },
        { id: '11', name: 'Orange', slug: 'orange', code: 'ORANGE_CM', country: { country_code: 'CM' }, otp_required: false },
        { id: '20', name: 'Orange', slug: 'orange', code: 'ORANGE_CI', country: { country_code: 'CI' }, otp_required: true, ussd_code: '#144*82#' },
        { id: '21', name: 'Wave', slug: 'wave', code: 'WAVE_CI', country: { country_code: 'CI' }, otp_required: false },
      ];
      // Comme un prestataire qui ignorerait le filtre : la liste entière est rendue, et c'est au site de trier.
      return send(200, { success: true, data: all, message: 'ok' });
    }
    if (req.method === 'POST' && url.pathname === '/collections') {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      requests.push(body);
      if (body.phone === '237600000000') return send(422, { success: false, message: 'Invalid phone number.' });
      counter += 1;
      const collection: FakeCollection = {
        transaction_id: `2026101100000${counter}`,
        external_reference: String(body.external_reference),
        status: body.otp_code ? 'approved' : 'pending',
        amount: Number(body.amount),
        currency: String(body.currency),
        ...(body.operator === 'wave' ? { provider_link: 'https://pay.wave.test/c/abc' } : {}),
      };
      collections.set(collection.external_reference, collection);
      return send(200, { success: true, data: { ...collection, message: 'Transaction initiated.' }, message: 'ok' });
    }
    const match = /^\/collections\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && match) {
      const collection = collections.get(decodeURIComponent(match[1]!));
      return collection ? send(200, { success: true, data: collection, message: 'ok' }) : send(404, { success: false, message: 'Not Found' });
    }
    send(404, { success: false, message: 'Not Found' });
  });
});

/** Le client valide (ou refuse) sur son téléphone. */
const answer = (reference: string, status: 'approved' | 'rejected', changes: Partial<FakeCollection> = {}) => Object.assign(collections.get(reference)!, { status }, changes);

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

async function paymentsFor(reference: string) {
  const { getDb } = await import('@server/db/client');
  const { payments } = await import('@server/db/schema');
  return getDb().select().from(payments).where(eq(payments.reference, reference));
}

async function checkoutRow(reference: string) {
  const { getDb } = await import('@server/db/client');
  const { paymentCheckouts } = await import('@server/db/schema');
  const [row] = await getDb().select().from(paymentCheckouts).where(eq(paymentCheckouts.id, reference)).limit(1);
  return row!;
}

/** Vieillit une demande : la garde contre les demandes coup sur coup ne s'applique plus. */
async function age(reference: string, ms: number) {
  const { getDb } = await import('@server/db/client');
  const { paymentCheckouts } = await import('@server/db/schema');
  await getDb().update(paymentCheckouts).set({ createdAt: new Date(Date.now() - ms) }).where(eq(paymentCheckouts.id, reference));
}

async function customer(name: string, email: string, country = 'CM') {
  const { agent } = await signUp(app, { name, email });
  await agent.patch('/api/account/profile').send({ country }).expect(200);
  return agent;
}

const planOf = async (agent: Awaited<ReturnType<typeof customer>>) => (await agent.get('/api/auth/me').expect(200)).body.account.plan.id as string;

describe('Paiement par Mobile Money', () => {
  it('propose les opérateurs du pays du compte, et le montant fixé par le serveur', async () => {
    const agent = await customer('Aïcha Momo', 'aicha-momo@exemple.com');

    const health = await request(app).get('/api/health').expect(200);
    assert.equal(health.body.mobileMoneyMode, 'live');

    const { body } = await agent.get('/api/billing/methods?plan=pro&period=month').expect(200);
    assert.equal(body.card.available, false, 'la carte n’est pas configurée ici');
    assert.equal(body.mobile.available, true);
    assert.equal(body.mobile.country, 'CM');
    assert.equal(body.mobile.currency, 'XAF');
    assert.equal(body.mobile.prefix, '237');
    assert.deepEqual(
      body.mobile.operators.map((operator: { slug: string }) => operator.slug),
      ['mtn', 'orange'],
      'seuls les opérateurs du Cameroun, même quand le prestataire rend toute sa liste',
    );
    assert.equal(body.mobile.amount, 9900, 'prix de la grille');
    assert.match(body.mobile.amountLabel, /9\s?900/);

    // Sans palier demandé : la liste des moyens, sans montant.
    const bare = await agent.get('/api/billing/methods').expect(200);
    assert.equal(bare.body.mobile.available, true);
    assert.equal(bare.body.mobile.amount, null);
    await request(app).get('/api/billing/methods').expect(401);
  });

  it('envoie la demande sur le téléphone, puis active le palier une seule fois quand le client valide', async () => {
    const agent = await customer('Brice Payeur', 'brice-momo@exemple.com');

    const started = await agent.post('/api/billing/mobile/checkout').send({ plan: 'pro', period: 'month', operator: 'mtn', phone: '6 77 12 34 56' }).expect(201);
    const { reference } = started.body as { reference: string };
    assert.equal(started.body.status, 'pending');
    assert.equal(started.body.operator, 'MTN');
    assert.equal(started.body.phoneHint, '•••• 56');
    assert.match(reference, /^SC[0-9A-Z]+$/);

    const sent = requests.at(-1)!;
    assert.equal(sent.amount, 9900, 'montant de la grille, jamais celui du navigateur');
    assert.equal(sent.currency, 'XAF');
    assert.equal(sent.phone, '237677123456', 'numéro au format international, sans le +');
    assert.equal(sent.operator, 'mtn');
    assert.equal(sent.country, 'CM');
    assert.equal(sent.external_reference, reference);
    assert.match(String(sent.callback_url), /\/api\/billing\/mobile\/notify$/);
    assert.equal('otp_code' in sent, false);

    const row = await checkoutRow(reference);
    assert.equal(row.provider, 'sebpay');
    assert.equal(row.operator, 'mtn');
    assert.equal(row.phoneHint, '•••• 56');
    assert.ok(!JSON.stringify(row).includes('677123456'), 'le numéro entier n’est pas gardé');

    assert.equal((await agent.get(`/api/billing/mobile/${reference}`).expect(200)).body.status, 'pending');
    assert.equal(await planOf(agent), 'free', 'rien n’est activé avant la validation');

    answer(reference, 'approved');
    const paid = await agent.get(`/api/billing/mobile/${reference}`).expect(200);
    assert.equal(paid.body.status, 'paid');
    assert.ok(new Date(paid.body.expiresAt).getTime() > Date.now() + 27 * 86_400_000);
    assert.equal(await planOf(agent), 'pro');

    await agent.get(`/api/billing/mobile/${reference}`).expect(200);
    const recorded = await paymentsFor(reference);
    assert.equal(recorded.length, 1, 'un seul paiement malgré plusieurs lectures');
    assert.equal(recorded[0]!.method, 'mobile_money');
    assert.equal(recorded[0]!.amountFcfa, 9900);
    assert.match(recorded[0]!.note ?? '', /Mobile Money \(MTN, numéro •••• 56\)/);

    // Un autre compte ne lit pas ce paiement, et la confirmation « carte » ne le connaît pas.
    const stranger = await customer('Autre Personne', 'autre-momo@exemple.com');
    await stranger.get(`/api/billing/mobile/${reference}`).expect(404);
    await agent.post('/api/billing/confirm').send({ sessionId: reference }).expect(404);
    await agent.get('/api/billing/mobile/SCINCONNUE0000').expect(404);
  });

  it('un paiement refusé n’active rien, et laisse reprendre', async () => {
    const agent = await customer('Carine Refus', 'carine-momo@exemple.com');
    const { body } = await agent.post('/api/billing/mobile/checkout').send({ plan: 'plus', period: 'month', operator: 'orange', phone: '+237 699 00 11 22' }).expect(201);
    assert.equal(requests.at(-1)!.phone, '237699001122');

    // Deux demandes coup sur coup feraient sonner deux fois le téléphone.
    const twice = await agent.post('/api/billing/mobile/checkout').send({ plan: 'plus', period: 'month', operator: 'orange', phone: '699001122' }).expect(409);
    assert.equal(twice.body.error.code, 'PAYMENT_ALREADY_SENT');

    answer(body.reference, 'rejected');
    assert.equal((await agent.get(`/api/billing/mobile/${body.reference}`).expect(200)).body.status, 'failed');
    assert.equal(await planOf(agent), 'free');
    assert.equal((await paymentsFor(body.reference)).length, 0);

    // La demande refusée n'est plus « ouverte » : la suivante part aussitôt.
    await agent.post('/api/billing/mobile/checkout').send({ plan: 'plus', period: 'month', operator: 'orange', phone: '699001122' }).expect(201);
  });

  it('refuse avant tout envoi un numéro, un opérateur ou un palier qui ne conviennent pas', async () => {
    const agent = await customer('Denis Saisie', 'denis-momo@exemple.com');
    const before = requests.length;
    const post = (body: Record<string, unknown>) => agent.post('/api/billing/mobile/checkout').send({ plan: 'pro', period: 'month', operator: 'mtn', phone: '677123456', ...body });

    assert.equal((await post({ phone: '+225 07 08 09 10 11' }).expect(400)).body.error.code, 'PHONE_INVALID', 'numéro d’un autre pays');
    assert.equal((await post({ phone: '12 34' })).status, 400, 'trop court');
    assert.equal((await post({ operator: 'wave' }).expect(400)).body.error.code, 'OPERATOR_UNAVAILABLE', 'opérateur d’un autre pays');
    await post({ plan: 'free' }).expect(400);
    assert.equal(requests.length, before, 'rien n’est parti chez le prestataire');

    // Refusé par l'opérateur lui-même : un message clair, et la demande ne reste pas ouverte.
    const refused = await post({ phone: '600000000' }).expect(400);
    assert.equal(refused.body.error.code, 'PAYMENT_REFUSED');
    assert.match(refused.body.error.message, /Aucun montant n’a été débité/);
    assert.doesNotMatch(refused.body.error.message, /Invalid phone/, 'le texte du prestataire ne sort pas tel quel');
    await post({}).expect(201);
    await request(app).post('/api/billing/mobile/checkout').send({ plan: 'pro', period: 'month', operator: 'mtn', phone: '677123456' }).expect(401);
  });

  it('demande le code de confirmation aux opérateurs qui l’exigent, et valide aussitôt avec lui', async () => {
    const agent = await customer('Émile Abidjan', 'emile-momo@exemple.com', 'CI');
    const offer = (await agent.get('/api/billing/methods?plan=plus&period=year').expect(200)).body.mobile;
    assert.equal(offer.currency, 'XOF');
    assert.deepEqual(offer.operators.find((operator: { slug: string }) => operator.slug === 'orange'), { slug: 'orange', name: 'Orange', otpRequired: true, ussdCode: '#144*82#' });

    const missing = await agent.post('/api/billing/mobile/checkout').send({ plan: 'plus', period: 'year', operator: 'orange', phone: '07 08 09 10 11' }).expect(400);
    assert.equal(missing.body.error.code, 'OTP_REQUIRED');
    assert.match(missing.body.error.message, /composez #144\*82# sur votre téléphone/);

    const paid = await agent.post('/api/billing/mobile/checkout').send({ plan: 'plus', period: 'year', operator: 'orange', phone: '07 08 09 10 11', otpCode: '123456' }).expect(201);
    const sent = requests.at(-1)!;
    assert.equal(sent.otp_code, '123456');
    assert.equal(sent.phone, '2250708091011', 'le zéro du numéro ivoirien est gardé');
    assert.equal(sent.amount, offer.amount);
    assert.equal(paid.body.status, 'paid', 'l’opérateur a tranché tout de suite');
    assert.equal(await planOf(agent), 'plus');
    assert.equal((await checkoutRow(paid.body.reference)).periodMonths, 12);
  });

  it('rend l’adresse de validation des opérateurs qui en ont une', async () => {
    const agent = await customer('Fatou Wave', 'fatou-momo@exemple.com', 'CI');
    const { body } = await agent.post('/api/billing/mobile/checkout').send({ plan: 'pro', period: 'month', operator: 'wave', phone: '0102030405' }).expect(201);
    assert.equal(body.providerLink, 'https://pay.wave.test/c/abc');
    assert.equal(body.status, 'pending');
  });

  it('refuse un paiement dont le montant ne correspond pas à la demande', async () => {
    const agent = await customer('Gaël Montant', 'gael-momo@exemple.com');
    const { body } = await agent.post('/api/billing/mobile/checkout').send({ plan: 'max', period: 'month', operator: 'mtn', phone: '677000001' }).expect(201);
    answer(body.reference, 'approved', { amount: 100 });
    const refused = await agent.get(`/api/billing/mobile/${body.reference}`).expect(409);
    assert.equal(refused.body.error.code, 'PAYMENT_MISMATCH');
    assert.equal(await planOf(agent), 'free');
    assert.equal((await paymentsFor(body.reference)).length, 0);

    // Un montant rendu net des frais du prestataire, ou en franc CFA de l'autre zone, reste le bon paiement.
    const other = await customer('Gisèle Frais', 'gisele-momo@exemple.com');
    const net = (await other.post('/api/billing/mobile/checkout').send({ plan: 'pro', period: 'month', operator: 'mtn', phone: '677000008' }).expect(201)).body.reference as string;
    answer(net, 'approved', { amount: 9702, currency: 'XOF' });
    assert.equal((await other.get(`/api/billing/mobile/${net}`).expect(200)).body.status, 'paid');
    assert.equal((await paymentsFor(net))[0]!.amountFcfa, 9900, 'le registre garde le montant payé par le client');
  });

  it('une notification ne fait que désigner la demande à relire : forgée, elle n’active rien', async () => {
    const agent = await customer('Hawa Notif', 'hawa-momo@exemple.com');
    const { body } = await agent.post('/api/billing/mobile/checkout').send({ plan: 'pro', period: 'month', operator: 'mtn', phone: '677000002' }).expect(201);
    const reference = body.reference as string;
    const notify = (payload: string, signature?: string) => {
      const sending = request(app).post('/api/billing/mobile/notify').set('Content-Type', 'application/json');
      return (signature ? sending.set('X-SebPay-Signature', signature) : sending).send(payload);
    };
    const settled = () => new Promise((resolve) => setTimeout(resolve, 250));

    // Un tiers affirme que c'est payé, sans signature : le prestataire, relu, dit que non.
    const forged = JSON.stringify({ transaction_id: 'x', external_reference: reference, status: 'approved', amount: 9900, currency: 'XAF' });
    await notify(forged).expect(200);
    await settled();
    assert.equal(await planOf(agent), 'free', 'la notification n’est pas crue sur parole');

    // Le client valide ; la vraie notification arrive, signée.
    answer(reference, 'approved');
    const real = JSON.stringify({ transaction_id: collections.get(reference)!.transaction_id, external_reference: reference, status: 'approved', amount: 9900, currency: 'XAF', customer_phone: '237677000002' });
    await notify(real, createHmac('sha256', SECRET_KEY).update(real).digest('hex')).expect(200);
    await settled();
    assert.equal(await planOf(agent), 'pro');
    // Renvoyée par le prestataire : rien n'est encaissé deux fois.
    await notify(real, createHmac('sha256', SECRET_KEY).update(real).digest('hex')).expect(200);
    await settled();
    assert.equal((await paymentsFor(reference)).length, 1);

    // Ce qui ne nous concerne pas est reçu sans bruit ; ce qui est illisible est refusé.
    await notify(JSON.stringify({ external_reference: 'COMMANDE-D-UN-AUTRE-SITE' })).expect(200);
    await notify(JSON.stringify({ external_reference: 'SCINCONNUE00000000' })).expect(200);
    await notify('ceci n’est pas du JSON').expect(400);
  });

  it('un paiement validé après que l’écran a été quitté trouve son palier au retour du client', async () => {
    const agent = await customer('Inès Retour', 'ines-momo@exemple.com');
    const { body } = await agent.post('/api/billing/mobile/checkout').send({ plan: 'plus', period: 'month', operator: 'mtn', phone: '677000003' }).expect(201);

    assert.equal((await agent.post('/api/billing/mobile/resume').expect(200)).body.activated, 0, 'rien à reprendre tant que rien n’est validé');
    answer(body.reference, 'approved');
    assert.equal((await agent.post('/api/billing/mobile/resume').expect(200)).body.activated, 1);
    assert.equal(await planOf(agent), 'plus');
    assert.equal((await agent.post('/api/billing/mobile/resume').expect(200)).body.activated, 0, 'une seule fois');

    // La veille du serveur fait la même reprise pour tous les comptes, et clôt ce qui n'aboutira plus.
    const other = await customer('Jules Veille', 'jules-momo@exemple.com');
    const second = (await other.post('/api/billing/mobile/checkout').send({ plan: 'pro', period: 'month', operator: 'orange', phone: '699000004' }).expect(201)).body.reference as string;
    const stale = await customer('Karim Ancien', 'karim-momo@exemple.com');
    const third = (await stale.post('/api/billing/mobile/checkout').send({ plan: 'pro', period: 'month', operator: 'mtn', phone: '677000005' }).expect(201)).body.reference as string;
    await age(third, 26 * 3_600_000);
    answer(second, 'approved');

    const { resumeMobileCheckouts } = await import('@server/services/billing/mobile');
    assert.equal(await resumeMobileCheckouts({ limit: 20 }), 1);
    assert.equal(await planOf(other), 'pro');
    assert.equal((await checkoutRow(third)).status, 'expired', 'une demande d’hier sans réponse n’est plus attendue');
    assert.equal(await planOf(stale), 'free');
  });

  it('ne propose pas le Mobile Money là où il n’est pas ouvert, et ne casse jamais l’écran', async () => {
    const french = await customer('Léa Paris', 'lea-momo@exemple.com', 'FR');
    const offer = (await french.get('/api/billing/methods?plan=pro&period=month').expect(200)).body;
    assert.equal(offer.mobile.available, false, 'aucun opérateur pour ce pays');
    assert.deepEqual(offer.mobile.operators, []);
    const refused = await french.post('/api/billing/mobile/checkout').send({ plan: 'pro', period: 'month', operator: 'mtn', phone: '677000006' }).expect(503);
    assert.equal(refused.body.error.code, 'MOBILE_MONEY_UNAVAILABLE');

    // Prestataire en panne : le moyen de paiement se ferme à l'écran, la route répond quand même.
    const { resetSebpayMemory } = await import('@server/services/billing/sebpay');
    resetSebpayMemory();
    referenceDown = true;
    try {
      const agent = await customer('Noé Panne', 'noe-momo@exemple.com');
      const down = (await agent.get('/api/billing/methods?plan=pro&period=month').expect(200)).body;
      assert.equal(down.mobile.available, false);
    } finally {
      referenceDown = false;
      resetSebpayMemory();
    }
  });
});

describe('Lecture d’un numéro et d’une notification', () => {
  it('met un numéro au format international sans toucher à ses chiffres', async () => {
    const { internationalNumber, phoneHint } = await import('@server/shared/phone');
    assert.equal(internationalNumber('6 77 12 34 56', '237'), '237677123456');
    assert.equal(internationalNumber('+237 677-12-34-56', '237'), '237677123456');
    assert.equal(internationalNumber('00237677123456', '237'), '237677123456');
    assert.equal(internationalNumber('237677123456', '237'), '237677123456', 'indicatif déjà écrit');
    assert.equal(internationalNumber('07 08 09 10 11', '225'), '2250708091011', 'zéro initial gardé');
    assert.equal(internationalNumber('+225 07 08 09 10 11', '237'), '2250708091011', 'un « + » dit son propre indicatif');
    assert.equal(internationalNumber('1234', '237'), null);
    assert.equal(internationalNumber('abc', '237'), null);
    assert.equal(internationalNumber('6'.repeat(20), '237'), null);
    assert.equal(phoneHint('237677123456'), '•••• 56');
  });

  it('reconnaît la signature du prestataire, en hexadécimal ou en base64', async () => {
    const { collectionStatus, signatureMatches } = await import('@server/services/billing/sebpay');
    const body = Buffer.from('{"external_reference":"SCABC","status":"approved"}');
    const mac = createHmac('sha256', 'secret');
    const digest = mac.update(body).digest();
    assert.equal(signatureMatches(body, digest.toString('hex'), 'secret'), true);
    assert.equal(signatureMatches(body, `sha256=${digest.toString('hex').toUpperCase()}`, 'secret'), true);
    assert.equal(signatureMatches(body, digest.toString('base64'), 'secret'), true);
    assert.equal(signatureMatches(body, digest.toString('hex'), 'autre-secret'), false);
    assert.equal(signatureMatches(Buffer.from('{"status":"approved"}'), digest.toString('hex'), 'secret'), false, 'corps modifié');
    assert.equal(signatureMatches(body, undefined, 'secret'), false);
    assert.equal(signatureMatches(body, '', 'secret'), false);

    assert.equal(collectionStatus('approved'), 'approved');
    assert.equal(collectionStatus('SUCCESS'), 'approved');
    assert.equal(collectionStatus('rejected'), 'rejected');
    assert.equal(collectionStatus('FAILED'), 'rejected');
    assert.equal(collectionStatus('pending'), 'pending');
    assert.equal(collectionStatus('quelque chose d’inconnu'), 'pending', 'un état inconnu n’active ni ne clôt rien');
  });

  it('lit l’état d’une collecte même rangée sous une clé, pour qu’un paiement approuvé ne reste jamais sans palier', async () => {
    const agent = await customer('Olga Rangée', 'olga-momo@exemple.com');
    const { body } = await agent.post('/api/billing/mobile/checkout').send({ plan: 'plus', period: 'month', operator: 'mtn', phone: '677000009' }).expect(201);
    // Le prestataire rend désormais la collecte sous « transaction », avec un état en majuscules.
    const flat = collections.get(body.reference)!;
    collections.set(body.reference, { transaction: { ...flat, status: 'SUCCESS' } } as unknown as FakeCollection);
    assert.equal((await agent.get(`/api/billing/mobile/${body.reference}`).expect(200)).body.status, 'paid');
    assert.equal(await planOf(agent), 'plus');
  });
});
