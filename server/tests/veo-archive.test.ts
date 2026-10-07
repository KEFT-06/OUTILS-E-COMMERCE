import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Copie des vidéos Veo dans le stockage de Supabase, contre un faux Google et un faux
 * Supabase : aucun vrai service n'est appelé.
 *
 * Google n'en garde une que deux jours. Ce que ces tests verrouillent : la copie part dès la
 * fin du rendu, dans un espace PRIVÉ créé au premier dépôt, avec la clé en en-tête ; elle est
 * servie ensuite même quand Google a effacé l'original ; et un dépôt manqué est rattrapé par
 * le balayage de nuit.
 *
 * Et la durée suit le palier : aucune copie pour 24 h (Google garde deux jours), une copie
 * effacée à échéance sinon, une seule version gardée pour une vidéo longue.
 */

const MODELE = 'veo-3.1-fast-generate-preview';
const MP4 = Buffer.from('00000018667479706d7034320000000069736f6d', 'hex');
const CLE = 'sb_secret_cle_de_test_0000000000';

let compteur = 0;
let googleEfface = false;
let stockagePanne = false;
let espaceCree: Record<string, unknown> | null = null;
const objets = new Map<string, Buffer>();
const clesRecues: (string | undefined)[] = [];

const faux = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://faux.test');
    const envoyer = (code: number, corps: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corps));
    };

    // ——— Faux Google ———
    if (url.pathname === '/v1beta/files/video:download') {
      if (googleEfface) return envoyer(404, { error: { message: 'Not Found' } });
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(MP4.length) });
      res.end(MP4);
      return;
    }
    if (req.method === 'POST' && url.pathname === `/v1beta/models/${MODELE}:predictLongRunning`) {
      compteur += 1;
      return envoyer(200, { name: `models/${MODELE}/operations/op-${String(compteur).padStart(4, '0')}` });
    }
    const suivi = new RegExp(`^/v1beta/models/${MODELE}/operations/(op-\\d{4})$`).exec(url.pathname);
    if (req.method === 'GET' && suivi) {
      return envoyer(200, {
        name: `models/${MODELE}/operations/${suivi[1]!}`,
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${base}/v1beta/files/video:download` } }] } },
      });
    }

    // ——— Faux Supabase Storage ———
    if (url.pathname.startsWith('/storage/v1/')) {
      clesRecues.push(req.headers.apikey as string | undefined);
      if (req.headers.authorization !== `Bearer ${CLE}`) return envoyer(401, { message: 'Unauthorized' });
      if (req.method === 'POST' && url.pathname === '/storage/v1/bucket') {
        espaceCree = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        return envoyer(200, { name: 'creatifs' });
      }
      const depot = /^\/storage\/v1\/object\/creatifs\/(.+)$/.exec(url.pathname);
      if (req.method === 'POST' && depot) {
        if (stockagePanne) return envoyer(503, { message: 'indisponible' });
        if (!espaceCree) return envoyer(400, { statusCode: '404', error: 'Bucket not found' });
        objets.set(depot[1]!, Buffer.concat(chunks));
        return envoyer(200, { Key: `creatifs/${depot[1]!}` });
      }
      if (req.method === 'DELETE' && url.pathname === '/storage/v1/object/creatifs') {
        for (const chemin of (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { prefixes: string[] }).prefixes) objets.delete(chemin);
        return envoyer(200, []);
      }
      const lecture = /^\/storage\/v1\/object\/authenticated\/creatifs\/(.+)$/.exec(url.pathname);
      if (req.method === 'GET' && lecture) {
        const objet = objets.get(lecture[1]!);
        if (!objet) return envoyer(404, { message: 'Object not found' });
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(objet.length) });
        res.end(objet);
        return;
      }
    }

    envoyer(404, { error: { message: 'Not Found' } });
  });
});

let app: Express;
let base = '';

before(async () => {
  await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(faux.address() as AddressInfo).port}`;
  app = await createTestApp({
    GEMINI_API_KEY: 'cle-google-de-test',
    GEMINI_API_URL: base,
    SUPABASE_API_SECRET_KEY: CLE,
    SUPABASE_URL: base,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => faux.close(() => r()));
});

const BRIEF = {
  productName: 'Formation bureautique',
  awarenessLevel: 'solution_aware',
  format: '9:16',
  market: 'CM',
  sceneDescription: 'une formatrice devant son ordinateur, lumière du matin',
  purpose: 'content',
  duration: 6,
};

/** La copie part après la réponse : on attend qu'elle arrive, sans dormir au hasard. */
async function attendreObjet(requestId: string): Promise<Buffer | undefined> {
  for (let essai = 0; essai < 50 && !objets.has(`veo/${requestId}.mp4`); essai += 1) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return objets.get(`veo/${requestId}.mp4`);
}

describe('Copie des vidéos Veo', () => {
  it('copie la vidéo terminée dans un espace privé, puis la sert même effacée chez Google', async () => {
    googleEfface = false;
    stockagePanne = false;
    const { agent } = await signInWithPlan(app, 'veo-archive@exemple.test', 'pro');
    const lance = await agent.post('/api/creatives/videos').send(BRIEF).expect(202);
    const requestId = lance.body.requestId as string;

    const suivi = await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(suivi.body.status, 'completed');
    assert.equal(suivi.body.retentionDays, 30, 'le palier Pro garde ses vidéos trente jours');
    assert.ok(suivi.body.availableUntil, 'l’écran dit jusqu’à quand télécharger');

    assert.deepEqual(await attendreObjet(requestId), MP4, 'la vidéo est copiée à l’identique');
    assert.equal(espaceCree?.public, false, 'l’espace de stockage est privé');
    assert.ok(clesRecues.every((cle) => cle === CLE), 'la clé part en en-tête à chaque appel');

    // Deux jours plus tard : Google a effacé l'original. La copie prend le relais.
    googleEfface = true;
    const fichier = await agent.get(`/api/creatives/requests/${requestId}/file`).buffer(true).expect(200);
    assert.deepEqual(Buffer.from(fichier.body as Buffer), MP4);
    assert.equal(fichier.headers['content-type'], 'video/mp4');
  });

  it('rattrape au balayage de nuit une copie manquée au premier dépôt', async () => {
    googleEfface = false;
    stockagePanne = true;
    const { agent } = await signInWithPlan(app, 'veo-archive-rattrapage@exemple.test', 'pro');
    const lance = await agent.post('/api/creatives/videos').send(BRIEF).expect(202);
    const requestId = lance.body.requestId as string;
    await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    // Laisse le dépôt en arrière-plan échouer.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(objets.has(`veo/${requestId}.mp4`), false);

    stockagePanne = false;
    const { archivePendingVideos } = await import('@server/services/creatives/archive');
    const resultat = await archivePendingVideos();
    assert.ok(resultat.archived >= 1);
    assert.deepEqual(objets.get(`veo/${requestId}.mp4`), MP4);
  });

  it('ne copie rien pour un palier à 24 h, puis annonce la vidéo expirée au lieu d’une erreur', async () => {
    googleEfface = false;
    stockagePanne = false;
    const { agent } = await signInWithPlan(app, 'veo-plus@exemple.test', 'plus');
    const lance = await agent.post('/api/creatives/videos').send(BRIEF).expect(202);
    const requestId = lance.body.requestId as string;
    assert.equal(lance.body.retentionDays, 1);

    const suivi = await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(suivi.body.retentionDays, 1);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(objets.has(`veo/${requestId}.mp4`), false, 'Google la garde deux jours : aucune copie chez nous');

    // Vingt-cinq heures plus tard.
    const { getDb } = await import('@server/db/client');
    const { generations } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    await getDb().update(generations).set({ completedAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(generations.providerRef, requestId));

    const expiree = await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(expiree.body.expired, true);
    const fichier = await agent.get(`/api/creatives/requests/${requestId}/file`).expect(410);
    assert.equal(fichier.body.error.code, 'VIDEO_EXPIRED');
    assert.match(fichier.body.error.message, /24 heures/);
  });

  it('efface la copie à son échéance, et ne garde que la dernière version d’une vidéo longue', async () => {
    googleEfface = false;
    stockagePanne = false;
    const { agent } = await signInWithPlan(app, 'veo-echeance@exemple.test', 'max');
    const lance = await agent.post('/api/creatives/videos').send(BRIEF).expect(202);
    const requestId = lance.body.requestId as string;
    await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.ok(await attendreObjet(requestId), 'copiée');

    const { getDb } = await import('@server/db/client');
    const { generations } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const [parent] = await getDb().select().from(generations).where(eq(generations.providerRef, requestId));
    assert.ok(parent?.archiveExpiresAt, 'une échéance est fixée');
    const jours = (parent.archiveExpiresAt.getTime() - (parent.completedAt ?? parent.createdAt).getTime()) / 86_400_000;
    assert.equal(Math.round(jours), 90, 'palier Max : quatre-vingt-dix jours');

    // Une prolongation terminée : la nouvelle version contient toute l'ancienne.
    const [enfant] = await getDb()
      .insert(generations)
      .values({
        userId: parent.userId,
        kind: 'video',
        provider: 'veo',
        providerRef: 'op-9999',
        status: 'completed',
        parentId: parent.id,
        creditsCharged: 0,
        completedAt: new Date(),
      })
      .returning();
    const { archiveVeoVideo, purgeExpiredVideos } = await import('@server/services/creatives/archive');
    assert.equal(await archiveVeoVideo(enfant!), true);
    assert.ok(objets.has('veo/op-9999.mp4'), 'la nouvelle version est copiée');
    assert.equal(objets.has(`veo/${requestId}.mp4`), false, 'l’ancienne version est effacée');

    // « Mes créations » : la pastille compte les vidéos qui seront supprimées dans les 48 heures.
    assert.equal((await agent.get('/api/creatives/expiring').expect(200)).body.expiring, 0, 'quatre-vingt-dix jours devant elle : rien à signaler');
    await getDb().update(generations).set({ archiveExpiresAt: new Date(Date.now() + 30 * 3_600_000) }).where(eq(generations.id, enfant!.id));
    assert.equal((await agent.get('/api/creatives/expiring').expect(200)).body.expiring, 1, 'trente heures avant la suppression : à télécharger');
    const liste = await agent.get('/api/creatives/videos?limit=40').expect(200);
    assert.equal(liste.body.videos.length, 1, 'seule la dernière version de la vidéo longue est listée');
    assert.equal(liste.body.videos[0].requestId, 'op-9999');
    assert.equal(liste.body.videos[0].expired, false);
    const reste = new Date(liste.body.videos[0].availableUntil as string).getTime() - Date.now();
    assert.ok(reste > 29 * 3_600_000 && reste < 31 * 3_600_000, 'l’écran peut dire « expire dans 30 heures »');

    // Échéance passée : le balayage de nuit efface la copie, la ligne garde sa date.
    await getDb().update(generations).set({ archiveExpiresAt: new Date(Date.now() - 1_000) }).where(eq(generations.id, enfant!.id));
    assert.equal((await agent.get('/api/creatives/expiring').expect(200)).body.expiring, 0, 'une vidéo déjà expirée ne se signale plus');
    const { purged } = await purgeExpiredVideos();
    assert.ok(purged >= 1);
    assert.equal(objets.has('veo/op-9999.mp4'), false);
    const [apres] = await getDb().select().from(generations).where(eq(generations.id, enfant!.id));
    assert.equal(apres?.archivedAt, null);
    assert.ok(apres?.archiveExpiresAt, 'la date reste, pour dire « expirée »');
  });
});
