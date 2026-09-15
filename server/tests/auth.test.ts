import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { STRONG_PASSWORD, TotpDevice, closeTestApp, createAdmin, createTestApp, signUp } from './helpers';

let app: Express;

before(async () => {
  app = await createTestApp();
});

after(closeTestApp);

describe('Inscription et session', () => {
  it('crée le compte en base, ouvre une session httpOnly SameSite=Strict et ne renvoie aucun secret', async () => {
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Awa Traoré', email: 'Awa@Exemple.com', password: STRONG_PASSWORD })
      .expect(201);

    const cookie = String(response.headers['set-cookie']);
    assert.match(cookie, /sc_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);

    const { account } = response.body;
    assert.equal(account.email, 'awa@exemple.com', 'adresse normalisée');
    assert.equal(account.plan.id, 'free');
    assert.equal(account.credits.total, 3);
    const serialized = JSON.stringify(response.body);
    assert.doesNotMatch(serialized, /argon2|password|secret/i);
  });

  it('refuse un mot de passe faible et une adresse déjà inscrite', async () => {
    const weak = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Kofi', email: 'kofi@exemple.com', password: 'motdepasse123' })
      .expect(400);
    assert.equal(weak.body.error.code, 'WEAK_PASSWORD');

    const taken = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Awa bis', email: 'awa@exemple.com', password: STRONG_PASSWORD })
      .expect(409);
    assert.equal(taken.body.error.code, 'EMAIL_TAKEN');
  });

  it('répond « aucun compte » sans session, puis déconnecte réellement', async () => {
    const anonymous = await request(app).get('/api/auth/me').expect(200);
    assert.equal(anonymous.body.account, null);

    const { agent } = await signUp(app, { name: 'Moussa Diallo', email: 'moussa@exemple.com' });
    assert.notEqual((await agent.get('/api/auth/me').expect(200)).body.account, null);
    await agent.post('/api/auth/logout').expect(204);
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account, null);
  });

  it('protège les routes de génération et d’administration', async () => {
    const unauthenticated = await request(app).get('/api/admin/overview').expect(401);
    assert.equal(unauthenticated.body.error.code, 'AUTH_REQUIRED');

    const { agent } = await signUp(app, { name: 'Fatou Ndiaye', email: 'fatou@exemple.com' });
    const forbidden = await agent.get('/api/admin/overview').expect(403);
    assert.equal(forbidden.body.error.code, 'FORBIDDEN');

    await request(app).get('/api/marketplaces').expect(401);
    await request(app).post('/api/creatives/visuals').send({}).expect(401);
  });
});

describe('Force brute', () => {
  it('verrouille une adresse au 5e échec, même contre le bon mot de passe ensuite', async () => {
    await signUp(app, { name: 'Ibrahim Koné', email: 'ibrahim@exemple.com' });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await request(app).post('/api/auth/login').send({ email: 'ibrahim@exemple.com', password: 'Mauvais-Mot-De-Passe-1' });
      assert.equal(response.status, 401, `tentative ${attempt}`);
      assert.equal(response.body.error.code, 'INVALID_CREDENTIALS');
    }

    const locked = await request(app).post('/api/auth/login').send({ email: 'ibrahim@exemple.com', password: 'Mauvais-Mot-De-Passe-1' });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'TOO_MANY_ATTEMPTS');
    assert.ok(Number(locked.headers['retry-after']) > 0);

    const correctButLocked = await request(app).post('/api/auth/login').send({ email: 'ibrahim@exemple.com', password: STRONG_PASSWORD });
    assert.equal(correctButLocked.status, 429, 'le bon mot de passe ne lève pas le verrou');
  });

  it('répond exactement pareil pour une adresse inconnue : aucune énumération des comptes', async () => {
    const known = await signUp(app, { name: 'Chantal Mbarga', email: 'chantal@exemple.com' });
    await known.agent.post('/api/auth/logout').expect(204);

    const wrongKnown = await request(app).post('/api/auth/login').send({ email: 'chantal@exemple.com', password: 'Mauvais-Mot-De-Passe-2' });
    const wrongUnknown = await request(app).post('/api/auth/login').send({ email: 'personne@exemple.com', password: 'Mauvais-Mot-De-Passe-2' });
    assert.equal(wrongKnown.status, wrongUnknown.status);
    assert.deepEqual(wrongKnown.body, wrongUnknown.body);

    for (let attempt = 2; attempt <= 4; attempt += 1) {
      await request(app).post('/api/auth/login').send({ email: 'personne@exemple.com', password: 'Mauvais-Mot-De-Passe-2' }).expect(401);
    }
    await request(app).post('/api/auth/login').send({ email: 'personne@exemple.com', password: 'Mauvais-Mot-De-Passe-2' }).expect(429);
  });

  it('journalise les échecs pour l’administration', async () => {
    const { getDb } = await import('@server/db/client');
    const { authEvents } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const failures = await getDb().select().from(authEvents).where(eq(authEvents.type, 'login_failure'));
    assert.ok(failures.length >= 8);
  });
});

describe('Double authentification', () => {
  it('interdit l’administration sans double authentification, puis l’exige à chaque connexion', async () => {
    const { createUserRecord } = await import('@server/services/accounts');
    const { hashPassword } = await import('@server/services/auth/password');
    await createUserRecord({
      name: 'Admin Sans 2FA',
      email: 'admin2fa@exemple.com',
      passwordHash: await hashPassword(STRONG_PASSWORD),
      role: 'admin',
      plan: 'elite',
    });

    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'admin2fa@exemple.com', password: STRONG_PASSWORD }).expect(200);
    const blocked = await agent.get('/api/admin/overview').expect(403);
    assert.equal(blocked.body.error.code, 'TWO_FACTOR_REQUIRED');

    const setup = await agent.post('/api/account/two-factor/setup').expect(200);
    assert.match(setup.body.qrSvg, /^<svg/);
    assert.match(setup.body.otpauthUri, /^otpauth:\/\/totp\//);
    const device = new TotpDevice(setup.body.secret);

    await agent.post('/api/account/two-factor/enable').send({ code: '000000' }).expect(400);
    const enabled = await agent.post('/api/account/two-factor/enable').send({ code: await device.next() }).expect(200);
    assert.equal(enabled.body.recoveryCodes.length, 10);
    await agent.get('/api/admin/overview').expect(200);

    await agent.post('/api/auth/logout').expect(204);
    const login = await agent.post('/api/auth/login').send({ email: 'admin2fa@exemple.com', password: STRONG_PASSWORD }).expect(200);
    assert.equal(login.body.mfaRequired, true);
    assert.equal((await agent.get('/api/auth/me')).body.account, null, 'pas de session avant le code');

    const wrong = await agent.post('/api/auth/login/mfa').send({ code: '123456' }).expect(401);
    assert.equal(wrong.body.error.code, 'INVALID_MFA_CODE');

    await agent.post('/api/auth/login/mfa').send({ code: await device.next() }).expect(200);
    await agent.get('/api/admin/overview').expect(200);

    // Un code de secours ne sert qu'une fois.
    const recovery = enabled.body.recoveryCodes[0] as string;
    await agent.post('/api/auth/logout').expect(204);
    await agent.post('/api/auth/login').send({ email: 'admin2fa@exemple.com', password: STRONG_PASSWORD }).expect(200);
    await agent.post('/api/auth/login/mfa').send({ code: recovery }).expect(200);
    await agent.post('/api/auth/logout').expect(204);
    await agent.post('/api/auth/login').send({ email: 'admin2fa@exemple.com', password: STRONG_PASSWORD }).expect(200);
    await agent.post('/api/auth/login/mfa').send({ code: recovery }).expect(401);
  });
});

describe('Lien de mot de passe à usage unique', () => {
  it('définit le mot de passe une seule fois et ferme les sessions existantes', async () => {
    const { agent: adminAgent } = await createAdmin(app, 'liens@smartcreator.test');
    const created = await adminAgent
      .post('/api/admin/users')
      .send({ name: 'Nadia Benali', email: 'nadia@exemple.com', plan: 'plus' })
      .expect(201);

    const url = created.body.setupLink.url as string;
    assert.match(url, /\/mot-de-passe#/);
    const token = url.split('#')[1]!;

    const inspected = await request(app).post('/api/auth/password-token/inspect').send({ token }).expect(200);
    assert.equal(inspected.body.email, 'nadia@exemple.com');
    assert.equal(inspected.body.purpose, 'setup');

    await request(app).post('/api/auth/password-token/consume').send({ token, password: 'court' }).expect(400);
    await request(app).post('/api/auth/password-token/consume').send({ token, password: STRONG_PASSWORD }).expect(204);
    const reused = await request(app).post('/api/auth/password-token/consume').send({ token, password: STRONG_PASSWORD }).expect(404);
    assert.equal(reused.body.error.code, 'TOKEN_INVALID');

    const login = await request(app).post('/api/auth/login').send({ email: 'nadia@exemple.com', password: STRONG_PASSWORD }).expect(200);
    assert.equal(login.body.account.plan.id, 'plus');
  });
});
