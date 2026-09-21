import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { STRONG_PASSWORD, closeTestApp, createAdmin, createTestApp, signUp } from './support/helpers';

/** Copie des données et suppression du compte par son titulaire. */

let app: Express;

before(async () => {
  app = await createTestApp();
});

after(async () => {
  await closeTestApp();
});

const SECURITY_CODE = 'Mangue-Plantain-2026';

describe('Données personnelles', () => {
  it('remet une copie des données du compte, sans aucun secret', async () => {
    const { agent } = await signUp(app, { name: 'Awa Export', email: 'awa-export@exemple.com' });
    await agent.post('/api/account/niches').send({ name: 'Cuisine camerounaise' }).expect(201);
    await agent.post('/api/account/two-factor/security-code').send({ password: STRONG_PASSWORD, newCode: SECURITY_CODE }).expect(200);

    const response = await agent.get('/api/account/data-export').expect(200);
    assert.match(String(response.headers['content-disposition']), /^attachment; filename="smart-creator-mes-donnees-\d{4}-\d{2}-\d{2}\.json"$/);

    const data = JSON.parse(response.text) as {
      profile: { email: string; savedNiches: string[] };
      security: { securityCode: boolean; events: { type: string }[] };
      connections: unknown[];
    };
    assert.equal(data.profile.email, 'awa-export@exemple.com');
    assert.deepEqual(data.profile.savedNiches, ['Cuisine camerounaise']);
    assert.equal(data.security.securityCode, true);
    assert.ok(data.security.events.some((event) => event.type === 'security_code_set'));
    assert.ok(data.connections.length >= 1, 'historique des connexions inclus');

    for (const secret of ['passwordHash', 'securityCodeHash', 'twoFactorSecret', '$argon2', SECURITY_CODE]) {
      assert.ok(!response.text.includes(secret), `« ${secret} » ne doit pas figurer dans la copie`);
    }

    await request(app).get('/api/account/data-export').expect(401);
  });

  it('supprime le compte après mot de passe, code et confirmation, en gardant la comptabilité', async () => {
    const { agent, account } = await signUp(app, { name: 'Binta Départ', email: 'binta@exemple.com' });
    await agent.post('/api/account/two-factor/security-code').send({ password: STRONG_PASSWORD, newCode: SECURITY_CODE }).expect(200);

    const { getDb } = await import('@server/db/client');
    const { authEvents, payments, users } = await import('@server/db/schema');
    await getDb()
      .insert(payments)
      .values({ userId: account.id, userEmail: 'binta@exemple.com', plan: 'plus', periodMonths: 1, amountFcfa: 4900, method: 'mobile_money', paidAt: new Date() });

    const body = { password: STRONG_PASSWORD, code: SECURITY_CODE, confirmation: 'SUPPRIMER' };
    await agent.delete('/api/account').send({ ...body, confirmation: 'oui' }).expect(400);

    const wrongPassword = await agent.delete('/api/account').send({ ...body, password: 'Mauvais-Mot-De-Passe-9' }).expect(400);
    assert.equal(wrongPassword.body.error.code, 'INVALID_PASSWORD');

    const missingCode = await agent.delete('/api/account').send({ password: STRONG_PASSWORD, confirmation: 'SUPPRIMER' }).expect(403);
    assert.equal(missingCode.body.error.code, 'STEP_UP_FAILED');

    const deleted = await agent.delete('/api/account').send(body).expect(204);
    assert.match(String(deleted.headers['set-cookie']), /sc_session=;/, 'cookie de session effacé');

    const db = getDb();
    assert.equal((await db.select().from(users).where(eq(users.id, account.id))).length, 0);
    assert.equal((await db.select().from(authEvents).where(eq(authEvents.email, 'binta@exemple.com'))).length, 0, 'journal de sécurité effacé');
    const trace = await db.select().from(authEvents).where(eq(authEvents.type, 'account_deleted'));
    assert.equal(trace.length, 1);
    assert.equal(trace[0]!.email, null, 'la trace de suppression ne garde pas l’adresse');

    const kept = await db.select().from(payments).where(eq(payments.userEmail, 'binta@exemple.com'));
    assert.equal(kept.length, 1, 'le paiement reste pour la comptabilité');
    assert.equal(kept[0]!.userId, null);

    await agent.get('/api/account/credits').expect(401);
    // « Compte inexistant », et non « mot de passe incorrect » : la ligne a bien disparu,
    // elle n'a pas seulement été rendue inutilisable.
    const login = await request(app).post('/api/auth/login').send({ email: 'binta@exemple.com', password: STRONG_PASSWORD }).expect(401);
    assert.equal(login.body.error.code, 'ACCOUNT_NOT_FOUND');
  });

  it('refuse de supprimer le dernier administrateur', async () => {
    const first = await createAdmin(app, 'premiere-admin@smartcreator.test');
    const body = { password: STRONG_PASSWORD, confirmation: 'SUPPRIMER' };

    const refused = await first.agent.delete('/api/account').send({ ...body, code: await first.device.next() }).expect(409);
    assert.equal(refused.body.error.code, 'LAST_ADMIN');

    await createAdmin(app, 'seconde-admin@smartcreator.test');
    await first.agent.delete('/api/account').send({ ...body, code: await first.device.next() }).expect(204);
  });
});
