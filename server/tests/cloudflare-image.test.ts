import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { STRONG_PASSWORD, closeTestApp, createTestApp } from './support/helpers';

/**
 * Couvertures par Cloudflare Workers AI, contre un faux Cloudflare et un faux Gemini.
 *
 * Ce que ces tests verrouillent tient à des différences mesurées sur la vraie API, qu'aucune
 * documentation ne donne : le modèle rapide refuse width et height, et le modèle de qualité
 * écrit un titre inventé dès qu'on lui en souffle un.
 */

const ACCOUNT = 'a'.repeat(32);

interface CloudflareCall {
  model: string;
  prompt: string;
  negativePrompt: string | undefined;
  width: number | undefined;
  height: number | undefined;
  steps: number | undefined;
  authorization: string | undefined;
}

const cloudflareCalls: CloudflareCall[] = [];
const geminiImageCalls: { prompt: string }[] = [];
/** Pilote le faux Cloudflare depuis un test : « quota » le fait répondre comme une réserve vide. */
let cloudflareMode: 'ok' | 'quota' | 'refus' = 'ok';

/** JPEG minimal : seuls les premiers octets comptent, le serveur ne décode pas l'image. */
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'), Buffer.alloc(64, 7), Buffer.from('ffd9', 'hex')]);
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

const fakeProviders = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://fournisseurs.test');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const body = chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};

    const run = /^\/cf\/accounts\/([0-9a-f]+)\/ai\/run\/(.+)$/.exec(url.pathname);
    if (run && req.method === 'POST') {
      assert.equal(run[1], ACCOUNT, 'le compte voyage dans le chemin');
      cloudflareCalls.push({
        model: decodeURIComponent(run[2]!),
        prompt: body.prompt as string,
        negativePrompt: body.negative_prompt as string | undefined,
        width: body.width as number | undefined,
        height: body.height as number | undefined,
        steps: body.steps as number | undefined,
        authorization: req.headers.authorization,
      });
      if (cloudflareMode === 'quota')
        return send(429, { success: false, errors: [{ code: 3036, message: 'Account limited. Daily neuron quota exceeded.' }] });
      if (cloudflareMode === 'refus') return send(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] });
      return send(200, { success: true, result: { image: JPEG.toString('base64'), usage: { neurons: 3449 } } });
    }

    if (/^\/gemini\/v1beta\/models\/[\w.-]*image[\w.-]*:generateContent$/.test(url.pathname) && req.method === 'POST') {
      geminiImageCalls.push({ prompt: (body.contents as { parts: { text: string }[] }[])[0]!.parts[0]!.text });
      return send(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] });
    }

    send(404, {});
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((resolve) => fakeProviders.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fakeProviders.address() as AddressInfo).port}`;
  app = await createTestApp({
    GEMINI_API_URL: `${base}/gemini`,
    CLOUDFLARE_AI_URL: `${base}/cf`,
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    CLOUDFLARE_AI_TOKEN: 'jeton-cloudflare-de-test',
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => fakeProviders.close(() => resolve()));
});

const GUIDE = {
  title: 'Élever des poulets en ville',
  sourceLanguage: 'fr',
  terms: [],
  sections: [{ id: 's1', heading: 'Budget', body: 'Prévoir 150 000 FCFA pour 50 poussins, nourriture comprise.' }],
};

async function author(email: string) {
  const { createUserRecord } = await import('@server/services/accounts');
  const { hashPassword } = await import('@server/services/auth/password');
  await createUserRecord({ name: 'Auteure Test', email, passwordHash: await hashPassword(STRONG_PASSWORD), role: 'user', plan: 'pro', country: 'CM' });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD }).expect(200);
  return agent;
}

async function createCover(agent: request.Agent) {
  const created = await agent.post('/api/guides').send(GUIDE).expect(201);
  return agent
    .post('/api/covers')
    .send({ subject: 'guide', subjectId: created.body.guide.id as string, title: GUIDE.title, style: 'illustration' })
    .expect(201);
}

describe('Couvertures par Cloudflare Workers AI', () => {
  it('appelle le modèle de qualité au format demandé, sans lui présenter le sujet comme un titre', async () => {
    cloudflareMode = 'ok';
    const agent = await author('couverture-cloudflare@exemple.com');
    const response = await createCover(agent);
    assert.equal(response.body.cover.status, 'ready');

    const call = cloudflareCalls.at(-1)!;
    assert.equal(call.model, '@cf/leonardo/lucid-origin', 'seul ce modèle accepte un format libre');
    assert.equal(call.authorization, 'Bearer jeton-cloudflare-de-test', 'le jeton part en en-tête');
    // 720 x 1280 : exactement 9:16, multiples de 16, environ un mégapixel. Au-delà la facture
    // monte au carré, le prix par étape se payant par tuile de 512.
    assert.equal(call.width, 720);
    assert.equal(call.height, 1280);
    assert.equal(call.steps, 20);
    assert.match(call.negativePrompt ?? '', /text/, 'la consigne négative retient le modèle d’écrire');

    // Le cœur du correctif : le sujet reste nécessaire au modèle, mais il ne lui est plus
    // présenté COMME un titre. Sur la vraie API, « Cover artwork for a guide titled "…" »
    // rendait une maquette complète, titre compris, en caractères inventés — malgré la consigne
    // « aucun texte ». Sans ce cadrage, et avec la consigne négative, la scène reste muette.
    assert.doesNotMatch(call.prompt, /titled|book cover|cover artwork/i, 'rien ne présente le sujet comme un titre');
    assert.ok(!call.prompt.includes(`"${GUIDE.title}"`), 'le sujet n’est jamais cité entre guillemets');
    assert.match(call.prompt, /no text, no letters, no numbers/);
    assert.match(call.prompt, /Cameroun/, 'la scène est ancrée dans le pays du compte');

    // Le format est reconnu aux premiers octets : Cloudflare ne le déclare nulle part.
    const image = await agent.get(`/api/covers/${response.body.cover.id as string}/image`).buffer(true).expect(200);
    assert.equal(image.headers['content-type'], 'image/jpeg');
  });

  it('bascule sur Gemini quand la réserve Cloudflare du jour est vide, plutôt que de refuser', async () => {
    cloudflareMode = 'quota';
    const avant = geminiImageCalls.length;
    const agent = await author('couverture-reserve-vide@exemple.com');
    const response = await createCover(agent);

    assert.equal(response.body.cover.status, 'ready', 'le client paie ses points : il obtient sa couverture');
    assert.equal(geminiImageCalls.length, avant + 1, 'Gemini a pris le relais');
    const image = await agent.get(`/api/covers/${response.body.cover.id as string}/image`).buffer(true).expect(200);
    assert.equal(image.headers['content-type'], 'image/png', 'l’image vient bien du second fournisseur');
  });

  it('signale un jeton sans droits dans l’état des services, une fois le repli consommé', async () => {
    cloudflareMode = 'refus';
    const agent = await author('couverture-jeton-refuse@exemple.com');
    await createCover(agent);

    const { checkServices } = await import('@server/services/admin/services');
    const report = await checkServices({ refresh: true });
    const images = report.services.find((service) => service.id === 'images')!;
    assert.equal(images.state, 'error');
    assert.match(images.action ?? '', /lecture ET en écriture/, 'le conseil dit quoi refaire');
  });
});

/**
 * Visuels publicitaires : depuis la bascule, l'image n'arrive plus par un lien à relayer mais
 * en octets, qu'il faut donc garder. Ces trois tests verrouillent ce que la bascule change —
 * le fournisseur choisi, l'endroit où le fichier vit, et le fait qu'il y survive.
 */
describe('Visuels publicitaires produits chez nous', () => {
  const BRIEF = {
    productName: 'Formation couture',
    awarenessLevel: 'problem_aware',
    format: '9:16',
    market: 'CM',
    sceneDescription: 'une couturière devant sa machine dans son atelier, lumière du matin',
    purpose: 'content',
  };

  it('produit le visuel chez Cloudflare, le garde, et le sert depuis notre origine', async () => {
    cloudflareMode = 'ok';
    const agent = await author('visuel-cloudflare@exemple.com');

    const lance = await agent.post('/api/creatives/visuals').send(BRIEF).expect(202);
    assert.equal(lance.body.status, 'completed', 'l’image est rendue dans la réponse, pas mise en file');
    assert.equal(lance.body.mediaType, 'image');

    const call = cloudflareCalls.at(-1)!;
    assert.equal(call.model, '@cf/leonardo/lucid-origin');
    assert.equal(call.width, 720, 'le format 9:16 du brief est respecté');
    assert.equal(call.height, 1280);

    const requestId = lance.body.requestId as string;
    const suivi = await agent.get(`/api/creatives/requests/${requestId}`).expect(200);
    assert.equal(suivi.body.status, 'completed');

    /*
      Le point de la bascule : Higgsfield effaçait ses fichiers au bout de sept jours. Celui-ci
      est en base, servi par nous, et ne dépend plus d'aucune rétention chez un tiers.
    */
    const fichier = await agent.get(`/api/creatives/requests/${requestId}/file`).buffer(true).expect(200);
    assert.equal(fichier.headers['content-type'], 'image/jpeg');
    assert.ok(Number(fichier.headers['content-length']) > 0);
  });

  it('ne montre le visuel qu’à son auteur', async () => {
    cloudflareMode = 'ok';
    const auteure = await author('visuel-proprietaire@exemple.com');
    const lance = await auteure.post('/api/creatives/visuals').send(BRIEF).expect(202);

    const autre = await author('visuel-intruse@exemple.com');
    await autre.get(`/api/creatives/requests/${lance.body.requestId as string}/file`).expect(404);
  });

  /*
    Le repli vaut pour les visuels comme pour les couvertures : un client qui vient de payer
    ses points repart avec son image, même si Cloudflare l'a refusée. C'est aussi ce qui
    justifie que la ligne dise « interne » et non « cloudflare » — ici, c'est Gemini qui a
    dessiné, et le fichier est tout de même gardé et servi par nous.
  */
  it('garde et sert le visuel même quand c’est Gemini qui a dû le dessiner', async () => {
    cloudflareMode = 'refus';
    const avant = geminiImageCalls.length;
    const agent = await author('visuel-repli-gemini@exemple.com');

    const lance = await agent.post('/api/creatives/visuals').send(BRIEF).expect(202);
    assert.equal(geminiImageCalls.length, avant + 1, 'Gemini a pris le relais');

    const fichier = await agent
      .get(`/api/creatives/requests/${lance.body.requestId as string}/file`)
      .buffer(true)
      .expect(200);
    assert.equal(fichier.headers['content-type'], 'image/png', 'l’image vient bien du second fournisseur');
  });
});
