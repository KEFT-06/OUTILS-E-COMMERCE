import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { signInWithPlan } from './support/analysis-fixtures';
import { STRONG_PASSWORD, closeTestApp, createAdmin, createTestApp, signUp } from './support/helpers';

/**
 * Faux Google (images et Veo) et faux Chariow : les générations et les boutiques sont testées
 * de bout en bout sans jamais toucher un vrai fournisseur.
 */

const OWNER_KEY = 'sk_test_cle_du_proprietaire_0000';
const USER_KEY = 'sk_test_cle_utilisateur_valide_1234';

const VEO = 'veo-3.1-fast-generate-preview';
/** Image PNG d'un pixel, rendue par le faux modèle d'image. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** État de chaque opération Veo : en cours, échouée (refus du filtre, panne) ou terminée. */
const veoOperations = new Map<string, 'encours' | 'echec' | 'termine'>();
const chariowAuthorizations: string[] = [];
let submissionFails = false;
let compteurVeo = 0;

const fakeProviders = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://fournisseurs.test');
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // Modèle d'image de Google : l'image arrive dans la réponse.
  if (req.method === 'POST' && /^\/v1beta\/models\/[\w.-]+-image:generateContent$/.test(url.pathname)) {
    return send(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] });
  }
  // Veo : dépôt, puis suivi de l'opération.
  if (req.method === 'POST' && url.pathname === `/v1beta/models/${VEO}:predictLongRunning`) {
    if (submissionFails) return send(500, { error: { message: 'panne simulée' } });
    compteurVeo += 1;
    const id = `op-${String(compteurVeo).padStart(4, '0')}`;
    veoOperations.set(id, 'encours');
    return send(200, { name: `models/${VEO}/operations/${id}` });
  }
  const suivi = new RegExp(`^/v1beta/models/${VEO}/operations/(op-\\d{4})$`).exec(url.pathname);
  if (req.method === 'GET' && suivi) {
    const etat = veoOperations.get(suivi[1]!);
    if (!etat) return send(404, { error: { message: 'Not Found' } });
    const name = `models/${VEO}/operations/${suivi[1]!}`;
    if (etat === 'encours') return send(200, { name, done: false });
    if (etat === 'echec') return send(200, { name, done: true, error: { message: 'contenu refusé par le filtre de sécurité' } });
    return send(200, { name, done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://fichiers.invalid/video.mp4' } }] } } });
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
  app = await createTestApp({ GEMINI_API_URL: base, CHARIOW_API_URL: `${base}/chariow` });
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
  /** Compte Pro : le palier Gratuit n'ouvre pas la vidéo. */
  let videaste: Awaited<ReturnType<typeof signInWithPlan>>;
  const videoBrief = { ...visualBrief, duration: 6 };

  before(async () => {
    owner = await signUp(app, { name: 'Mariam Coulibaly', email: 'mariam@exemple.com' });
    stranger = await signUp(app, { name: 'Olivier Nkoulou', email: 'olivier@exemple.com' });
    videaste = await signInWithPlan(app, 'videaste@exemple.com', 'pro');
  });

  it('facture le visuel, le rattache à son auteur et le garde sur son compte', async () => {
    const submitted = await owner.agent.post('/api/creatives/visuals').send(visualBrief).expect(202);
    const requestId = submitted.body.requestId as string;
    assert.equal(submitted.body.status, 'completed', 'le moteur d’images de Google rend l’image dans la réponse');
    assert.equal(await balanceOf(owner.agent), 2);

    const polled = await owner.agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(polled.body.status, 'completed');
    assert.equal(polled.body.retentionDays, null, 'un visuel gardé chez nous ne périme pas');

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

  /*
    Google ne garde une vidéo Veo que deux jours (ai.google.dev/gemini-api/docs/veo). Elle était
    comptée sept, comme chez Higgsfield : du troisième au septième jour, la bibliothèque proposait
    « Voir » sur un fichier déjà effacé.
  */
  it('annonce expirée une vidéo Veo de plus de deux jours, et garde celle de la veille', async () => {
    const admin = await createAdmin(app, 'admin-veo@smartcreator.test');
    const { getDb } = await import('@server/db/client');
    const { generations } = await import('@server/db/schema');
    const { inArray } = await import('drizzle-orm');
    const jour = 86_400_000;
    const inserted = await getDb()
      .insert(generations)
      .values(
        [3, 1].map((joursAvant) => ({
          userId: owner.account.id,
          kind: 'video' as const,
          provider: 'veo',
          providerRef: `veo-${joursAvant}-${randomUUID()}`,
          status: 'completed' as const,
          createdAt: new Date(Date.now() - joursAvant * jour),
        })),
      )
      .returning({ id: generations.id, providerRef: generations.providerRef });

    try {
      const list = await admin.agent.get('/api/admin/creatives?kind=video&pageSize=100').expect(200);
      const disponibilite = (prefix: string) =>
        (list.body.entries as { id: string; available: boolean }[]).find(
          (row) => row.id === inserted.find((entry) => entry.providerRef?.startsWith(prefix))?.id,
        )?.available;
      assert.equal(disponibilite('veo-3-'), false, 'trois jours : effacée chez Google');
      assert.equal(disponibilite('veo-1-'), true, 'la veille : encore récupérable');
    } finally {
      await getDb().delete(generations).where(inArray(generations.id, inserted.map((entry) => entry.id)));
    }
  });

  it('montre à l’administration les créatifs des comptes, et inscrit chaque ouverture au journal', async () => {
    const admin = await createAdmin(app, 'admin-creatifs@smartcreator.test');

    const refused = await stranger.agent.get('/api/admin/creatives?kind=image').expect(403);
    assert.equal(refused.body.error.code, 'FORBIDDEN');

    const list = await admin.agent.get('/api/admin/creatives?kind=image').expect(200);
    const entry = (list.body.entries as { id: string; status: string; available: boolean; user: { email: string } }[]).find(
      (row) => row.status === 'completed',
    );
    assert.ok(entry, 'le visuel terminé du propriétaire figure dans la liste');
    assert.equal(entry.available, true);
    assert.ok(list.body.counts.completed >= 1);
    assert.equal(JSON.stringify(list.body).includes('fichiers.invalid'), false, 'aucune adresse du fournisseur ne sort');

    await stranger.agent.get(`/api/admin/creatives/${entry.id}/file`).expect(403);
    const file = await admin.agent.get(`/api/admin/creatives/${entry.id}/file`);
    assert.notEqual(file.status, 404, 'l’administration passe le contrôle d’accès');
    await admin.agent.get('/api/admin/creatives/pas-un-identifiant/file').expect(404);

    const { getDb } = await import('@server/db/client');
    const { auditLogs } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const logged = await getDb().select().from(auditLogs).where(eq(auditLogs.action, 'creative.viewed'));
    assert.ok(logged.some((row) => row.actorEmail === 'admin-creatifs@smartcreator.test'), 'ouverture inscrite au journal');
  });

  it('réserve les points d’une vidéo au lancement, et les garde quand elle aboutit', async () => {
    const avant = await balanceOf(videaste.agent);
    const submitted = await videaste.agent.post('/api/creatives/videos').send(videoBrief).expect(202);
    const requestId = submitted.body.requestId as string;
    const reserve = avant - (await balanceOf(videaste.agent));
    assert.ok(reserve > 0, 'les points sont réservés dès le lancement');

    await videaste.agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    veoOperations.set(requestId, 'termine');
    const fini = await videaste.agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(fini.body.status, 'completed');
    assert.equal(fini.body.mediaType, 'video');
    assert.equal(await balanceOf(videaste.agent), avant - reserve, 'une vidéo réussie reste facturée');
  });

  it('rend les points une seule fois quand le fournisseur refuse le contenu', async () => {
    const avant = await balanceOf(videaste.agent);
    const submitted = await videaste.agent.post('/api/creatives/videos').send(videoBrief).expect(202);
    assert.ok((await balanceOf(videaste.agent)) < avant);

    veoOperations.set(submitted.body.requestId, 'echec');
    await videaste.agent.get(`/api/creatives/requests/${submitted.body.requestId}`).expect(200);
    await videaste.agent.get(`/api/creatives/requests/${submitted.body.requestId}`).expect(200);
    assert.equal(await balanceOf(videaste.agent), avant, 'remboursé une fois, pas deux');
  });

  it('rend les points quand l’envoi au fournisseur échoue', async () => {
    const avant = await balanceOf(videaste.agent);
    submissionFails = true;
    try {
      const refused = await videaste.agent.post('/api/creatives/videos').send(videoBrief).expect(503);
      assert.equal(refused.body.error.code, 'VEO_UNAVAILABLE');
    } finally {
      submissionFails = false;
    }
    assert.equal(await balanceOf(videaste.agent), avant);
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
    const creator = await signInWithPlan(app, 'binta@exemple.com', 'pro');
    const { getDb } = await import('@server/db/client');
    const { generations } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const video = { ...visualBrief, duration: 6 };
    const initial = await balanceOf(creator.agent);

    // Échouée chez Google, mais plus aucun écran ne la suit.
    const failed = await creator.agent.post('/api/creatives/videos').send(video).expect(202);
    veoOperations.set(failed.body.requestId, 'echec');
    await getDb()
      .update(generations)
      .set({ createdAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(generations.providerRef, failed.body.requestId));

    // Toujours « en cours » chez Google au bout de trois jours : abandonnée.
    const forgotten = await creator.agent.post('/api/creatives/videos').send(video).expect(202);
    await getDb()
      .update(generations)
      .set({ createdAt: new Date(Date.now() - 72 * 3_600_000) })
      .where(eq(generations.providerRef, forgotten.body.requestId));
    assert.ok((await balanceOf(creator.agent)) < initial);

    const { sweepPendingGenerations } = await import('@server/services/generations/sweeper');
    const result = await sweepPendingGenerations();
    assert.ok(result.settled >= 2);
    assert.equal(await balanceOf(creator.agent), initial, 'les points des deux vidéos sont rendus');

    const again = await sweepPendingGenerations();
    assert.equal(again.settled, 0);
    assert.equal(await balanceOf(creator.agent), initial, 'pas de double remboursement');
  });
});

describe('Clés Chariow personnelles', () => {
  it('n’utilise jamais la clé du propriétaire pour un autre compte', async () => {
    const seller = await signUp(app, { name: 'Grace Ekwueme', email: 'grace@exemple.com' });
    const before = chariowAuthorizations.length;

    const marketplaces = await seller.agent.get('/api/marketplaces').expect(200);
    const chariow = marketplaces.body.marketplaces.find((entry: { id: string }) => entry.id === 'chariow');
    assert.equal(chariow.available, false);
    const noSource = await seller.agent.get('/api/marketplaces/sales-summary').expect(200);
    assert.deepEqual(noSource.body, { days: 30, connected: false, range: null, summaries: [] }, 'pas une erreur : aucune boutique reliée');
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
