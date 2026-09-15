import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { STRONG_PASSWORD, TotpDevice, closeTestApp, createAdmin, createTestApp, signUp } from './helpers';

let app: Express;
let admin: Awaited<ReturnType<typeof createAdmin>>;
let kwame: Awaited<ReturnType<typeof signUp>>;

before(async () => {
  app = await createTestApp();
  admin = await createAdmin(app);
  kwame = await signUp(app, { name: 'Kwame Mensah', email: 'kwame@exemple.com' });
});

after(closeTestApp);

describe('Administration : lecture', () => {
  it('liste les comptes avec leur palier et montre qui est en ligne', async () => {
    await kwame.agent.get('/api/auth/me').expect(200);

    const list = await admin.agent.get('/api/admin/users').query({ search: 'kwame' }).expect(200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.users[0].plan.id, 'free');
    assert.equal(list.body.users[0].online, true);

    const online = await admin.agent.get('/api/admin/online').expect(200);
    assert.ok(online.body.users.some((entry: { user: { email: string } }) => entry.user.email === 'kwame@exemple.com'));

    const overview = await admin.agent.get('/api/admin/overview').expect(200);
    assert.ok(overview.body.users.total >= 2);
    assert.ok(overview.body.online.users >= 2);
    assert.notEqual(overview.body.revenue, null, 'un administrateur voit les revenus');
    assert.equal(overview.body.plans.find((plan: { id: string }) => plan.id === 'free').users, 1);
  });
});

describe('Administration : crédits, palier et fonctions', () => {
  it('recharge puis retire des points, sans solde négatif, avec trace dans le registre et le journal', async () => {
    const granted = await admin.agent
      .post(`/api/admin/users/${kwame.account.id}/credits`)
      .send({ amount: 50, note: 'Geste commercial après incident' })
      .expect(200);
    assert.equal(granted.body.balance, 53);
    assert.equal(granted.body.user.credits.bonus, 50);

    const removed = await admin.agent
      .post(`/api/admin/users/${kwame.account.id}/credits`)
      .send({ amount: -500, note: 'Correction de saisie' })
      .expect(200);
    assert.equal(removed.body.applied, -50, 'le retrait s’arrête à zéro');
    assert.equal(removed.body.balance, 3);

    const reasons = removed.body.user.ledger.map((entry: { reason: string }) => entry.reason);
    assert.ok(reasons.filter((reason: string) => reason === 'admin_grant').length >= 2);

    await admin.agent.post(`/api/admin/users/${kwame.account.id}/credits`).send({ amount: 0, note: 'rien' }).expect(400);
  });

  it('change le palier en rechargeant le quota, et ouvre ou retire une fonction', async () => {
    const changed = await admin.agent
      .patch(`/api/admin/users/${kwame.account.id}/plan`)
      .send({ plan: 'pro', durationMonths: 1, refillCredits: true, note: 'Essai offert' })
      .expect(200);
    assert.equal(changed.body.user.plan.id, 'pro');
    assert.equal(changed.body.credits.plan, 60);
    assert.ok(changed.body.user.planExpiresAt);

    await admin.agent
      .put(`/api/admin/users/${kwame.account.id}/features`)
      .send({ feature: 'image_generation', access: 'revoked' })
      .expect(200);
    const locked = await kwame.agent.post('/api/creatives/visuals').send({}).expect(403);
    assert.equal(locked.body.error.code, 'FEATURE_LOCKED');

    const reopened = await admin.agent
      .put(`/api/admin/users/${kwame.account.id}/features`)
      .send({ feature: 'video_generation', access: 'revoked' })
      .expect(200);
    const video = reopened.body.features.find((feature: { id: string }) => feature.id === 'video_generation');
    assert.equal(video.planDefault, true);
    assert.equal(video.effective, false, 'accès retiré malgré le palier Pro');

    await admin.agent
      .put(`/api/admin/users/${kwame.account.id}/features`)
      .send({ feature: 'image_generation', access: 'default' })
      .expect(200);
  });
});

describe('Administration : paiements et revenus', () => {
  it('enregistre un paiement Mobile Money qui active le palier et alimente jour, mois et année', async () => {
    const recorded = await admin.agent
      .post('/api/admin/payments')
      .send({ userId: kwame.account.id, plan: 'max', periodMonths: 1, amount: 15_000, currency: 'XAF', method: 'mobile_money', reference: 'OM-2026-0915' })
      .expect(201);
    assert.equal(recorded.body.payment.amountFcfa, 15_000);

    const overview = await admin.agent.get('/api/admin/overview').expect(200);
    assert.equal(overview.body.revenue.today, 15_000);
    assert.equal(overview.body.revenue.month, 15_000);
    assert.equal(overview.body.revenue.year, 15_000);
    assert.equal(overview.body.revenue.monthlyRecurring, 15_000);

    for (const granularity of ['day', 'month', 'year']) {
      const series = await admin.agent.get('/api/admin/revenue').query({ granularity }).expect(200);
      assert.equal(series.body.points.at(-1).amount, 15_000, `dernière période (${granularity})`);
      assert.equal(series.body.total, 15_000);
    }

    const detail = await admin.agent.get(`/api/admin/users/${kwame.account.id}`).expect(200);
    assert.equal(detail.body.user.plan.id, 'max');
    assert.equal(detail.body.payments.length, 1);

    await admin.agent
      .post(`/api/admin/payments/${recorded.body.payment.id}/refund`)
      .send({ note: 'Double paiement' })
      .expect(200);
    const afterRefund = await admin.agent.get('/api/admin/overview').expect(200);
    assert.equal(afterRefund.body.revenue.today, 0);
    await admin.agent.post(`/api/admin/payments/${recorded.body.payment.id}/refund`).send({ note: 'Encore' }).expect(409);
  });
});

describe('Administration : privilèges délégués', () => {
  it('exige un code frais, force la reconnexion et limite le membre à ce qui lui est ouvert', async () => {
    const aicha = await signUp(app, { name: 'Aïcha Sow', email: 'aicha@exemple.com' });

    const refused = await admin.agent
      .put(`/api/admin/users/${aicha.account.id}/permissions`)
      .send({ permissions: ['admin.users.read', 'admin.credits.grant'], confirmationCode: '000000' })
      .expect(403);
    assert.equal(refused.body.error.code, 'STEP_UP_FAILED');

    const granted = await admin.agent
      .put(`/api/admin/users/${aicha.account.id}/permissions`)
      .send({ permissions: ['admin.users.read', 'admin.credits.grant'], confirmationCode: await admin.device.next() })
      .expect(200);
    assert.deepEqual([...granted.body.permissions.granted].sort(), ['admin.credits.grant', 'admin.users.read']);
    assert.equal((await aicha.agent.get('/api/auth/me')).body.account, null, 'sessions du membre fermées');

    await aicha.agent.post('/api/auth/login').send({ email: 'aicha@exemple.com', password: STRONG_PASSWORD }).expect(200);
    const needs2fa = await aicha.agent.get('/api/admin/users').expect(403);
    assert.equal(needs2fa.body.error.code, 'TWO_FACTOR_REQUIRED');

    const setup = await aicha.agent.post('/api/account/two-factor/setup').expect(200);
    const device = new TotpDevice(setup.body.secret);
    await aicha.agent.post('/api/account/two-factor/enable').send({ code: await device.next() }).expect(200);

    await aicha.agent.get('/api/admin/users').expect(200);
    assert.equal((await aicha.agent.get('/api/admin/revenue').expect(403)).body.error.code, 'FORBIDDEN');
    await aicha.agent.post(`/api/admin/users/${kwame.account.id}/credits`).send({ amount: 10, note: 'Recharge par l’équipe' }).expect(200);
    await aicha.agent.post(`/api/admin/users/${admin.user.id}/credits`).send({ amount: 10, note: 'Vers un admin' }).expect(403);
    await aicha.agent.post(`/api/admin/users/${aicha.account.id}/credits`).send({ amount: 10, note: 'Pour moi-même' }).expect(403);

    const cannotDelegate = await aicha.agent
      .put(`/api/admin/users/${kwame.account.id}/permissions`)
      .send({ permissions: ['admin.revenue.read'], confirmationCode: await device.next() })
      .expect(403);
    assert.equal(cannotDelegate.body.error.code, 'FORBIDDEN');

    const staffList = await admin.agent.get('/api/admin/users').query({ role: 'staff' }).expect(200);
    assert.ok(staffList.body.users.some((user: { email: string }) => user.email === 'aicha@exemple.com'));
  });

  it('promeut un administrateur avec code, mais personne ne change son propre rôle', async () => {
    const yao = await signUp(app, { name: 'Yao Kouassi', email: 'yao@exemple.com' });
    const promoted = await admin.agent
      .patch(`/api/admin/users/${yao.account.id}/role`)
      .send({ role: 'admin', confirmationCode: await admin.device.next() })
      .expect(200);
    assert.equal(promoted.body.user.role, 'admin');
    const { PERMISSION_IDS } = await import('@server/services/auth/permissions');
    assert.equal(promoted.body.permissions.effective.length, PERMISSION_IDS.length, 'un administrateur détient tous les privilèges');

    const self = await admin.agent
      .patch(`/api/admin/users/${admin.user.id}/role`)
      .send({ role: 'user', confirmationCode: '123456' })
      .expect(403);
    assert.equal(self.body.error.code, 'SELF_ACTION_FORBIDDEN');
  });
});

describe('Administration : suspension, liens et journal', () => {
  it('suspend un compte : sessions fermées, connexion refusée, puis réactivation', async () => {
    await admin.agent
      .post(`/api/admin/users/${kwame.account.id}/status`)
      .send({ status: 'suspended', reason: 'Partage de compte' })
      .expect(200);
    assert.equal((await kwame.agent.get('/api/auth/me')).body.account, null);

    const login = await request(app).post('/api/auth/login').send({ email: 'kwame@exemple.com', password: STRONG_PASSWORD }).expect(403);
    assert.equal(login.body.error.code, 'ACCOUNT_SUSPENDED');

    await admin.agent.post(`/api/admin/users/${kwame.account.id}/status`).send({ status: 'active' }).expect(200);
    await request(app).post('/api/auth/login').send({ email: 'kwame@exemple.com', password: STRONG_PASSWORD }).expect(200);

    const self = await admin.agent
      .post(`/api/admin/users/${admin.user.id}/status`)
      .send({ status: 'suspended', reason: 'Test' })
      .expect(403);
    assert.equal(self.body.error.code, 'SELF_ACTION_FORBIDDEN');
  });

  it('crée un lien de réinitialisation et garde la trace de chaque action', async () => {
    const link = await admin.agent.post(`/api/admin/users/${kwame.account.id}/password-link`).expect(200);
    assert.equal(link.body.purpose, 'reset');
    assert.match(link.body.url, /\/mot-de-passe#.{40,}/);

    const audit = await admin.agent.get('/api/admin/audit').query({ pageSize: 100 }).expect(200);
    const actions = new Set(audit.body.entries.map((entry: { action: string }) => entry.action));
    for (const action of [
      'credits.granted',
      'credits.removed',
      'user.plan_changed',
      'feature.revoked',
      'payment.recorded',
      'payment.refunded',
      'permissions.updated',
      'role.changed',
      'user.suspended',
      'user.reactivated',
      'password.link_created',
    ]) {
      assert.ok(actions.has(action), `journal : ${action}`);
    }

    const events = await admin.agent.get('/api/admin/security/events').expect(200);
    assert.ok(events.body.total > 0);
  });
});
