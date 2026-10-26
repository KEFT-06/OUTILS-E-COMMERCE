import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Rendu vidéo par fal.ai, contre un faux fal : depuis le 26/10/2026, c'est le moteur vidéo dès que
 * sa clé est là (le projet Gemini, donc Veo, est refusé par Google).
 *
 * Ce que ces tests verrouillent a été lu ou MESURÉ sur fal.ai ce jour-là :
 *   · l'en-tête est « Authorization: Key <clé> » ;
 *   · le dépôt prend le chemin complet du modèle, mais le suivi se lit sur la RACINE de
 *     l'application (« google/gemini-omni-flash/requests/{id}/status ») — le chemin complet rend 405 ;
 *   · Gemini Omni Flash prend une durée en NOMBRE et n'a pas de consigne négative ;
 *   · un rendu raté se dit « COMPLETED » avec une erreur, sans fichier : il ne doit jamais être
 *     soldé comme une réussite.
 */

const MODELE = 'google/gemini-omni-flash/v1.1/text-to-video';
const RACINE = 'google/gemini-omni-flash';
const MP4 = Buffer.from('00000018667479706d703432', 'hex');

const depots: { cle: string | undefined; corps: Record<string, unknown> }[] = [];
const suivis: string[] = [];
/** Rendus terminés, et rendus terminés en échec, par identifiant. */
const termines = new Set<string>();
const rates = new Set<string>();
/** Faux stockage de Supabase : les copies archivées, par chemin. */
const CLE_STOCKAGE = 'sb_secret_cle_de_test_0000000000';
const objets = new Map<string, Buffer>();
let espaceCree = false;
/** fal a effacé le fichier : seule la copie archivée peut encore le servir. */
let falEfface = false;
/** Compte fal à sec : tout dépôt est refusé, comme le 26/10/2026. */
let aSec = false;

const fauxFal = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://fal.test');
    const envoyer = (code: number, corps: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corps));
    };
    if (url.pathname.startsWith('/storage/v1/')) {
      if (req.headers.authorization !== `Bearer ${CLE_STOCKAGE}`) return envoyer(401, { message: 'Unauthorized' });
      if (req.method === 'POST' && url.pathname === '/storage/v1/bucket') {
        espaceCree = true;
        return envoyer(200, { name: 'creatifs' });
      }
      const depot = /^\/storage\/v1\/object\/creatifs\/(.+)$/.exec(url.pathname);
      if (req.method === 'POST' && depot) {
        if (!espaceCree) return envoyer(400, { statusCode: '404', error: 'Bucket not found' });
        objets.set(depot[1]!, Buffer.concat(chunks));
        return envoyer(200, { Key: `creatifs/${depot[1]!}` });
      }
      const lecture = /^\/storage\/v1\/object\/authenticated\/creatifs\/(.+)$/.exec(url.pathname);
      if (req.method === 'GET' && lecture) {
        const objet = objets.get(lecture[1]!);
        if (!objet) return envoyer(404, { message: 'Object not found' });
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(objet.length) });
        res.end(objet);
        return;
      }
      return envoyer(404, { message: 'Not Found' });
    }
    if (url.pathname === '/fichiers/video.mp4') {
      if (falEfface) return envoyer(404, { detail: 'Not Found' });
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(MP4.length) });
      res.end(MP4);
      return;
    }
    if (req.method === 'POST' && url.pathname === `/${MODELE}` && aSec) {
      // Réponse exacte de fal.ai le 26/10/2026.
      return envoyer(403, { detail: 'User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing.' });
    }
    if (req.method === 'POST' && url.pathname === `/${MODELE}`) {
      depots.push({ cle: req.headers.authorization, corps: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> });
      envoyer(200, { status: 'IN_QUEUE', request_id: randomUUID(), queue_position: 0 });
      return;
    }
    // Le chemin complet ne répond pas au suivi : seule la racine le fait.
    if (url.pathname.startsWith(`/${MODELE}/requests/`)) {
      envoyer(405, { detail: 'Method Not Allowed' });
      return;
    }
    const suivi = new RegExp(`^/${RACINE}/requests/([\\w-]+)(/status)?$`).exec(url.pathname);
    if (req.method === 'GET' && suivi) {
      const id = suivi[1]!;
      suivis.push(url.pathname);
      if (suivi[2]) {
        if (rates.has(id)) envoyer(200, { status: 'COMPLETED', request_id: id, error: 'Content policy violation' });
        else envoyer(200, { status: termines.has(id) ? 'COMPLETED' : 'IN_PROGRESS', request_id: id });
        return;
      }
      envoyer(200, { video: { url: `${base}/fichiers/video.mp4`, content_type: 'video/mp4' } });
      return;
    }
    envoyer(404, { detail: 'Not Found' });
  });
});

let app: Express;
let base = '';

before(async () => {
  await new Promise<void>((r) => fauxFal.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(fauxFal.address() as AddressInfo).port}`;
  // La clé Gemini reste là, comme en production : fal.ai doit passer devant Veo.
  app = await createTestApp({
    FAL_KEY: 'cle-fal-de-test',
    FAL_API_URL: base,
    FAL_VIDEO_MODEL: MODELE,
    GEMINI_API_KEY: 'cle-google-de-test',
    SUPABASE_API_SECRET_KEY: CLE_STOCKAGE,
    SUPABASE_URL: base,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => fauxFal.close(() => r()));
});

const BRIEF = {
  productName: 'Beignets du matin',
  awarenessLevel: 'solution_aware',
  format: '9:16',
  market: 'CM',
  sceneDescription: 'une vendeuse souriante tend une assiette de beignets dorés, lumière du matin',
  purpose: 'content',
  duration: 6,
  language: 'fr',
};

describe('Rendu vidéo par fal.ai', () => {
  it('passe devant Veo, avec la clé en « Key », une durée en nombre, le 720p et les interdits dans la consigne', async () => {
    const { agent } = await signInWithPlan(app, 'fal-depot@exemple.test', 'pro');
    const lance = await agent.post('/api/creatives/videos').send(BRIEF).expect(202);
    assert.equal(lance.body.status, 'queued');

    const depot = depots.at(-1)!;
    assert.equal(depot.cle, 'Key cle-fal-de-test');
    assert.equal(depot.corps.aspect_ratio, '9:16');
    assert.equal(depot.corps.duration, 6);
    assert.equal(depot.corps.resolution, '720p');
    assert.equal(depot.corps.negative_prompt, undefined, 'ce modèle n’a pas de consigne négative');
    assert.match(String(depot.corps.prompt), /Avoid: .*brand logos/);
  });

  it('suit le rendu sur la racine de l’application, relaie le fichier à son seul auteur, sans montrer le lien', async () => {
    const { agent } = await signInWithPlan(app, 'fal-suivi@exemple.test', 'pro');
    const requestId = (await agent.post('/api/creatives/videos').send(BRIEF).expect(202)).body.requestId as string;

    const enCours = await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(enCours.body.status, 'in_progress');
    assert.ok(suivis.every((chemin) => chemin.startsWith(`/${RACINE}/requests/`)));

    termines.add(requestId);
    const fini = await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(fini.body.status, 'completed');
    assert.equal(fini.body.mediaType, 'video');
    assert.equal(fini.body.extendable, false, 'une vidéo fal ne se prolonge pas');
    assert.ok(typeof fini.body.availableUntil === 'string', 'l’échéance est annoncée comme pour toute vidéo');
    assert.ok(!JSON.stringify(fini.body).includes('fichiers/video'));

    const fichier = await agent.get(`/api/creatives/requests/${requestId}/file`).buffer(true).expect(200);
    assert.equal(fichier.headers['content-type'], 'video/mp4');

    const liste = (await agent.get('/api/creatives/videos').expect(200)).body.videos as { requestId: string; status: string }[];
    assert.deepEqual(liste.map((video) => [video.requestId, video.status]), [[requestId, 'completed']]);

    const { agent: intrus } = await signInWithPlan(app, 'fal-intrus@exemple.test', 'pro');
    await intrus.get(`/api/creatives/requests/${requestId}/file`).expect(404);
  });

  it('copie la vidéo terminée pour la durée du palier, puis la sert quand fal a effacé l’original', async () => {
    falEfface = false;
    const { agent } = await signInWithPlan(app, 'fal-archive@exemple.test', 'pro');
    const requestId = (await agent.post('/api/creatives/videos').send(BRIEF).expect(202)).body.requestId as string;
    termines.add(requestId);
    const fini = await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(fini.body.retentionDays, 30, 'le palier Pro garde ses vidéos trente jours');

    // La copie part après la réponse : on attend qu'elle arrive.
    for (let essai = 0; essai < 50 && !objets.has(`fal/${requestId}.mp4`); essai += 1) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(objets.get(`fal/${requestId}.mp4`), MP4, 'la vidéo est copiée à l’identique, rangée sous « fal/ »');

    falEfface = true;
    const fichier = await agent.get(`/api/creatives/requests/${requestId}/file`).buffer(true).expect(200);
    assert.deepEqual(Buffer.from(fichier.body as Buffer), MP4);
    falEfface = false;
  });

  it('un rendu terminé sans fichier est un échec : les points sont rendus, rien n’est livré comme réussi', async () => {
    const { agent } = await signInWithPlan(app, 'fal-echec@exemple.test', 'pro');
    const solde = async () => (await agent.get('/api/account/credits').expect(200)).body.credits.total as number;
    const depart = await solde();
    const requestId = (await agent.post('/api/creatives/videos').send(BRIEF).expect(202)).body.requestId as string;
    assert.ok((await solde()) < depart);

    rates.add(requestId);
    const echec = await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(echec.body.status, 'failed');
    assert.doesNotMatch(JSON.stringify(echec.body), /\bfal\b|policy|Gemini/i);
    assert.equal(await solde(), depart, 'les points sont rendus');
  });

  it('« Vidéo longue » n’est pas proposée, et une demande qui l’exige part comme un plan de 8 s', async () => {
    const { body } = await (await import('supertest')).default(app).get('/api/health').expect(200);
    assert.equal(body.providers.video, true);
    assert.equal(body.providers.videoExtension, false);

    const { agent } = await signInWithPlan(app, 'fal-longue@exemple.test', 'pro');
    await agent.post('/api/creatives/videos').send({ ...BRIEF, duration: 8, extendable: true }).expect(202);
    assert.equal(depots.at(-1)!.corps.duration, 8);
  });
});

describe('Compte fal.ai à sec', () => {
  it('rend les points, ferme la vidéo à l’écran, le dit à l’administration, et rouvre au premier dépôt accepté', async () => {
    const { default: request } = await import('supertest');
    const { agent } = await signInWithPlan(app, 'fal-a-sec@exemple.test', 'pro');
    const solde = async () => (await agent.get('/api/account/credits').expect(200)).body.credits.total as number;
    const depart = await solde();

    aSec = true;
    const refus = await agent.post('/api/creatives/videos').send(BRIEF);
    assert.equal(refus.status, 503);
    assert.doesNotMatch(JSON.stringify(refus.body), /\bfal\b|balance|locked|billing/i, 'rien du fournisseur ne sort');
    assert.equal(await solde(), depart, 'les points sont rendus');
    assert.equal((await request(app).get('/api/health').expect(200)).body.providers.video, false, 'le bouton se ferme pour tous');

    const { checkServices } = await import('@server/services/admin/services');
    const ligne = (await checkServices({ refresh: true })).services.find((service) => service.id === 'fal');
    assert.equal(ligne?.state, 'error');
    assert.match(ligne?.action ?? '', /fal\.ai\/dashboard\/billing/);

    // Le propriétaire recharge : le premier dépôt accepté rouvre la vidéo.
    aSec = false;
    await agent.post('/api/creatives/videos').send(BRIEF).expect(202);
    assert.equal((await request(app).get('/api/health').expect(200)).body.providers.video, true);
  });
});

describe('Corps envoyé selon la famille du modèle', () => {
  it('Veo 3.1 chez fal : durée en texte, consigne négative, son demandé', async () => {
    const { buildFalVideoInput } = await import('@server/services/creatives');
    const corps = buildFalVideoInput({ ...BRIEF, duration: 4 } as Parameters<typeof buildFalVideoInput>[0], 'fal-ai/veo3.1/fast');
    assert.equal(corps.duration, '4s');
    assert.equal((corps as { generate_audio?: boolean }).generate_audio, true);
    assert.match(String((corps as { negative_prompt?: string }).negative_prompt), /brand logos/);
  });

  it('le suivi se lit sur la racine de l’application', async () => {
    const { falAppOf } = await import('@server/services/fal');
    assert.equal(falAppOf('google/gemini-omni-flash/v1.1/text-to-video'), 'google/gemini-omni-flash');
    assert.equal(falAppOf('fal-ai/veo3.1/fast'), 'fal-ai/veo3.1');
  });
});
