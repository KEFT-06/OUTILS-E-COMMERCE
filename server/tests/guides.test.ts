import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { STRONG_PASSWORD, closeTestApp, createAdmin, createTestApp } from './support/helpers';

/**
 * Guides multilingues de bout en bout, contre un faux Gemini (texte et images) : aucune vraie
 * traduction ni image n'est produite.
 */

const geminiCalls: { key: string | undefined; prompt: string }[] = [];
const imageCalls: { model: string; prompt: string; aspectRatio: string | undefined; modalities: string[] }[] = [];

/** Faux traducteur : préfixe chaque texte par la langue visée, sans toucher chiffres ni liens. */
function fakeTranslation(prompt: string) {
  const target = /into (.+?)\.\n/.exec(prompt)?.[1] ?? '?';
  const tag = target.slice(0, 2).toUpperCase();
  const source = JSON.parse(prompt.split('SOURCE (JSON):\n')[1]!) as {
    title?: string;
    sections: { id: string; heading: string; body: string }[];
  };
  const mark = (text: string) => (text ? `[${tag}] ${text}` : '');
  return { title: mark(source.title ?? ''), sections: source.sections.map((section) => ({ id: section.id, heading: mark(section.heading), body: mark(section.body) })) };
}

/** Une image PNG minimale : la signature suffit, le serveur ne la décode pas. */
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

    const imageModel = /^\/gemini\/v1beta\/models\/([\w.-]*image[\w.-]*):generateContent$/.exec(url.pathname);
    if (imageModel && req.method === 'POST') {
      const prompt = (body.contents as { parts: { text: string }[] }[])[0]!.parts[0]!.text;
      const config = body.generationConfig as { responseModalities: string[]; imageConfig?: { aspectRatio?: string } };
      imageCalls.push({ model: imageModel[1]!, prompt, aspectRatio: config.imageConfig?.aspectRatio, modalities: config.responseModalities });
      if (prompt.includes('Facturation absente')) {
        return send(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0' } });
      }
      return send(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] });
    }

    if (url.pathname.startsWith('/gemini/v1beta/models/') && req.method === 'POST') {
      const key = req.headers['x-goog-api-key'] as string | undefined;
      const prompt = (body.contents as { parts: { text: string }[] }[])[0]!.parts[0]!.text;
      geminiCalls.push({ key, prompt });
      if (key !== 'cle-gemini-de-test') return send(403, { error: { message: 'clé refusée' } });
      return send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(fakeTranslation(prompt)) }] } }] });
    }

    send(404, {});
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((resolve) => fakeProviders.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fakeProviders.address() as AddressInfo).port}`;
  app = await createTestApp({ GEMINI_API_URL: `${base}/gemini` });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => fakeProviders.close(() => resolve()));
});

async function author(email: string, plan: 'free' | 'pro') {
  const { createUserRecord } = await import('@server/services/accounts');
  const { hashPassword } = await import('@server/services/auth/password');
  await createUserRecord({ name: 'Auteure Test', email, passwordHash: await hashPassword(STRONG_PASSWORD), role: 'user', plan });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD }).expect(200);
  return agent;
}

const GUIDE = {
  title: 'Élever des poulets en ville',
  sourceLanguage: 'fr',
  terms: ['PouletPro'],
  sections: [
    { id: 's1', heading: 'Budget', body: 'Prévoir 150 000 FCFA pour 50 poussins avec la méthode PouletPro. Détails : https://exemple.com/guide' },
    { id: 's2', heading: 'Alimentation', body: 'Deux repas par jour, eau propre changée matin et soir.' },
  ],
};

type Translation = { language: string; level: string; status: string; checks: { code: string; severity: string }[]; reviewerComment: string | null };
const translationOf = (body: { guide: { translations: Translation[] } }, language: string) =>
  body.guide.translations.find((translation) => translation.language === language)!;

describe('Guides multilingues', () => {
  it('traduit dans les langues du palier, contrôle la traduction et la fait valider par l’auteur', async () => {
    const agent = await author('auteure-gratuit@exemple.com', 'free');
    const created = await agent.post('/api/guides').send(GUIDE).expect(201);
    const guideId = created.body.guide.id as string;

    const limited = await agent.post(`/api/guides/${guideId}/translations`).send({ languages: ['en', 'ar'] }).expect(403);
    assert.equal(limited.body.error.code, 'GUIDE_LANGUAGE_LIMIT', 'une seule langue au palier Gratuit');

    const translated = await agent.post(`/api/guides/${guideId}/translations`).send({ languages: ['en'] }).expect(200);
    const english = translationOf(translated.body, 'en');
    assert.equal(english.level, 'C');
    assert.deepEqual(english.checks, [], 'chiffres, lien et nom de marque conservés');
    assert.equal(translated.body.failures.length, 0);

    const call = geminiCalls.at(-1)!;
    assert.equal(call.key, 'cle-gemini-de-test', 'clé envoyée en en-tête, jamais dans l’adresse');
    assert.match(call.prompt, /into English\./);
    assert.match(call.prompt, /"PouletPro"/);

    const me = await agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.account.credits.total, 1, '3 points, 2 pour la traduction');

    // L'auteur retire un prix : avertissement, pas de blocage.
    const edited = await agent
      .put(`/api/guides/${guideId}/translations/en`)
      .send({ title: '[EN] Raising chickens in town', sections: [{ id: 's1', heading: '[EN] Budget', body: '[EN] Plan a budget for 50 chicks with PouletPro. https://exemple.com/guide' }] })
      .expect(200);
    const warned = translationOf(edited.body, 'en');
    assert.deepEqual(warned.checks.map((check) => check.code), ['NUMBERS']);
    assert.equal(warned.checks[0]!.severity, 'warning');

    const validated = await agent.post(`/api/guides/${guideId}/translations/en/validate`).expect(200);
    assert.equal(translationOf(validated.body, 'en').level, 'B');

    const locked = await agent.post(`/api/guides/${guideId}/translations/en/review`).send({ consent: true }).expect(403);
    assert.equal(locked.body.error.code, 'FEATURE_LOCKED', 'relecture native fermée au palier Gratuit');

    const other = await author('curieux@exemple.com', 'free');
    await other.get(`/api/guides/${guideId}`).expect(404);
  });

  it('confie la relecture à un locuteur natif, qui ne voit le texte qu’après l’avoir prise en charge', async () => {
    const agent = await author('auteure-pro@exemple.com', 'pro');
    const created = await agent.post('/api/guides').send(GUIDE).expect(201);
    const guideId = created.body.guide.id as string;
    await agent.post(`/api/guides/${guideId}/translations`).send({ languages: ['es'] }).expect(200);

    const balance = async () => (await agent.get('/api/auth/me').expect(200)).body.account.credits.total as number;
    const beforeRequest = await balance();

    await agent.post(`/api/guides/${guideId}/translations/es/review`).send({}).expect(400);
    const requested = await agent.post(`/api/guides/${guideId}/translations/es/review`).send({ consent: true, note: 'Public : Amérique latine' }).expect(200);
    assert.equal(translationOf(requested.body, 'es').status, 'review_requested');
    assert.equal(await balance(), beforeRequest - 10);

    await agent.post(`/api/guides/${guideId}/translations/es/review/cancel`).expect(200);
    assert.equal(await balance(), beforeRequest, 'annulée avant prise en charge : points rendus');
    await agent.post(`/api/guides/${guideId}/translations/es/review`).send({ consent: true, note: 'Public : Amérique latine' }).expect(200);

    const reviewer = await createAdmin(app, 'relectrice@smartcreator.test');
    await agent.get('/api/reviews').expect(403);

    const empty = await reviewer.agent.get('/api/reviews').expect(200);
    assert.equal(empty.body.queue.length, 0, 'aucune langue déclarée');

    const dashboard = await reviewer.agent.put('/api/reviews/languages').send({ languages: ['es'] }).expect(200);
    assert.equal(dashboard.body.queue.length, 1);
    const item = dashboard.body.queue[0];
    assert.equal(item.to, 'es');
    assert.equal(item.note, 'Public : Amérique latine');
    assert.equal(JSON.stringify(item).includes('Budget'), false, 'le texte reste caché avant la prise en charge');

    const claimed = await reviewer.agent.post(`/api/reviews/${item.id}/claim`).expect(200);
    assert.equal(claimed.body.review.source.sections[0].heading, 'Budget');
    await reviewer.agent.post(`/api/reviews/${item.id}/claim`).expect(409);

    const busy = await agent.put(`/api/guides/${guideId}/translations/es`).send({ title: 'x', sections: [] }).expect(409);
    assert.equal(busy.body.error.code, 'REVIEW_IN_PROGRESS');
    await agent.post(`/api/guides/${guideId}/translations/es/review/cancel`).expect(409);

    await reviewer.agent
      .put(`/api/reviews/${item.id}`)
      .send({ title: 'Criar galinhas na cidade', sections: [{ id: 's2', heading: 'Alimentación', body: 'Dos comidas al día, agua limpia cambiada mañana y tarde.' }] })
      .expect(200);
    await reviewer.agent.post(`/api/reviews/${item.id}/complete`).send({ comment: 'Tournures adaptées au public latino-américain.' }).expect(204);
    await reviewer.agent.get(`/api/reviews/${item.id}`).expect(404);

    const guide = await agent.get(`/api/guides/${guideId}`).expect(200);
    const spanish = translationOf(guide.body, 'es');
    assert.equal(spanish.level, 'A');
    assert.equal(spanish.status, 'ready');
    assert.equal(spanish.reviewerComment, 'Tournures adaptées au public latino-américain.');
  });

  it('génère la couverture, la conserve sur le serveur et ne la montre qu’à son auteur', async () => {
    const agent = await author('auteure-couverture@exemple.com', 'pro');
    const created = await agent.post('/api/guides').send(GUIDE).expect(201);
    const guideId = created.body.guide.id as string;
    const before = (await agent.get('/api/auth/me').expect(200)).body.account.credits.total as number;

    const submitted = await agent
      .post('/api/covers')
      .send({ subject: 'guide', subjectId: guideId, title: GUIDE.title, style: 'illustration' })
      .expect(201);
    assert.equal(submitted.body.cover.status, 'ready', 'Gemini renvoie l’image dans la réponse');
    const call = imageCalls.at(-1)!;
    assert.equal(call.model, 'gemini-3.1-flash-image');
    assert.deepEqual(call.modalities, ['IMAGE']);
    assert.equal(call.aspectRatio, '9:16', 'format portrait des exports');
    assert.match(call.prompt, /no text, letters, numbers/);

    const image = await agent.get(`/api/covers/${submitted.body.cover.id}/image`).buffer(true).expect(200);
    assert.equal(image.headers['content-type'], 'image/png');
    assert.ok(PNG.equals(image.body as Buffer), 'l’image vient de la base, plus du fournisseur');

    const guide = await agent.get(`/api/guides/${guideId}`).expect(200);
    assert.equal(guide.body.guide.cover.status, 'ready');
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account.credits.total, before - 1);

    const stranger = await author('voisine@exemple.com', 'pro');
    await stranger.get(`/api/covers/${submitted.body.cover.id}/image`).expect(404);
    await stranger.post('/api/covers').send({ subject: 'guide', subjectId: guideId, title: 'Vol de guide' }).expect(404);

    // Sans facturation Google, l'offre gratuite refuse toute image : message clair, points rendus, rien d'enregistré.
    const refused = await agent.post('/api/covers').send({ subject: 'guide', subjectId: guideId, title: 'Facturation absente' }).expect(503);
    assert.equal(refused.body.error.code, 'GEMINI_IMAGE_BILLING_REQUIRED');
    assert.match(refused.body.error.message, /points ont été rendus/);
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account.credits.total, before - 1);
    assert.equal((await agent.get(`/api/guides/${guideId}`).expect(200)).body.guide.cover.id, submitted.body.cover.id, 'la couverture précédente reste');
  });

  it('contrôle chiffres, liens et sections quelle que soit l’écriture', async () => {
    const { checkTranslation, parseGuideText } = await import('@server/shared/guides');
    const source = { title: 'Prix', sections: [{ id: 'a', heading: 'Tarif', body: 'Le kit coûte 10 000 FCFA, livré en 3 jours : https://exemple.com' }] };

    const arabic = { title: 'السعر', sections: [{ id: 'a', heading: 'التعريفة', body: 'تبلغ تكلفة المجموعة ١٠٬٠٠٠ فرنك، تُسلَّم خلال ٣ أيام: https://exemple.com' }] };
    assert.deepEqual(checkTranslation(source, arabic, { language: 'ar' }), [], 'chiffres arabes-indiens reconnus');

    const broken = { title: '', sections: [{ id: 'a', heading: 'Price', body: 'The kit costs 1,000 FCFA, delivered in 3 days.' }] };
    const codes = checkTranslation(source, broken, { language: 'en' }).map((check) => check.code);
    assert.deepEqual(codes.sort(), ['LINKS', 'MISSING_TITLE', 'NUMBERS']);

    const missing = checkTranslation(source, { title: 'Price', sections: [] }, { language: 'en' });
    assert.equal(missing[0]!.code, 'MISSING_SECTION');

    let next = 0;
    const sections = parseGuideText('Intro sans titre\n\n# Budget\nPrévoir 50 poussins\n## Soins\nVacciner', () => `id${next++}`);
    assert.deepEqual(
      sections.map((section) => [section.heading, section.body]),
      [
        ['', 'Intro sans titre'],
        ['Budget', 'Prévoir 50 poussins'],
        ['Soins', 'Vacciner'],
      ],
    );
  });
});
