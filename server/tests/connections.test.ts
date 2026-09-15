import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { STRONG_PASSWORD, closeTestApp, createAdmin, createTestApp, signUp } from './helpers';

let app: Express;

before(async () => {
  app = await createTestApp();
});

after(closeTestApp);

interface Connection {
  id: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  endLabel: string;
  open: boolean;
  online: boolean;
  durationSeconds: number;
}

describe('Historique des connexions', () => {
  it('garde l’heure de connexion et de déconnexion, visible par l’administration seulement', async () => {
    const admin = await createAdmin(app, 'admin-connexions@smartcreator.test');
    const member = await signUp(app, { name: 'Awa Ndiaye', email: 'awa@exemple.com' });

    await member.agent.post('/api/auth/logout').expect(204);
    await member.agent.post('/api/auth/login').send({ email: 'awa@exemple.com', password: STRONG_PASSWORD }).expect(200);

    const refused = await member.agent.get('/api/admin/connections').expect(403);
    assert.equal(refused.body.error.code, 'FORBIDDEN');

    const list = await admin.agent.get(`/api/admin/connections?userId=${member.account.id}`).expect(200);
    const entries = list.body.entries as Connection[];
    assert.equal(entries.length, 2, 'l’inscription puis la reconnexion');

    const [current, first] = entries as [Connection, Connection];
    assert.equal(current.open, true);
    assert.equal(current.online, true);
    assert.equal(current.endedAt, null);
    assert.equal(first.open, false);
    assert.equal(first.endReason, 'logout');
    assert.equal(first.endLabel, 'Déconnexion');
    assert.ok(new Date(first.endedAt!).getTime() >= new Date(first.startedAt).getTime());

    assert.equal(list.body.filterUser.email, 'awa@exemple.com');
    assert.ok(list.body.summary.activeToday >= 2, 'l’administratrice et le membre');
    assert.equal(JSON.stringify(list.body).includes('sessionId'), false, 'aucune empreinte de session ne sort');

    const detail = await admin.agent.get(`/api/admin/users/${member.account.id}`).expect(200);
    assert.equal(detail.body.connections.length, 2);
    assert.equal(detail.body.user.online, true);
  });

  it('ferme tout de suite les sessions d’un compte bloqué, avec la raison', async () => {
    const admin = await createAdmin(app, 'admin-blocage@smartcreator.test');
    const member = await signUp(app, { name: 'Koffi Mensah', email: 'koffi@exemple.com' });

    await admin.agent
      .post(`/api/admin/users/${member.account.id}/status`)
      .send({ status: 'suspended', reason: 'Fraude au paiement' })
      .expect(200);

    const me = await member.agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.account, null, 'la session du compte bloqué ne sert plus');
    const login = await member.agent.post('/api/auth/login').send({ email: 'koffi@exemple.com', password: STRONG_PASSWORD }).expect(403);
    assert.equal(login.body.error.code, 'ACCOUNT_SUSPENDED');

    const list = await admin.agent.get(`/api/admin/connections?userId=${member.account.id}`).expect(200);
    const [entry] = list.body.entries as Connection[];
    assert.equal(entry?.open, false);
    assert.equal(entry?.endReason, 'suspended');
  });

  it('clôt une session abandonnée à l’heure de la dernière activité', async () => {
    const admin = await createAdmin(app, 'admin-inactivite@smartcreator.test');
    const member = await signUp(app, { name: 'Fatou Sow', email: 'fatou@exemple.com' });

    const { eq } = await import('drizzle-orm');
    const { getDb } = await import('@server/db/client');
    const { sessionHistory, sessions } = await import('@server/db/schema');
    const { sweepSessions } = await import('@server/services/auth/sessions');

    // Onglet fermé il y a 8 jours, sans déconnexion : au-delà des 7 jours d'inactivité d'un membre.
    const lastSeen = new Date(Date.now() - 8 * 86_400_000);
    await getDb().update(sessions).set({ lastSeenAt: lastSeen }).where(eq(sessions.userId, member.account.id));
    await getDb().update(sessionHistory).set({ lastSeenAt: lastSeen }).where(eq(sessionHistory.userId, member.account.id));

    const swept = await sweepSessions();
    assert.ok(swept.ended >= 1);

    const list = await admin.agent.get(`/api/admin/connections?userId=${member.account.id}`).expect(200);
    const [entry] = list.body.entries as Connection[];
    assert.equal(entry?.endReason, 'idle');
    assert.equal(new Date(entry!.endedAt!).getTime(), lastSeen.getTime(), 'déconnexion à la dernière activité');

    const me = await member.agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.account, null);
  });

  it('applique sans reconnexion un accès donné à un compte connecté, et compte les points utilisés', async () => {
    const admin = await createAdmin(app, 'admin-acces@smartcreator.test');
    const member = await signUp(app, { name: 'Ibrahim Keita', email: 'ibrahim@exemple.com' });

    const before = await member.agent.get('/api/auth/me').expect(200);
    assert.equal(before.body.account.features.video_generation, false, 'fermé au palier Gratuit');

    await admin.agent
      .put(`/api/admin/users/${member.account.id}/features`)
      .send({ feature: 'video_generation', access: 'granted' })
      .expect(200);
    const granted = await member.agent.get('/api/auth/me').expect(200);
    assert.equal(granted.body.account.features.video_generation, true, 'ouvert dès la requête suivante');

    const { debitCredits } = await import('@server/services/accounts');
    await debitCredits({ userId: member.account.id, cost: 2, actionId: 'image_generation', unlimited: false });

    const detail = await admin.agent.get(`/api/admin/users/${member.account.id}`).expect(200);
    assert.deepEqual(detail.body.creditsUsed, { cycle: 2, last30d: 2, total: 2, actions: 1 });
    assert.equal(detail.body.credits.total, 1, '3 points du palier Gratuit, 2 utilisés');

    const users = await admin.agent.get('/api/admin/users?search=ibrahim').expect(200);
    assert.equal(users.body.users[0].creditsUsed30d, 2);

    const overview = await admin.agent.get('/api/admin/overview').expect(200);
    assert.ok(overview.body.online.active7d >= 2);
    assert.ok(overview.body.online.active30d >= overview.body.online.active7d);
  });
});
