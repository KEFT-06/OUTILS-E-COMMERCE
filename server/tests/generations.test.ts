import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { STRONG_PASSWORD, closeTestApp, createTestApp, signUp } from './support/helpers';

/**
 * Faux Higgsfield et faux Chariow : les générations et les boutiques sont testées
 * de bout en bout sans jamais toucher un vrai fournisseur.
 */

const OWNER_KEY = 'sk_test_cle_du_proprietaire_0000';
const USER_KEY = 'sk_test_cle_utilisateur_valide_1234';

const creativeStatuses = new Map<string, Record<string, unknown>>();
const chariowAuthorizations: string[] = [];
let submissionFails = false;

const fakeProviders = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://fournisseurs.test');
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname.startsWith('/higgsfield/')) {
    if (req.method === 'POST') {
      if (submissionFails) return send(500, { detail: 'panne simulée' });
      const requestId = randomUUID();
      creativeStatuses.set(requestId, { status: 'queued' });
      return send(200, { request_id: requestId, status: 'queued' });
    }
    const match = url.pathname.match(/^\/higgsfield\/requests\/([^/]+)\/status$/);
    const status = match ? creativeStatuses.get(match[1]!) : undefined;
    return status ? send(200, { request_id: match![1], ...status }) : send(404, { detail: 'introuvable' });
  }

  if (url.pathname.startsWith('/chariow/')) {
    const authorization = req.headers.authorization ?? '';
    chariowAuthorizations.push(authorization);
    if (authorization !== `Bearer ${USER_KEY}` && authorization !== `Bearer ${OWNER_KEY}`) {
      return send(401, { message: 'Unauthenticated.' });
    }
    if (url.pathname === '/chariow/products') {
      return send(200, {
        data: [{ id: 'prd_1', name: 'Guide Mobile Money', type: 'digital', pricing: { current_price: { value: 5000, currency: 'XOF', formatted: '5 000 F CFA' } } }],
        pagination: { has_more: false },
      });
    }
    if (url.pathname === '/chariow/sales') {
      return send(200, {
        data: [{ id: 'sal_1', status: 'completed', amount: { value: 5000, currency: 'XOF' } }],
        pagination: { has_more: false },
      });
    }
  }

  send(404, {});
});

const visualBrief = {
  productName: 'Formation Excel pour commerçantes',
  awarenessLevel: 'problem_aware',
  format: '9:16',
  market: 'CI',
  sceneDescription: 'une commerçante vérifie ses ventes du jour sur son téléphone, au marché, en fin d’après-midi',
};

let app: Express;

before(async () => {
  await new Promise<void>((resolve) => fakeProviders.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fakeProviders.address() as AddressInfo).port}`;
  app = await createTestApp({ HIGGSFIELD_API_URL: `${base}/higgsfield`, CHARIOW_API_URL: `${base}/chariow` });
});

after(async () => {
  await closeTestApp();
  fakeProviders.close();
});

async function balanceOf(agent: ReturnType<typeof request.agent>): Promise<number> {
  return (await agent.get('/api/auth/me').expect(200)).body.account.credits.total;
}

describe('Générations facturées', () => {
  let owner: Awaited<ReturnType<typeof signUp>>;
  let stranger: Awaited<ReturnType<typeof signUp>>;

  before(async () => {
    owner = await signUp(app, { name: 'Mariam Coulibaly', email: 'mariam@exemple.com' });
    stranger = await signUp(app, { name: 'Olivier Nkoulou', email: 'olivier@exemple.com' });
  });

  it('réserve le point au lancement, rattache la génération à son auteur et la clôt', async () => {
    const submitted = await owner.agent.post('/api/creatives/visuals').send(visualBrief).expect(202);
    const requestId = submitted.body.requestId as string;
    assert.equal(await balanceOf(owner.agent), 2);

    creativeStatuses.set(requestId, { status: 'completed', images: [{ url: 'https://fichiers.invalid/visuel.png' }] });
    const polled = await owner.agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(polled.body.status, 'completed');

    const { getDb } = await import('@server/db/client');
    const { generations } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await getDb().select().from(generations).where(eq(generations.providerRef, requestId));
    assert.equal(row?.status, 'completed');
    assert.equal(row?.fileFormat, 'png');
    assert.equal(row?.creditsCharged, 1);

    const spied = await stranger.agent.get(`/api/creatives/requests/${requestId}`).expect(404);
    assert.equal(spied.body.error.code, 'GENERATION_NOT_FOUND');
    await stranger.agent.get(`/api/creatives/requests/${requestId}/file`).expect(404);
    const ownFile = await owner.agent.get(`/api/creatives/requests/${requestId}/file`);
    assert.notEqual(ownFile.status, 404, 'l’auteur passe le contrôle de propriété');
  });

  it('rend les points une seule fois quand le filtre du fournisseur refuse le contenu', async () => {
    const submitted = await owner.agent.post('/api/creatives/visuals').send(visualBrief).expect(202);
    assert.equal(await balanceOf(owner.agent), 1);

    creativeStatuses.set(submitted.body.requestId, { status: 'nsfw' });
    await owner.agent.get(`/api/creatives/requests/${submitted.body.requestId}`).expect(200);
    await owner.agent.get(`/api/creatives/requests/${submitted.body.requestId}`).expect(200);
    assert.equal(await balanceOf(owner.agent), 2, 'remboursé une fois, pas deux');
  });

  it('rend les points quand l’envoi au fournisseur échoue', async () => {
    submissionFails = true;
    try {
      await owner.agent.post('/api/creatives/visuals').send(visualBrief).expect(502);
    } finally {
      submissionFails = false;
    }
    assert.equal(await balanceOf(owner.agent), 2);
  });

  it('refuse sans solde suffisant, et une fonction absente du palier', async () => {
    const { getDb } = await import('@server/db/client');
    const { users } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    await getDb().update(users).set({ planCredits: 0, bonusCredits: 0 }).where(eq(users.id, stranger.account.id));

    const broke = await stranger.agent.post('/api/creatives/visuals').send(visualBrief).expect(402);
    assert.equal(broke.body.error.code, 'INSUFFICIENT_CREDITS');

    const video = await stranger.agent.post('/api/creatives/videos').send({ ...visualBrief, duration: 5 }).expect(403);
    assert.equal(video.body.error.code, 'FEATURE_LOCKED');
  });

  it('compte les exports faits dans le navigateur, en les marquant comme déclarés', async () => {
    await owner.agent.post('/api/account/exports').send({ kind: 'ebook', format: 'pdf' }).expect(204);
    await owner.agent.post('/api/account/exports').send({ kind: 'ebook', format: 'mp3' }).expect(400);

    const { getDb } = await import('@server/db/client');
    const { generations } = await import('@server/db/schema');
    const { and, eq } = await import('drizzle-orm');
    const rows = await getDb()
      .select()
      .from(generations)
      .where(and(eq(generations.userId, owner.account.id), eq(generations.kind, 'ebook')));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.source, 'client');
  });
});

describe('Suivi des générations abandonnées', () => {
  it('rend les points d’une génération échouée que plus aucun écran ne suit, et abandonne après 48 h', async () => {
    const creator = await signUp(app, { name: 'Binta Camara', email: 'binta@exemple.com' });
    const { getDb } = await import('@server/db/client');
    const { generations } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');

    const failed = await creator.agent.post('/api/creatives/visuals').send(visualBrief).expect(202);
    creativeStatuses.set(failed.body.requestId, { status: 'failed', error: 'panne du modèle' });
    await getDb()
      .update(generations)
      .set({ createdAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(generations.providerRef, failed.body.requestId));

    const forgotten = await creator.agent.post('/api/creatives/visuals').send(visualBrief).expect(202);
    await getDb()
      .update(generations)
      .set({ createdAt: new Date(Date.now() - 72 * 3_600_000) })
      .where(eq(generations.providerRef, forgotten.body.requestId));
    assert.equal(await balanceOf(creator.agent), 1);

    const { sweepPendingGenerations } = await import('@server/services/generations/sweeper');
    const result = await sweepPendingGenerations();
    assert.ok(result.settled >= 2);
    assert.equal(await balanceOf(creator.agent), 3, 'les deux points sont rendus');

    const again = await sweepPendingGenerations();
    assert.equal(again.settled, 0);
    assert.equal(await balanceOf(creator.agent), 3, 'pas de double remboursement');
  });
});

describe('Clés Chariow personnelles', () => {
  it('n’utilise jamais la clé du propriétaire pour un autre compte', async () => {
    const seller = await signUp(app, { name: 'Grace Ekwueme', email: 'grace@exemple.com' });
    const before = chariowAuthorizations.length;

    const marketplaces = await seller.agent.get('/api/marketplaces').expect(200);
    const chariow = marketplaces.body.marketplaces.find((entry: { id: string }) => entry.id === 'chariow');
    assert.equal(chariow.available, false);
    const noSource = await seller.agent.get('/api/marketplaces/sales-summary').expect(503);
    assert.equal(noSource.body.error.code, 'NO_SALES_SOURCE');
    await seller.agent.get('/api/affiliation/chariow/affiliates/CODE1').expect(503);
    assert.equal(chariowAuthorizations.length, before, 'aucun appel à Chariow avec la clé du propriétaire');
  });

  it('vérifie, chiffre et utilise la clé de l’utilisateur sans jamais la renvoyer', async () => {
    const seller = await signUp(app, { name: 'Serge Ateba', email: 'serge@exemple.com' });

    await seller.agent.put('/api/account/integrations/chariow').send({ apiKey: 'pas-une-cle' }).expect(400);
    const rejected = await seller.agent
      .put('/api/account/integrations/chariow')
      .send({ apiKey: 'sk_test_cle_refusee_par_chariow_99' })
      .expect(400);
    assert.equal(rejected.body.error.code, 'CHARIOW_KEY_REJECTED');

    const saved = await seller.agent.put('/api/account/integrations/chariow').send({ apiKey: USER_KEY }).expect(200);
    assert.deepEqual(
      { connected: saved.body.integrations.chariow.connected, source: saved.body.integrations.chariow.source, hint: saved.body.integrations.chariow.hint },
      { connected: true, source: 'own', hint: '1234' },
    );
    assert.ok(!JSON.stringify(saved.body).includes(USER_KEY));
    assert.ok(!JSON.stringify((await seller.agent.get('/api/auth/me')).body).includes(USER_KEY));

    const { getDb } = await import('@server/db/client');
    const { userIntegrations } = await import('@server/db/schema');
    const [stored] = await getDb().select().from(userIntegrations);
    assert.ok(stored && stored.secret.startsWith('v1.') && !stored.secret.includes(USER_KEY), 'clé chiffrée en base');

    const sales = await seller.agent.get('/api/marketplaces/sales-summary').expect(200);
    assert.equal(sales.body.summaries[0].completedSales, 1);
    assert.equal(chariowAuthorizations.at(-1), `Bearer ${USER_KEY}`);

    const removed = await seller.agent.delete('/api/account/integrations/chariow').expect(200);
    assert.equal(removed.body.integrations.chariow.connected, false);
  });

  it('réserve la clé du serveur aux administrateurs', async () => {
    const { createUserRecord } = await import('@server/services/accounts');
    const { hashPassword } = await import('@server/services/auth/password');
    await createUserRecord({
      name: 'Propriétaire',
      email: 'proprietaire@exemple.com',
      passwordHash: await hashPassword(STRONG_PASSWORD),
      role: 'admin',
      plan: 'elite',
    });
    const owner = request.agent(app);
    await owner.post('/api/auth/login').send({ email: 'proprietaire@exemple.com', password: STRONG_PASSWORD }).expect(200);

    const me = await owner.get('/api/auth/me').expect(200);
    assert.equal(me.body.account.integrations.chariow.source, 'admin');
    await owner.get('/api/marketplaces/chariow/products').expect(200);
    assert.equal(chariowAuthorizations.at(-1), `Bearer ${OWNER_KEY}`);
  });
});
