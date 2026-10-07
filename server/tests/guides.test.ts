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
/** Tout lot de traduction dont le texte contient cette marque est refusé par le faux service. */
let lotRefuse: string | null = null;
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
      // Lot refusé net par le service (refus non passager) : sert à simuler une traduction interrompue en route.
      if (lotRefuse && prompt.includes(lotRefuse)) return send(400, { error: { status: 'INVALID_ARGUMENT', message: 'lot refusé pour le test' } });
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
    assert.equal(call.model, 'gemini-3-pro-image');
    assert.deepEqual(call.modalities, ['IMAGE']);
    assert.equal(call.aspectRatio, '9:16', 'format portrait des exports');
    assert.match(call.prompt, /no text, no letters, no numbers/);
    // Le titre transmis au modèle d'image, c'est le titre qu'il dessine : les essais rendaient
    // une maquette de couverture avec un titre en caractères inventés. La consigne ne décrit
    // qu'une scène, et la mise en page pose le vrai titre ensuite.
    assert.doesNotMatch(call.prompt, /titled|book cover artwork/i, 'la consigne ne demande pas une couverture');
    assert.ok(!call.prompt.includes(`"${GUIDE.title}"`), 'le titre n’est jamais cité entre guillemets au modèle');

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
    assert.equal(refused.body.error.code, 'IMAGE_BILLING_REQUIRED', 'code neutre : aucun nom de fournisseur');
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

/*
  Deux défauts signalés par le propriétaire le 07/10/2026, sur l'écran des guides :
    · un ouvrage français était annoncé « anglais » — la langue venait d'une liste, où l'on mettait
      celle qu'on voulait obtenir — et l'anglais lui était alors refusé comme langue de traduction ;
    · un ouvrage du Studio était refusé d'avance : « le guide dépasse 120 000 caractères,
      découpez-le en plusieurs guides ».
*/
describe('Guides multilingues — la langue se lit dans le texte, et la longueur n’est plus un refus', () => {
  const PARAGRAPHE =
    'Quand on commence un petit élevage en ville, il faut d’abord choisir un endroit propre et à l’abri du vent. Les poussins ont besoin de chaleur, d’eau fraîche et d’une nourriture adaptée à leur âge. Ce chapitre explique pas à pas ce que vous devez préparer avant leur arrivée, et les erreurs que la plupart des débutants font la première semaine.';
  const longTexte = (caracteres: number) => Array.from({ length: Math.ceil(caracteres / (PARAGRAPHE.length + 2)) }, () => PARAGRAPHE).join('\n\n');

  it('enregistre un texte français comme français, même déclaré « anglais », et corrige un guide déjà mal classé', async () => {
    const agent = await author('auteure-langue@exemple.com', 'pro');
    const francais = { title: 'Réussir son premier élevage', terms: [], sections: [{ id: 's1', heading: 'Avant de commencer', body: PARAGRAPHE }] };

    // À la création : la liste disait « anglais », le texte dit « français ».
    const cree = await agent.post('/api/guides').send({ ...francais, sourceLanguage: 'en' }).expect(201);
    assert.equal(cree.body.guide.sourceLanguage, 'fr');
    // L'anglais redevient donc une langue de traduction possible.
    const traduit = await agent.post(`/api/guides/${cree.body.guide.id}/translations`).send({ languages: ['en'] }).expect(200);
    assert.equal(translationOf(traduit.body, 'en').status, 'ready');

    // Un guide enregistré avant la correction : il est remis à sa vraie langue dès qu'on le lit.
    const { getDb } = await import('@server/db/client');
    const { guides, users } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const [compte] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, 'auteure-langue@exemple.com'));
    const [ancien] = await getDb()
      .insert(guides)
      .values({ userId: compte!.id, title: 'Guide ancien', sourceLanguage: 'en', sections: francais.sections, terms: [] })
      .returning();
    const liste = await agent.get('/api/guides').expect(200);
    assert.equal((liste.body.guides as { id: string; sourceLanguage: string }[]).find((guide) => guide.id === ancien!.id)?.sourceLanguage, 'fr', 'la liste dit déjà la vraie langue');
    assert.equal((await agent.get(`/api/guides/${ancien!.id}`).expect(200)).body.guide.sourceLanguage, 'fr');

    // Un texte trop court pour se prononcer garde la langue déclarée.
    const court = await agent.post('/api/guides').send({ title: 'Budget', sourceLanguage: 'en', terms: [], sections: [{ id: 's1', heading: 'Budget', body: 'Prévoir 50 poussins.' }] }).expect(201);
    assert.equal(court.body.guide.sourceLanguage, 'en');
  });

  it('accepte un ouvrage long sans rien demander à son auteur, et redécoupe de lui-même un chapitre collé d’un bloc', async () => {
    const agent = await author('auteure-longue@exemple.com', 'pro');
    // 300 000 caractères : deux fois et demie l'ancien plafond.
    const sections = Array.from({ length: 12 }, (_, rang) => ({ id: `c${rang + 1}`, heading: `Chapitre ${rang + 1}`, body: longTexte(25_000) }));
    const cree = await agent.post('/api/guides').send({ title: 'Le grand guide de l’élevage', sourceLanguage: 'fr', terms: [], sections }).expect(201);
    const enregistrees = cree.body.guide.sections as { id: string; heading: string; body: string }[];

    assert.ok(enregistrees.length > 12, 'chaque chapitre de 25 000 caractères continue dans des sections « (suite) »');
    assert.ok(enregistrees.every((section) => section.body.length <= 10_000));
    assert.deepEqual(enregistrees.slice(0, 3).map((section) => section.heading), ['Chapitre 1', 'Chapitre 1 (suite)', 'Chapitre 1 (suite)']);
    assert.equal(new Set(enregistrees.map((section) => section.id)).size, enregistrees.length, 'identifiants distincts');
    const avant = sections.map((section) => section.body).join(' ').replace(/\s+/g, ' ');
    const apres = enregistrees.map((section) => section.body).join(' ').replace(/\s+/g, ' ');
    assert.equal(apres, avant, 'aucun mot perdu en redécoupant');
  });

  it('traduit un guide long par tranches : ce qui n’a pas abouti reprend sans nouveau débit, et rien n’est facturé si rien n’aboutit', async () => {
    const agent = await author('auteure-tranches@exemple.com', 'pro');
    const solde = async () => (await agent.get('/api/auth/me').expect(200)).body.account.credits.total as number;
    // Neuf sections de 5 000 caractères : cinq lots de deux, traduits quatre à la fois.
    const sections = Array.from({ length: 9 }, (_, rang) => ({ id: `s${rang + 1}`, heading: `Partie ${rang + 1}`, body: `${rang === 8 ? 'MARQUE-DU-DERNIER-LOT ' : ''}${longTexte(4_800)}` }));
    const cree = await agent.post('/api/guides').send({ title: 'Guide en neuf parties', sourceLanguage: 'fr', terms: [], sections }).expect(201);
    const guideId = cree.body.guide.id as string;
    const avant = await solde();

    // Le dernier lot est refusé : la tranche rend ce qu'elle a, la traduction reste « en cours ».
    lotRefuse = 'MARQUE-DU-DERNIER-LOT';
    const premiere = await agent.post(`/api/guides/${guideId}/translations`).send({ languages: ['en'] }).expect(200);
    const enCours = translationOf(premiere.body, 'en') as Translation & { progress: { done: number; total: number } | null; sections: { id: string; body: string }[] };
    assert.equal(enCours.status, 'translating');
    assert.deepEqual(enCours.progress, { done: 8, total: 9 });
    assert.deepEqual(enCours.checks, [], 'les contrôles attendent la traduction complète : ils signaleraient tout ce qui reste à venir');
    assert.equal(await solde(), avant - 2, 'la traduction est payée une fois, à son lancement');

    // Tant qu'elle est en cours, on ne la modifie ni ne la valide.
    const occupe = await agent.post(`/api/guides/${guideId}/translations/en/validate`).expect(409);
    assert.equal(occupe.body.error.code, 'TRANSLATION_IN_PROGRESS');
    // Le service refuse encore : la demande suivante ne perd rien de ce qui est fait.
    const encore = await agent.post(`/api/guides/${guideId}/translations/en/continue`).expect(200);
    assert.deepEqual(translationOf(encore.body, 'en').status, 'translating');

    // Le service répond de nouveau : la tranche suivante termine, sans nouveau débit.
    lotRefuse = null;
    const suite = await agent.post(`/api/guides/${guideId}/translations/en/continue`).expect(200);
    const prete = translationOf(suite.body, 'en') as Translation & { progress: unknown; sections: { id: string; body: string }[] };
    assert.equal(prete.status, 'ready');
    assert.equal(prete.progress, null);
    assert.ok(prete.sections.every((section) => section.body.startsWith('[EN] ')), 'les neuf sections sont traduites');
    assert.match(prete.sections[0]!.body, /^\[EN\] Quand on commence/, 'les huit premières n’ont pas été retraduites pour autant');
    assert.equal(await solde(), avant - 2);
    // Une traduction prête n'a plus rien à continuer : la demande ne change rien.
    assert.equal(translationOf((await agent.post(`/api/guides/${guideId}/translations/en/continue`).expect(200)).body, 'en').status, 'ready');

    // Rien n'aboutit du tout : le refus remonte, les points sont rendus, aucune traduction n'est créée.
    lotRefuse = 'Quand on commence';
    try {
      const refuse = await agent.post(`/api/guides/${guideId}/translations`).send({ languages: ['es'] });
      assert.ok(refuse.status >= 400, `refus attendu, reçu ${refuse.status}`);
      assert.equal(await solde(), avant - 2, 'points rendus');
      const guide = (await agent.get(`/api/guides/${guideId}`).expect(200)).body.guide as { translations: { language: string }[] };
      assert.deepEqual(guide.translations.map((translation) => translation.language), ['en']);
    } finally {
      lotRefuse = null;
    }
  });
});
