import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Storybook : le conte est écrit, relu et corrigé par son auteur, enregistré, puis téléchargé en PDF.
 * L'illustration des contes est retirée depuis le 28/10/2026 ; les contes illustrés d'avant (Gamma)
 * restent téléchargeables. Contre un faux Gemini et un faux Gamma : aucun vrai conte, aucun crédit.
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
  it('écrit le conte pour 3 points, enregistre le texte corrigé sans rien de plus, et sert son PDF', async () => {
    const { agent } = await signInWithPlan(app, 'conte-ecrit@exemple.test', 'pro');
    const solde = async () => (await agent.get('/api/auth/me').expect(200)).body.account.credits.total as number;
    const depart = await solde();

    const ecrit = await agent.post('/api/storybook/stories').send(BRIEF).expect(200);
    const story = ecrit.body.story as { title: string; pages: { heading: string; text: string; illustration: string }[] };
    assert.equal(story.pages.length, BRIEF.pages);
    assert.equal(depart - (await solde()), 3, 'l’écriture seule est facturée');
    assert.equal(gammaCalls.length, 0, 'aucune mise en page externe');

    const corrige = { ...story, pages: story.pages.map((page, index) => (index === 0 ? { ...page, text: 'Awa se lève avant le soleil, le cœur battant.' } : page)) };
    const enregistre = await agent.post('/api/storybook/books').send({ ...BRIEF, story: corrige }).expect(201);
    const storybookId = enregistre.body.storybookId as string;
    assert.equal(depart - (await solde()), 3, 'enregistrer ne coûte rien de plus');

    const liste = (await agent.get('/api/storybook/books').expect(200)).body.storybooks as { id: string; status: string; story: typeof story }[];
    const conte = liste.find((entry) => entry.id === storybookId);
    assert.equal(conte?.status, 'completed');
    assert.equal(conte?.story.pages[0]?.text, 'Awa se lève avant le soleil, le cœur battant.', 'le texte corrigé est celui qui est gardé');

    const pdf = await agent.get(`/api/storybook/books/${storybookId}/pdf`).buffer(true).expect(200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(Buffer.from(pdf.body as Buffer).subarray(0, 4).toString('latin1'), '%PDF');

    const { agent: intrus } = await signInWithPlan(app, 'conte-intrus@exemple.test', 'pro');
    await intrus.get(`/api/storybook/books/${storybookId}/pdf`).expect(404);
  });

  it('refuse d’enregistrer un conte rendu non conforme par une correction', async () => {
    const { agent } = await signInWithPlan(app, 'conte-conformite@exemple.test', 'pro');
    const ecrit = await agent.post('/api/storybook/stories').send(BRIEF).expect(200);
    const story = ecrit.body.story as { pages: { text: string }[] };
    const corrige = { ...ecrit.body.story, pages: story.pages.map((page, index) => (index === 0 ? { ...page, text: '500 000 FCFA/mois garantis dès le premier mois.' } : page)) };
    const refus = await agent.post('/api/storybook/books').send({ ...BRIEF, story: corrige }).expect(422);
    assert.equal(refus.body.error.code, 'BRIEF_NON_COMPLIANT');
  });

  it('ne propose plus d’illustration, et reste fermé au palier Gratuit', async () => {
    const { agent } = await signInWithPlan(app, 'conte-illustration@exemple.test', 'pro');
    await agent.post('/api/storybook/generations').send(BRIEF).expect(404);

    const { agent: gratuit } = await signInWithPlan(app, 'conte-gratuit@exemple.test', 'free');
    const ferme = await gratuit.post('/api/storybook/stories').send(BRIEF).expect(403);
    assert.equal(ferme.body.error.code, 'FEATURE_LOCKED');
  });

  it('sert toujours le PDF d’un conte illustré d’avant, sans révéler le lien d’export', async () => {
    const { agent, userId } = await signInWithPlan(app, 'conte-avant@exemple.test', 'pro');
    const { getDb } = await import('@server/db/client');
    const { storybooks } = await import('@server/db/schema');
    const [row] = await getDb()
      .insert(storybooks)
      .values({
        userId,
        generationRef: 'gen_avant',
        gammaId: 'g_gen_avant',
        title: 'Awa et le manguier',
        language: 'fr',
        country: 'CM',
        pages: 6,
        story: fakeStory(6, '') as unknown as Record<string, unknown>,
        status: 'completed',
      })
      .returning({ id: storybooks.id });

    const pdf = await agent.get(`/api/storybook/books/${row!.id}/pdf`).buffer(true).expect(200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(Buffer.from(pdf.body as Buffer).subarray(0, 4).toString('latin1'), '%PDF');
    assert.ok(!JSON.stringify(pdf.headers).includes('gamma-export.test'), 'le lien d’export ne sort pas du serveur');
  });
});
