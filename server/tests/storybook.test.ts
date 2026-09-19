import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Storybook : Gemini rédige, Gamma met en page et illustre, le serveur sert le PDF. Contre un faux
 * Gemini et un faux Gamma : aucun vrai conte, aucune image, aucun crédit consommé.
 */

interface GammaCall {
  method: string;
  path: string;
  key: string | undefined;
  body: Record<string, unknown> | null;
}

const geminiPrompts: string[] = [];
const gammaCalls: GammaCall[] = [];
const statusPolls = new Map<string, number>();
/** Liens d'export encore valides ; les autres répondent 403, comme un lien expiré. */
const liveExports = new Set<string>();
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');

function fakeStory(pages: number, prompt: string) {
  const written = prompt.includes('conte incomplet') ? pages - 2 : pages;
  return {
    title: prompt.includes('Sans crédit') ? 'Sans crédit' : 'Awa et le manguier',
    characterSheet: 'Seven-year-old Cameroonian girl, dark skin, two puff braids with yellow ribbons, green wrap dress',
    coverIllustration: 'Awa smiling under a young mango tree at sunrise',
    pages: Array.from({ length: written }, (_, index) => ({
      heading: `Scène ${index + 1}`,
      text: `Awa découvre la scène ${index + 1} avec son grand-père, pas à pas.`,
      illustration: `Awa and her grandfather, scene ${index + 1}, warm light ${'detail '.repeat(60)}`,
    })),
  };
}

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

const fakeProviders = createServer((req, res) => {
  void readBody(req).then((text) => {
    const url = new URL(req.url ?? '/', 'http://fournisseurs.test');
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (url.pathname.startsWith('/gemini/v1beta/models/') && req.method === 'POST') {
      const prompt = (body!.contents as { parts: { text: string }[] }[])[0]!.parts[0]!.text;
      geminiPrompts.push(prompt);
      const pages = Number(/en exactement (\d+) pages/.exec(prompt)?.[1] ?? 4);
      return send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(fakeStory(pages, prompt)) }] } }] });
    }

    if (url.pathname.startsWith('/gamma/v1.0/')) {
      const path = url.pathname.slice('/gamma/v1.0'.length);
      gammaCalls.push({ method: req.method ?? '', path, key: req.headers['x-api-key'] as string | undefined, body });
      if (req.headers['x-api-key'] !== 'cle-gamma-de-test') return send(401, { message: 'invalid key' });

      if (path === '/generations' && req.method === 'POST') {
        if (String(body?.inputText).includes('Sans crédit')) return send(402, { message: 'Not enough credits' });
        return send(200, { generationId: `gen_${gammaCalls.length}` });
      }
      const generation = /^\/generations\/([^/]+)$/.exec(path);
      if (generation) {
        const id = generation[1]!;
        const polls = (statusPolls.get(id) ?? 0) + 1;
        statusPolls.set(id, polls);
        if (polls === 1) return send(200, { generationId: id, status: 'pending' });
        const exportUrl = `https://gamma-export.test/${id}.pdf`;
        if (polls === 2) liveExports.add(exportUrl);
        return send(200, {
          generationId: id,
          status: 'completed',
          gammaId: `g_${id}`,
          gammaUrl: `https://gamma.app/docs/${id}`,
          exportUrl,
          credits: { deducted: 212, remaining: 3788 },
        });
      }
      const exportStart = /^\/gammas\/([^/]+)\/export$/.exec(path);
      if (exportStart && req.method === 'POST') return send(200, { exportId: `exp_${exportStart[1]}` });
      const exportStatus = /^\/exports\/([^/]+)$/.exec(path);
      if (exportStatus) {
        const exportUrl = `https://gamma-export.test/${exportStatus[1]}-nouveau.pdf`;
        liveExports.add(exportUrl);
        return send(200, { exportId: exportStatus[1], exportAs: 'pdf', status: 'completed', gammaId: 'g', exportUrl });
      }
    }
    send(404, {});
  });
});

let app: Express;
const originalFetch = globalThis.fetch;

before(async () => {
  await new Promise<void>((resolve) => fakeProviders.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fakeProviders.address() as AddressInfo).port}`;
  app = await createTestApp({ GEMINI_API_URL: `${base}/gemini`, GAMMA_API_KEY: 'cle-gamma-de-test', GAMMA_API_URL: `${base}/gamma` });
  // Les liens d'export de Gamma sont en https : ils sont servis ici, sans réseau.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (target.startsWith('https://gamma-export.test/')) {
      return liveExports.has(target)
        ? new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } })
        : new Response('expiré', { status: 403 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await closeTestApp();
  await new Promise<void>((resolve) => fakeProviders.close(() => resolve()));
});

const BRIEF = {
  country: 'CM',
  language: 'fr',
  ageRange: '6-8',
  pages: 6,
  heroName: 'Awa',
  theme: 'Awa apprend à planter un manguier avec son grand-père',
  culturalElements: 'le marché de Mokolo, le ndolé du dimanche',
};

describe('Storybook', () => {
  it('fait rédiger le conte par Gemini, l’illustre page par page chez Gamma et sert le PDF sans révéler le lien d’export', async () => {
    const { agent } = await signInWithPlan(app, 'conteuse@exemple.com', 'pro');
    const before = (await agent.get('/api/account/credits').expect(200)).body.credits.total as number;

    const created = await agent.post('/api/storybook/generations').send(BRIEF).expect(202);
    assert.equal(created.body.title, 'Awa et le manguier');
    const { generationId, storybookId } = created.body as { generationId: string; storybookId: string };

    // Rédaction : consignes d'âge, de pays, de culture et nombre exact de pages.
    const prompt = geminiPrompts.at(-1)!;
    assert.match(prompt, /en exactement 6 pages/);
    assert.match(prompt, /enfants de 6 à 8 ans/);
    assert.match(prompt, /Cameroun/);
    assert.match(prompt, /le marché de Mokolo/);
    assert.match(prompt, /N’invente aucun fait historique, aucune tradition ni aucun proverbe/);

    // Mise en page : texte gardé tel quel, une carte par page plus la couverture, une illustration Gemini par carte.
    const submission = gammaCalls.find((call) => call.path === '/generations' && call.method === 'POST')!;
    assert.equal(submission.key, 'cle-gamma-de-test');
    const request = submission.body as {
      inputText: string;
      textMode: string;
      cardSplit: string;
      additionalInstructions: string;
      imageOptions: { source: string; model: string; style: string };
      exportAs: string;
      cardOptions: { dimensions: string };
    };
    assert.equal(request.textMode, 'preserve');
    assert.equal(request.cardSplit, 'inputTextBreaks');
    const cards = request.inputText.split('\n---\n');
    assert.equal(cards.length, 7, 'couverture + 6 pages');
    assert.match(cards[0]!, /^# Awa et le manguier/);
    assert.match(cards[3]!, /^# Scène 3\nAwa découvre la scène 3/);
    assert.equal(request.imageOptions.source, 'aiGenerated');
    assert.equal(request.imageOptions.model, 'gemini-3.1-flash-image');
    assert.ok(request.imageOptions.style.length <= 500);
    assert.ok(request.additionalInstructions.length <= 5000, 'limite de Gamma respectée malgré de longues descriptions');
    assert.match(request.additionalInstructions, /Card 1: Awa smiling under a young mango tree/);
    assert.match(request.additionalInstructions, /Card 7: Awa and her grandfather, scene 6/);
    assert.match(request.additionalInstructions, /two puff braids/);
    assert.equal(request.exportAs, 'pdf');
    assert.equal(request.cardOptions.dimensions, '4x3');

    // Suivi : en cours, puis terminé ; ni lien d'export ni crédits Gamma dans la réponse.
    assert.equal((await agent.get(`/api/storybook/generations/${generationId}`).expect(200)).body.status, 'pending');
    const done = await agent.get(`/api/storybook/generations/${generationId}`).expect(200);
    assert.equal(done.body.status, 'completed');
    assert.equal(done.body.storybookId, storybookId);
    assert.doesNotMatch(JSON.stringify(done.body), /gamma-export|credits|3788/);

    const list = await agent.get('/api/storybook/books').expect(200);
    const [entry] = list.body.storybooks as {
      id: string;
      status: string;
      pages: number;
      story: { pages: { text: string }[] };
      gammaUrl: string;
    }[];
    assert.equal(entry!.id, storybookId);
    assert.equal(entry!.status, 'completed');
    assert.equal(entry!.story.pages.length, 6);
    assert.equal(entry!.gammaUrl, `https://gamma.app/docs/${generationId}`);
    assert.doesNotMatch(JSON.stringify(list.body), /gamma-export/);

    // PDF : servi par le serveur, puis réexporté (gratuitement) quand le lien de Gamma a expiré.
    const first = await agent.get(`/api/storybook/books/${storybookId}/pdf`).buffer(true).expect(200);
    assert.equal(first.headers['content-type'], 'application/pdf');
    assert.match(first.headers['content-disposition'] ?? '', /attachment; filename="Awa-et-le-manguier\.pdf"/);
    assert.ok(PDF.equals(first.body as Buffer));

    liveExports.clear();
    const again = await agent.get(`/api/storybook/books/${storybookId}/pdf`).buffer(true).expect(200);
    assert.ok(PDF.equals(again.body as Buffer));
    assert.ok(
      gammaCalls.some((call) => call.method === 'POST' && call.path === `/gammas/g_${generationId}/export`),
      'nouvel export demandé',
    );

    assert.equal((await agent.get('/api/account/credits').expect(200)).body.credits.total, before - 15);

    const { agent: stranger } = await signInWithPlan(app, 'voisin-conte@exemple.com', 'pro');
    await stranger.get(`/api/storybook/books/${storybookId}/pdf`).expect(404);
    await stranger.get(`/api/storybook/generations/${generationId}`).expect(404);
    assert.deepEqual((await stranger.get('/api/storybook/books').expect(200)).body.storybooks, []);
  });

  it('rend les points et n’enregistre rien quand la rédaction ou Gamma échoue', async () => {
    const { agent } = await signInWithPlan(app, 'conte-rate@exemple.com', 'pro');
    const before = (await agent.get('/api/account/credits').expect(200)).body.credits.total as number;
    const submissionsBefore = gammaCalls.filter((call) => call.path === '/generations' && call.method === 'POST').length;

    const incomplete = await agent
      .post('/api/storybook/generations')
      .send({ ...BRIEF, theme: 'conte incomplet sur la patience' })
      .expect(502);
    assert.equal(incomplete.body.error.code, 'STORY_UNREADABLE');
    assert.equal(
      gammaCalls.filter((call) => call.path === '/generations' && call.method === 'POST').length,
      submissionsBefore,
      'Gamma n’est pas appelé',
    );

    const noCredits = await agent
      .post('/api/storybook/generations')
      .send({ ...BRIEF, heroName: 'Sans crédit' })
      .expect(503);
    assert.equal(noCredits.body.error.code, 'GAMMA_INSUFFICIENT_CREDITS');

    assert.equal((await agent.get('/api/account/credits').expect(200)).body.credits.total, before, 'points rendus');
    assert.deepEqual((await agent.get('/api/storybook/books').expect(200)).body.storybooks, []);
  });
});
