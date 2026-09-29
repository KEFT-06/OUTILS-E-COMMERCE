import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Rendu vidéo par Veo 3.1, contre un faux Google : dépôt, suivi, puis relais du fichier.
 *
 * Ce que ces tests verrouillent a été MESURÉ sur la vraie API le 27 septembre 2026. Aucune
 * de ces bornes n'est publiée, et deux d'entre elles se contredisent d'apparence :
 *
 *   · le carré est REFUSÉ. Aucun modèle vidéo du catalogue Google ne le rend ;
 *   · les durées forment un JEU DISCRET — 4, 6, 8 — et non une plage. Cinq et sept sont
 *     refusés alors que le message d'erreur de Google annonce « une valeur entre 4 et 8 » ;
 *   · le lien de téléchargement n'est PAS public : il exige la clé du serveur. Un relais
 *     ordinaire, sans en-tête, ramènerait un 403.
 */

const MODELE = 'veo-3.1-fast-generate-preview';

interface Depot {
  chemin: string;
  cle: string | undefined;
  corps: Record<string, unknown>;
}

const depots: Depot[] = [];
/** Pilote le faux Google : « quota » le fait répondre comme une réserve épuisée. */
let mode: 'encours' | 'termine' | 'quota' = 'encours';
let compteur = 0;
/** Clés reçues sur le téléchargement du fichier : c'est là que se vérifie l'authentification. */
const telechargements: (string | undefined)[] = [];

const MP4 = Buffer.from('00000018667479706d703432', 'hex');

const fauxGoogle = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://google.test');
    const envoyer = (code: number, corps: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corps));
    };

    // Fichier produit : servi seulement à qui présente la clé.
    if (url.pathname === '/v1beta/files/video-demo:download') {
      telechargements.push(req.headers['x-goog-api-key'] as string | undefined);
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(MP4.length) });
      res.end(MP4);
      return;
    }

    // Dépôt : POST /v1beta/models/{modèle}:predictLongRunning
    // Tout modèle Veo : en « quota », le modèle de secours refuse aussi, sinon il prendrait le relais.
    if (req.method === 'POST' && (url.pathname === `/v1beta/models/${MODELE}:predictLongRunning` || (mode === 'quota' && /^\/v1beta\/models\/veo-[\w.-]+:predictLongRunning$/.test(url.pathname)))) {
      depots.push({
        chemin: url.pathname,
        cle: req.headers['x-goog-api-key'] as string | undefined,
        corps: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      });
      if (mode === 'quota') {
        envoyer(429, { error: { message: 'Quota exceeded for veo requests' } });
        return;
      }
      compteur += 1;
      envoyer(200, { name: `models/${MODELE}/operations/op-${String(compteur).padStart(4, '0')}` });
      return;
    }

    // Suivi : GET /v1beta/models/{modèle}/operations/{id}
    const suivi = new RegExp(`^/v1beta/models/${MODELE}/operations/(op-\\d{4})$`).exec(url.pathname);
    if (req.method === 'GET' && suivi) {
      if (mode !== 'termine') {
        envoyer(200, { name: `models/${MODELE}/operations/${suivi[1]!}`, done: false });
        return;
      }
      envoyer(200, {
        name: `models/${MODELE}/operations/${suivi[1]!}`,
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: [{ video: { uri: `${base}/v1beta/files/video-demo:download` } }],
          },
        },
      });
      return;
    }

    envoyer(404, { error: { message: 'Not Found' } });
  });
});

let app: Express;
let base = '';

before(async () => {
  await new Promise<void>((r) => fauxGoogle.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(fauxGoogle.address() as AddressInfo).port}`;
  app = await createTestApp({ GEMINI_API_KEY: 'cle-google-de-test', GEMINI_API_URL: base });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => fauxGoogle.close(() => r()));
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

describe('Rendu vidéo par Veo', () => {
  it('dépose la demande avec la clé en en-tête, le format et la durée que le modèle accepte', async () => {
    mode = 'encours';
    const { agent } = await signInWithPlan(app, 'veo-depot@exemple.test', 'pro');

    const lance = await agent.post('/api/creatives/videos').send(BRIEF).expect(202);
    assert.equal(lance.body.status, 'queued');
    assert.match(lance.body.requestId, /^op-\d{4}$/, 'seul l’identifiant voyage, jamais le chemin complet');

    const depot = depots.at(-1)!;
    // La clé part en EN-TÊTE, jamais dans l'adresse : une adresse finit dans les journaux.
    assert.equal(depot.cle, 'cle-google-de-test');
    const parametres = (depot.corps as { parameters: Record<string, unknown> }).parameters;
    assert.equal(parametres.aspectRatio, '9:16');
    assert.equal(parametres.durationSeconds, 6, 'une des trois durées que le modèle accepte');
    // Google n'accepte le 1080p qu'en 8 secondes : une vidéo de 6 secondes part en 720p.
    assert.equal(parametres.resolution, '720p', 'le 1080p en 6 secondes serait refusé par Google');
    // Veo accepte une consigne négative, là où le modèle d'IMAGE de Google n'en propose pas.
    // C'est par elle que passe l'interdiction des marques et du texte à l'écran.
    assert.match(String(parametres.negativePrompt), /brand logos/);
  });

  /*
    Le carré est refusé par le modèle. Le serveur doit le refuser AVANT d'appeler Google et
    de facturer : un brief perdu sur une erreur de fournisseur est un brief à réécrire.
  */
  it('refuse le format carré sans même appeler le fournisseur', async () => {
    const avant = depots.length;
    const { agent } = await signInWithPlan(app, 'veo-carre@exemple.test', 'pro');

    await agent.post('/api/creatives/videos').send({ ...BRIEF, format: '1:1' }).expect(400);
    assert.equal(depots.length, avant, 'rien n’a été envoyé, donc rien n’a été facturé');
  });

  /*
    Cinq et dix secondes étaient les deux durées proposées jusqu'ici, et le modèle refuse les
    deux. Le message d'erreur de Google annonce pourtant « une valeur entre 4 et 8 » : s'y
    fier aurait laissé passer le cinq, et fait échouer une génération sur deux.
  */
  it('refuse une durée hors du jeu accepté, malgré ce qu’annonce le message d’erreur du fournisseur', async () => {
    const avant = depots.length;
    const { agent } = await signInWithPlan(app, 'veo-duree@exemple.test', 'pro');

    for (const duration of [5, 10, 7]) {
      await agent.post('/api/creatives/videos').send({ ...BRIEF, duration }).expect(400);
    }
    assert.equal(depots.length, avant, 'aucune de ces durées n’atteint le fournisseur');
  });

  it('suit la génération, puis relaie le fichier à son seul auteur, avec la clé du serveur', async () => {
    mode = 'encours';
    const { agent } = await signInWithPlan(app, 'veo-suivi@exemple.test', 'pro');
    const lance = await agent.post('/api/creatives/videos').send(BRIEF).expect(202);
    const requestId = lance.body.requestId as string;

    const enCours = await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(enCours.body.status, 'queued');

    mode = 'termine';
    const fini = await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(fini.body.status, 'completed');
    assert.equal(fini.body.mediaType, 'video');

    const avant = telechargements.length;
    const fichier = await agent.get(`/api/creatives/requests/${requestId}/file`).buffer(true).expect(200);
    assert.equal(fichier.headers['content-type'], 'video/mp4');
    // Le lien de Google n'est pas public : sans cette clé, le téléchargement rendrait un 403.
    assert.equal(telechargements.length, avant + 1);
    assert.equal(telechargements.at(-1), 'cle-google-de-test');
    // Et le lien lui-même ne sort jamais du serveur.
    assert.ok(!JSON.stringify(fini.body).includes('files/video-demo'));

    const { agent: intrus } = await signInWithPlan(app, 'veo-intrus@exemple.test', 'pro');
    await intrus.get(`/api/creatives/requests/${requestId}/file`).expect(404);
  });

  it('dit clairement que la réserve de rendus est épuisée, et rend les points', async () => {
    mode = 'quota';
    const { agent } = await signInWithPlan(app, 'veo-quota@exemple.test', 'pro');
    const avant = (await agent.get('/api/auth/me').expect(200)).body.account.credits.total as number;

    const refus = await agent.post('/api/creatives/videos').send(BRIEF).expect(429);
    assert.equal(refus.body.error.code, 'VIDEO_QUOTA_EXHAUSTED', 'code neutre : aucun nom de fournisseur');

    const apres = (await agent.get('/api/auth/me').expect(200)).body.account.credits.total as number;
    assert.equal(apres, avant, 'une vidéo qui n’existe pas n’est pas facturée');
    mode = 'encours';
  });
});

describe('Vidéo longue, prolongée par étapes de 7 secondes', () => {
  const solde = async (agent: import('supertest').Agent) => (await agent.get('/api/auth/me').expect(200)).body.account.credits.total as number;

  it('part en 720p, puis se prolonge de 7 s avec la vidéo en octets, 8 points l’étape', async () => {
    mode = 'termine';
    const { agent } = await signInWithPlan(app, 'veo-longue@exemple.test', 'pro');
    const lance = await agent.post('/api/creatives/videos').send({ ...BRIEF, duration: 6, extendable: true }).expect(202);
    const premier = depots.at(-1)!.corps as { parameters: Record<string, unknown> };
    assert.equal(premier.parameters.resolution, '720p', 'seul le 720p se prolonge');
    assert.equal(premier.parameters.durationSeconds, 8, 'une vidéo longue part d’un plan de 8 s');

    const base = await agent.get(`/api/creatives/requests/${lance.body.requestId}`).expect(200);
    assert.equal(base.body.durationSeconds, 8);
    assert.equal(base.body.extendable, true);

    const avant = await solde(agent);
    const etape = await agent
      .post(`/api/creatives/videos/${lance.body.requestId}/extend`)
      .send({ sceneDescription: 'la formatrice se retourne et sourit à la caméra' })
      .expect(202);
    assert.equal(avant - (await solde(agent)), 8, 'une prolongation coûte 8 points');

    const corps = depots.at(-1)!.corps as { instances: { prompt: string; video?: { inlineData?: { mimeType: string; data: string } } }[]; parameters: Record<string, unknown> };
    assert.equal(corps.parameters.resolution, '720p');
    assert.equal(corps.instances[0]!.video?.inlineData?.mimeType, 'video/mp4');
    assert.equal(corps.instances[0]!.video?.inlineData?.data, MP4.toString('base64'), 'la vidéo précédente part en octets, comme le documente Google');
    assert.match(corps.instances[0]!.prompt, /No real brand logos/, 'les garde-fous suivent chaque étape');

    const suite = await agent.get(`/api/creatives/requests/${etape.body.requestId}`).expect(200);
    assert.equal(suite.body.durationSeconds, 15, '8 + 7 secondes');
    assert.equal(suite.body.extendable, true);
  });

  it('refuse, sans rien facturer, une vidéo courte en 1080p ou une vidéo de plus de deux jours', async () => {
    mode = 'termine';
    const { agent } = await signInWithPlan(app, 'veo-longue-refus@exemple.test', 'pro');
    const courte = await agent.post('/api/creatives/videos').send({ ...BRIEF, duration: 8 }).expect(202);
    await agent.get(`/api/creatives/requests/${courte.body.requestId}`).expect(200);
    const avant = await solde(agent);
    const depotsAvant = depots.length;
    const refus = await agent.post(`/api/creatives/videos/${courte.body.requestId}/extend`).send({ sceneDescription: 'suite de la scène' }).expect(409);
    assert.equal(refus.body.error.code, 'VIDEO_NOT_EXTENDABLE');

    const longue = await agent.post('/api/creatives/videos').send({ ...BRIEF, extendable: true }).expect(202);
    await agent.get(`/api/creatives/requests/${longue.body.requestId}`).expect(200);
    const { getDb } = await import('@server/db/client');
    const { generations } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    await getDb().update(generations).set({ completedAt: new Date(Date.now() - 3 * 86_400_000) }).where(eq(generations.providerRef, longue.body.requestId));
    const tard = await agent.post(`/api/creatives/videos/${longue.body.requestId}/extend`).send({ sceneDescription: 'suite de la scène' }).expect(409);
    assert.match(tard.body.error.message, /deux jours/);

    assert.equal(depots.length, depotsAvant + 1, 'seule la seconde vidéo est partie chez Google, aucune prolongation');
    assert.equal(await solde(agent), avant - 12, 'seule la vidéo elle-même a été facturée');
  });

  it('bloque une scène non conforme avant de facturer', async () => {
    mode = 'termine';
    const { agent } = await signInWithPlan(app, 'veo-longue-conformite@exemple.test', 'pro');
    const longue = await agent.post('/api/creatives/videos').send({ ...BRIEF, extendable: true }).expect(202);
    await agent.get(`/api/creatives/requests/${longue.body.requestId}`).expect(200);
    const avant = await solde(agent);
    await agent.post(`/api/creatives/videos/${longue.body.requestId}/extend`).send({ sceneDescription: 'elle annonce : gagnez 500 000 FCFA par mois' }).expect(422);
    assert.equal(await solde(agent), avant);
  });
});
