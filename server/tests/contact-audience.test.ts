import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { closeTestApp, createAdmin, createTestApp, signUp } from './support/helpers';

/** Page Contact et mesure d'audience sans cookie. */

let app: Express;

before(async () => {
  app = await createTestApp();
});

after(async () => {
  await closeTestApp();
});

interface MessageEntry {
  id: string;
  userId: string | null;
  email: string;
  topicLabel: string;
  status: string;
}

describe('Page Contact', () => {
  it('reçoit les messages, écarte les robots et ne les montre qu’à l’administration', async () => {
    await request(app)
      .post('/api/contact')
      .send({ name: 'Visiteuse Anonyme', email: 'visiteuse@exemple.com', topic: 'question', message: 'Bonjour, proposez-vous des factures ?' })
      .expect(201);
    await request(app)
      .post('/api/contact')
      .send({ name: 'Robot Pressé', email: 'robot@exemple.com', topic: 'other', message: 'Achetez nos liens maintenant', website: 'https://spam.example' })
      .expect(201);
    await request(app).post('/api/contact').send({ name: 'Trop Court', email: 'court@exemple.com', topic: 'bug', message: 'Salut' }).expect(400);

    const { agent: member } = await signUp(app, { name: 'Membre Connecté', email: 'membre-contact@exemple.com' });
    await member
      .post('/api/contact')
      .send({ name: 'Membre Connecté', email: 'membre-contact@exemple.com', topic: 'data', message: 'Je souhaite une copie de mes données.' })
      .expect(201);
    await member.get('/api/admin/messages').expect(403);

    const { agent: admin } = await createAdmin(app);
    const list = await admin.get('/api/admin/messages').expect(200);
    assert.equal(list.body.total, 2, 'le message du robot n’est pas gardé');
    assert.equal(list.body.counts.new, 2);

    const fromMember = (list.body.entries as MessageEntry[]).find((entry) => entry.email === 'membre-contact@exemple.com')!;
    assert.ok(fromMember.userId, 'message relié au compte connecté');
    assert.equal(fromMember.topicLabel, 'Mes données personnelles');

    await admin.post(`/api/admin/messages/${fromMember.id}/status`).send({ status: 'read' }).expect(204);
    assert.equal((await admin.get('/api/admin/messages?status=new').expect(200)).body.total, 1);
    await admin.post('/api/admin/messages/pas-un-identifiant/status').send({ status: 'read' }).expect(404);

    const exported = JSON.parse((await member.get('/api/account/data-export').expect(200)).text) as { contactMessages: unknown[] };
    assert.equal(exported.contactMessages.length, 1, 'le message figure dans la copie des données');
  });
});

describe('Audience du site', () => {
  it('compte visites et visiteurs sans cookie, sans robots, sans refus de suivi ni pages privées', async () => {
    const computer = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0';
    const phone = 'Mozilla/5.0 (Linux; Android 14) Mobile Chrome/130.0';
    const visit = (body: object, userAgent: string, headers: Record<string, string> = {}) =>
      request(app).post('/api/audience/visit').set('User-Agent', userAgent).set(headers).send(body).expect(204);

    const first = await visit({ path: '/', referrer: 'https://www.google.com/search?q=smart+creator' }, computer);
    assert.equal(first.headers['set-cookie'], undefined, 'aucun cookie déposé');
    await visit({ path: '/connexion', referrer: 'http://localhost:5173/' }, computer);
    await visit({ path: '/' }, phone);
    await visit({ path: '/' }, 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
    await visit({ path: '/' }, computer, { DNT: '1' });
    await visit({ path: '/' }, phone, { 'Sec-GPC': '1' });
    await visit({ path: '/app/admin' }, computer);

    const { agent: admin } = await createAdmin(app, 'audience-admin@smartcreator.test');
    const summary = (await admin.get('/api/admin/audience').expect(200)).body as {
      totals: { visits: number; uniques: number; signups: number; conversionPercent: number | null };
      daily: unknown[];
      pages: { path: string; visits: number }[];
      referrers: { host: string | null; visits: number }[];
    };

    assert.equal(summary.totals.visits, 3);
    assert.equal(summary.totals.uniques, 2, 'même appareil compté une fois');
    assert.ok(summary.totals.signups >= 1);
    assert.equal(summary.daily.length, 30);
    assert.deepEqual(summary.pages[0], { path: '/', label: 'Accueil', visits: 2 });
    assert.equal(summary.referrers.find((entry) => entry.host === 'google.com')?.visits, 1);
    assert.equal(summary.referrers.find((entry) => entry.host === null)?.visits, 2, 'accès direct et navigation interne');

    const { agent: member } = await signUp(app, { name: 'Curieux Audience', email: 'curieux-audience@exemple.com' });
    await member.get('/api/admin/audience').expect(403);
  });
});
