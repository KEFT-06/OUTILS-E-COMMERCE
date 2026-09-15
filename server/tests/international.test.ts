import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { STRONG_PASSWORD, closeTestApp, createTestApp, signUp } from './helpers';

let app: Express;

before(async () => {
  app = await createTestApp();
});

after(closeTestApp);

const SECURITY_CODE = 'Mangue-Plantain-2026';

/** Administrateur protégé par un code de sécurité, sans application d'authentification. */
async function adminWithSecurityCode(email: string) {
  const { createUserRecord } = await import('@server/services/accounts');
  const { hashPassword } = await import('@server/services/auth/password');
  await createUserRecord({
    name: 'Administratrice Code',
    email,
    passwordHash: await hashPassword(STRONG_PASSWORD),
    role: 'admin',
    plan: 'elite',
    country: 'CM',
  });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD }).expect(200);
  await agent.post('/api/account/two-factor/security-code').send({ password: STRONG_PASSWORD, newCode: SECURITY_CODE }).expect(200);
  return { agent };
}

type PlanBody = { id: string; price: { currency: string; monthly: number; yearly: number; converted: boolean } | null };
const planOf = (body: { plans: PlanBody[] }, id: string) => body.plans.find((plan) => plan.id === id)!;

describe('Code de sécurité', () => {
  it('protège la connexion : le mot de passe, puis le code', async () => {
    const { agent } = await signUp(app, { name: 'Aïcha Diallo', email: 'aicha@exemple.com' });

    await agent.post('/api/account/two-factor/security-code').send({ password: STRONG_PASSWORD, newCode: '1111' }).expect(400);
    const same = await agent
      .post('/api/account/two-factor/security-code')
      .send({ password: STRONG_PASSWORD, newCode: STRONG_PASSWORD })
      .expect(400);
    assert.equal(same.body.error.code, 'WEAK_SECURITY_CODE', 'le code ne peut pas être le mot de passe');

    const set = await agent
      .post('/api/account/two-factor/security-code')
      .send({ password: STRONG_PASSWORD, newCode: SECURITY_CODE })
      .expect(200);
    assert.deepEqual(set.body.account.twoFactor.methods, { app: false, code: true });
    assert.equal(set.body.account.twoFactor.sessionVerified, true);
    assert.equal(JSON.stringify(set.body).includes('argon2'), false, 'aucune empreinte ne part au navigateur');

    // Remplacer le code exige le code actuel.
    await agent
      .post('/api/account/two-factor/security-code')
      .send({ password: STRONG_PASSWORD, newCode: 'Baobab-Soleil-Code' })
      .expect(403);

    await agent.post('/api/auth/logout').expect(204);
    const login = await agent.post('/api/auth/login').send({ email: 'aicha@exemple.com', password: STRONG_PASSWORD }).expect(200);
    assert.equal(login.body.mfaRequired, true);
    assert.deepEqual(login.body.methods, { app: false, code: true });
    assert.equal(login.body.account, undefined, 'aucun compte avant le code');

    const wrong = await agent.post('/api/auth/login/mfa').send({ code: 'Mangue-Plantain-2025' }).expect(401);
    assert.equal(wrong.body.error.code, 'INVALID_MFA_CODE');
    const verified = await agent.post('/api/auth/login/mfa').send({ code: SECURITY_CODE }).expect(200);
    assert.equal(verified.body.account.email, 'aicha@exemple.com');
  });

  it('ouvre l’administration sans application et confirme les actions sensibles avec le code', async () => {
    const admin = await adminWithSecurityCode('admin-code@smartcreator.test');
    await admin.agent.get('/api/admin/overview').expect(200);

    const target = await signUp(app, { name: 'Moussa Traoré', email: 'moussa@exemple.com' });
    await target.agent
      .post('/api/account/two-factor/security-code')
      .send({ password: STRONG_PASSWORD, newCode: 'Code-De-Moussa-42' })
      .expect(200);

    const refused = await admin.agent
      .post(`/api/admin/users/${target.account.id}/two-factor/reset`)
      .send({ confirmationCode: 'pas-le-bon-code' })
      .expect(403);
    assert.equal(refused.body.error.code, 'STEP_UP_FAILED');

    await admin.agent
      .post(`/api/admin/users/${target.account.id}/two-factor/reset`)
      .send({ confirmationCode: SECURITY_CODE })
      .expect(200);
    const detail = await admin.agent.get(`/api/admin/users/${target.account.id}`).expect(200);
    assert.equal(detail.body.user.twoFactorEnabled, false);

    const removal = await admin.agent
      .post('/api/account/two-factor/security-code/remove')
      .send({ password: STRONG_PASSWORD, code: SECURITY_CODE })
      .expect(403);
    assert.equal(removal.body.error.code, 'MFA_REQUIRED_FOR_STAFF', 'un administrateur garde toujours un second facteur');
  });

  it('bloque la confirmation après cinq codes faux, même contre le bon code', async () => {
    const admin = await adminWithSecurityCode('admin-verrou@smartcreator.test');
    const target = await signUp(app, { name: 'Fatou Ndiaye', email: 'fatou@exemple.com' });
    const reset = (confirmationCode: string) =>
      admin.agent.post(`/api/admin/users/${target.account.id}/two-factor/reset`).send({ confirmationCode });

    for (let attempt = 1; attempt <= 4; attempt += 1) await reset(`mauvais-code-${attempt}`).expect(403);
    await reset('mauvais-code-5').expect(429);
    const locked = await reset(SECURITY_CODE).expect(429);
    assert.equal(locked.body.error.code, 'TOO_MANY_ATTEMPTS');
  });
});

describe('Niches enregistrées', () => {
  it('limite le nombre de niches au palier, sans doublon', async () => {
    const { agent } = await signUp(app, { name: 'Koffi Mensah', email: 'koffi@exemple.com' });
    const me = await agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.account.limits.savedNiches, 3, 'palier Gratuit : 3 niches');

    for (const name of ['Élevage de poulets de chair', 'Énergie solaire domestique', 'Cosmétiques naturels au karité']) {
      await agent.post('/api/account/niches').send({ name }).expect(201);
    }
    const duplicate = await agent.post('/api/account/niches').send({ name: 'énergie SOLAIRE domestique' }).expect(201);
    assert.equal(duplicate.body.account.savedNiches.length, 3);

    const refused = await agent.post('/api/account/niches').send({ name: 'Exploitation minière artisanale' }).expect(403);
    assert.equal(refused.body.error.code, 'NICHE_LIMIT_REACHED');

    await agent.post('/api/account/niches/remove').send({ name: 'Énergie solaire domestique' }).expect(200);
    const added = await agent.post('/api/account/niches').send({ name: 'Exploitation minière artisanale' }).expect(201);
    assert.equal(added.body.account.savedNiches.length, 3);
  });
});

describe('International : pays, devises et prix', () => {
  it('affiche chaque palier dans la devise du pays', async () => {
    const cameroon = await request(app).get('/api/plans').query({ country: 'CM' }).expect(200);
    assert.equal(cameroon.body.currency, 'XAF');
    assert.deepEqual(planOf(cameroon.body, 'plus').price, { currency: 'XAF', monthly: 4900, yearly: 49_000, converted: false });
    assert.equal(planOf(cameroon.body, 'free').price!.monthly, 0);

    const france = await request(app).get('/api/plans').query({ country: 'FR' }).expect(200);
    assert.equal(planOf(france.body, 'plus').price!.monthly, 7.99);

    const usa = await request(app).get('/api/plans').query({ country: 'US' }).expect(200);
    const dollars = planOf(usa.body, 'plus').price!;
    assert.equal(dollars.currency, 'USD');
    assert.equal(dollars.converted, true);
    assert.match(String(dollars.monthly), /\.99$/);

    const nigeria = await request(app).get('/api/plans').query({ country: 'NG' }).expect(200);
    const naira = planOf(nigeria.body, 'pro').price!;
    assert.equal(naira.currency, 'NGN');
    assert.ok(Number.isInteger(naira.monthly) && naira.monthly % 100 === 0, `prix arrondi : ${naira.monthly}`);
  });

  it('enregistre le pays à l’inscription, et la devise suit le pays', async () => {
    const agent = request.agent(app);
    const created = await agent
      .post('/api/auth/signup')
      .send({ name: 'Awa Sow', email: 'awa@exemple.com', password: STRONG_PASSWORD, country: 'sn' })
      .expect(201);
    assert.equal(created.body.account.country, 'SN');
    assert.equal(created.body.account.currency, 'XOF');

    const moved = await agent.patch('/api/account/profile').send({ country: 'US' }).expect(200);
    assert.equal(moved.body.account.currency, 'USD');
    await agent.patch('/api/account/profile').send({ country: 'ZZ' }).expect(400);

    const plans = await agent.get('/api/plans').expect(200);
    assert.equal(plans.body.currency, 'USD', 'sans paramètre : la devise du compte');
  });

  it('convertit un paiement en devise étrangère en francs CFA pour les revenus', async () => {
    const admin = await adminWithSecurityCode('admin-devises@smartcreator.test');
    const customer = await signUp(app, { name: 'John Carter', email: 'john@exemple.com' });
    const fallback = JSON.parse(await readFile('server/config/exchange-rates.json', 'utf8')) as { rates: Record<string, number> };

    const recorded = await admin.agent
      .post('/api/admin/payments')
      .send({ userId: customer.account.id, plan: 'pro', periodMonths: 1, amount: 16.99, currency: 'usd', method: 'card' })
      .expect(201);
    assert.equal(recorded.body.payment.currency, 'USD');
    assert.equal(recorded.body.payment.amount, 16.99);
    assert.equal(recorded.body.payment.amountFcfa, Math.round((16.99 / fallback.rates.USD!) * 655.957));

    const overview = await admin.agent.get('/api/admin/overview').expect(200);
    assert.equal(overview.body.revenue.today, recorded.body.payment.amountFcfa);

    await admin.agent
      .post('/api/admin/payments')
      .send({ userId: customer.account.id, plan: 'pro', periodMonths: 1, amount: 10, currency: 'ABC', method: 'card' })
      .expect(400);
  });
});

describe('Méthodes publicitaires', () => {
  it('refuse côté serveur une méthode hors du palier', async () => {
    const { agent } = await signUp(app, { name: 'Ibrahim Keita', email: 'ibrahim@exemple.com' });
    const me = await agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.account.limits.adFrameworks, 2);

    const locked = await agent
      .post('/api/creatives/visuals')
      .send({
        productName: 'Guide du potager urbain',
        awarenessLevel: 'problem_aware',
        format: '9:16',
        market: 'BR',
        sceneDescription: 'une famille cultive des tomates sur un balcon',
        purpose: 'ad',
        adFramework: 'pastor',
      })
      .expect(403);
    assert.equal(locked.body.error.code, 'FRAMEWORK_LOCKED');
  });

  it('structure la consigne vidéo étape par étape, sans jamais perdre les garde-fous', async () => {
    const { buildVideoInput, videoBriefSchema } = await import('@server/services/creatives');
    const brief = videoBriefSchema.parse({
      productName: 'Formation Excel',
      awarenessLevel: 'solution_aware',
      format: '9:16',
      market: 'US',
      sceneDescription: 'x'.repeat(1500),
      duration: 10,
      purpose: 'ad',
      adFramework: 'aida',
      frameworkBeats: ['Une question : vos tableaux vous font perdre des heures ?'],
    });

    const { prompt } = buildVideoInput(brief);
    assert.ok(prompt.length <= 2500, `consigne de ${prompt.length} caractères`);
    assert.match(prompt, /structure: AIDA/);
    assert.match(prompt, /1\. Attention \(0–2\.5 s\): Une question/);
    assert.match(prompt, /4\. Action \(7\.5–10 s\)/);
    assert.match(prompt, /United States/);
    assert.match(prompt, /No real brand logos/);
  });
});
