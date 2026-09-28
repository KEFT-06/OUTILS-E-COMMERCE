import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Vidéo → Produit par dépôt direct, contre un faux Supabase et un faux Gemini.
 *
 * L'hébergeur refuse tout envoi de plus de 4,5 Mo au serveur : la vidéo part donc dans le
 * stockage par un lien signé, et le serveur la relit de là. Ce que ces tests verrouillent :
 * le lien ne s'obtient que pour un type et un poids acceptés ; un compte ne peut pas faire
 * analyser le dépôt d'un autre ; le fichier est effacé dès l'analyse faite ; et un dépôt
 * abandonné est effacé par le balayage de nuit au-delà de 24 h.
 */

const CLE = 'sb_secret_cle_de_test_0000000000';
const objets = new Map<string, { corps: Buffer; type: string; cree: string }>();
const effaces: string[] = [];
const envoisGemini: { inlineData?: { mimeType: string; data: string } }[][] = [];

const PRODUIT = {
  title: 'Élever des poules en ville',
  subtitle: 'Ce que montre la vidéo',
  type: 'masterclass',
  targetAudience: 'Citadins',
  transformationPromise: 'Installer un poulailler propre',
  summary: 'Installation d’un poulailler de balcon.',
  modules: [{ title: 'Le matériel', details: 'Grillage, abreuvoir.' }],
  leadMagnet: { title: 'Liste du matériel', format: 'PDF', hook: 'Avant de commencer' },
};

const faux = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://faux.test');
    const corps = Buffer.concat(chunks);
    const envoyer = (code: number, contenu: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(contenu));
    };

    if (url.pathname.startsWith('/v1beta/models/')) {
      envoisGemini.push((JSON.parse(corps.toString('utf8')) as { contents: { parts: never[] }[] }).contents[0]!.parts);
      return envoyer(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(PRODUIT) }] } }] });
    }

    // Dépôt par lien signé : aucune clé, le jeton suffit.
    const signe = /^\/storage\/v1\/object\/upload\/sign\/depots-video\/(.+)$/.exec(url.pathname);
    if (req.method === 'PUT' && signe) {
      if (url.searchParams.get('token') !== `jeton-${signe[1]!}`) return envoyer(400, { message: 'invalid token' });
      objets.set(signe[1]!, { corps, type: String(req.headers['content-type']), cree: new Date().toISOString() });
      return envoyer(200, { Key: `depots-video/${signe[1]!}` });
    }

    if (!url.pathname.startsWith('/storage/v1/')) return envoyer(404, {});
    if (req.headers.authorization !== `Bearer ${CLE}`) return envoyer(401, { message: 'Unauthorized' });

    if (req.method === 'POST' && url.pathname === '/storage/v1/bucket') return envoyer(200, { name: 'depots-video' });
    if (req.method === 'POST' && signe) return envoyer(200, { url: `/object/upload/sign/depots-video/${signe[1]!}?token=jeton-${signe[1]!}` });

    const lecture = /^\/storage\/v1\/object\/authenticated\/depots-video\/(.+)$/.exec(url.pathname);
    if (req.method === 'GET' && lecture) {
      const objet = objets.get(lecture[1]!);
      if (!objet) return envoyer(404, { message: 'Object not found' });
      res.writeHead(200, { 'content-type': objet.type, 'content-length': String(objet.corps.length) });
      res.end(objet.corps);
      return;
    }
    if (req.method === 'DELETE' && url.pathname === '/storage/v1/object/depots-video') {
      for (const chemin of (JSON.parse(corps.toString('utf8')) as { prefixes: string[] }).prefixes) {
        effaces.push(chemin);
        objets.delete(chemin);
      }
      return envoyer(200, []);
    }
    if (req.method === 'POST' && url.pathname === '/storage/v1/object/list/depots-video') {
      const { prefix } = JSON.parse(corps.toString('utf8')) as { prefix: string };
      return envoyer(
        200,
        [...objets.entries()]
          .filter(([chemin]) => chemin.startsWith(`${prefix}/`))
          .map(([chemin, objet]) => ({ name: chemin.slice(prefix.length + 1), created_at: objet.cree })),
      );
    }
    envoyer(404, {});
  });
});

let app: Express;
let base = '';

before(async () => {
  await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(faux.address() as AddressInfo).port}`;
  app = await createTestApp({ GEMINI_API_URL: base, SUPABASE_API_SECRET_KEY: CLE, SUPABASE_URL: base });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => faux.close(() => r()));
});

/** Ce que fait le navigateur : dépose le fichier au lien signé, sans clé ni cookie. */
async function deposer(uploadUrl: string, fichier: Buffer, type: string): Promise<number> {
  const reponse = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': type }, body: new Uint8Array(fichier) });
  return reponse.status;
}

describe('Vidéo → Produit par dépôt direct', () => {
  it('analyse le fichier déposé dans le stockage, puis l’efface', async () => {
    const { agent } = await signInWithPlan(app, 'depot-video@exemple.test', 'pro');
    const video = Buffer.alloc(6 * 1024 * 1024, 7); // au-delà des 4,5 Mo que l'hébergeur accepte

    const prepare = await agent.post('/api/writing/video-upload').send({ mimeType: 'video/mp4', size: video.length }).expect(200);
    const { uploadId, uploadUrl } = prepare.body as { uploadId: string; uploadUrl: string };
    assert.ok(uploadUrl.startsWith(`${base}/storage/v1/object/upload/sign/depots-video/tmp/`), 'lien signé du stockage');
    assert.equal(await deposer(uploadUrl, video, 'video/mp4'), 200);

    const reponse = await agent.post('/api/writing/video-uploaded').send({ uploadId, fileName: 'atelier.mp4' }).expect(200);
    assert.equal((reponse.body as { product: { origin: { label: string } } }).product.origin.label, 'atelier.mp4');
    assert.equal(envoisGemini.at(-1)![0]!.inlineData?.mimeType, 'video/mp4', 'la vidéo déposée part à Gemini');
    assert.equal(objets.has(`tmp/${uploadId}`), false, 'le fichier est effacé dès l’analyse faite');
  });

  it('refuse un type ou un poids non acceptés avant tout dépôt, et le dépôt d’un autre compte', async () => {
    const { agent } = await signInWithPlan(app, 'depot-refus@exemple.test', 'pro');
    const type = await agent.post('/api/writing/video-upload').send({ mimeType: 'application/pdf', size: 10 }).expect(415);
    assert.equal(type.body.error.code, 'VIDEO_TYPE_UNSUPPORTED');
    const poids = await agent.post('/api/writing/video-upload').send({ mimeType: 'video/mp4', size: 14 * 1024 * 1024 + 1 }).expect(413);
    assert.equal(poids.body.error.code, 'VIDEO_FILE_TOO_LARGE');

    const { agent: autre } = await signInWithPlan(app, 'depot-autre@exemple.test', 'pro');
    const { uploadId, uploadUrl } = (await autre.post('/api/writing/video-upload').send({ mimeType: 'audio/mpeg', size: 10 }).expect(200))
      .body as { uploadId: string; uploadUrl: string };
    await deposer(uploadUrl, Buffer.from('ID3 test'), 'audio/mpeg');
    const vol = await agent.post('/api/writing/video-uploaded').send({ uploadId }).expect(404);
    assert.equal(vol.body.error.code, 'VIDEO_UPLOAD_MISSING', 'un compte ne fait pas analyser le dépôt d’un autre');
    assert.ok(objets.has(`tmp/${uploadId}`), 'et ne peut pas l’effacer non plus');
  });

  it('efface au balayage de nuit les dépôts abandonnés depuis plus de 24 h', async () => {
    const vieux = `tmp/${'a'.repeat(8)}-0000-0000-0000-000000000000_${'b'.repeat(8)}-0000-0000-0000-000000000000`;
    objets.set(vieux, { corps: Buffer.from('x'), type: 'video/mp4', cree: new Date(Date.now() - 25 * 3_600_000).toISOString() });
    const recent = `tmp/${'c'.repeat(8)}-0000-0000-0000-000000000000_${'d'.repeat(8)}-0000-0000-0000-000000000000`;
    objets.set(recent, { corps: Buffer.from('y'), type: 'video/mp4', cree: new Date().toISOString() });

    const { purgeStaleVideoUploads } = await import('@server/services/writing/videoUpload');
    assert.deepEqual(await purgeStaleVideoUploads(), { purged: 1 });
    assert.equal(objets.has(vieux), false);
    assert.equal(objets.has(recent), true, 'un dépôt du jour reste le temps de son analyse');
  });
});
