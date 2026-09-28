import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import type request from 'supertest';
import { type FakeProviders, signInWithPlan, startFakeProviders } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Rapport rédigé à la demande, après l'analyse : jamais rédigé d'office, plan libre, aucun taux
 * transmis au rédacteur, renvois inventés retirés, bibliographie construite par le serveur,
 * conformité contrôlée, points rendus une seule fois en cas d'échec. Faux fournisseurs seulement.
 */

let app: Express;
let providers: FakeProviders;

before(async () => {
  providers = await startFakeProviders();
  app = await createTestApp({
    PERPLEXITY_API_KEY: 'cle-perplexity-de-test',
    PERPLEXITY_API_URL: `${providers.base}/perplexity`,
    PERPLEXITY_RESEARCH_PRESET: 'medium',
  });
});

after(async () => {
  await closeTestApp();
  await providers.close();
});

type TestAgent = ReturnType<typeof request.agent>;

interface Document {
  reportId: string;
  status: 'writing' | 'ready' | 'failed';
  title: string | null;
  markdown: string | null;
  bibliography: { id: number; url: string; site: string; cited: boolean }[];
  compliance: { exportAllowed: boolean; rulesVersion: string } | null;
  error: { code: string; message: string } | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function analyzedReport(agent: TestAgent, query: string): Promise<{ id: string; nicheName: string; groundingSources: { id: number; url: string }[] }> {
  const started = await agent.post('/api/analyze-niche').send({ query, market: 'CM' }).expect(202);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { body } = await agent.get(`/api/analyze-niche/jobs/${started.body.job.id}`).expect(200);
    if (body.job.status === 'completed') return (await agent.get(`/api/reports/${body.job.reportId}`).expect(200)).body.report;
    if (body.job.status === 'failed') throw new Error(JSON.stringify(body.job.error));
    await sleep(50);
  }
  throw new Error('analyse toujours en cours');
}

async function waitForDocument(agent: TestAgent, reportId: string): Promise<Document> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { body } = await agent.get(`/api/reports/${reportId}/document`).expect(200);
    if (body.document && body.document.status !== 'writing') return body.document as Document;
    await sleep(50);
  }
  throw new Error('rapport toujours en cours de rédaction');
}

const balance = async (agent: TestAgent) => (await agent.get('/api/account/credits').expect(200)).body;

describe('Rapport rédigé après l’analyse', () => {
  it('n’est rédigé que sur demande, sans taux, avec la bibliographie des sites consultés', async () => {
    const { agent } = await signInWithPlan(app, 'redaction@exemple.com', 'pro');
    const writerBefore = providers.writerCalls.length;
    const report = await analyzedReport(agent, 'élevage de poulets');
    assert.equal(providers.writerCalls.length - writerBefore, 1, 'l’analyse seule : aucun rapport rédigé d’office');

    const none = await agent.get(`/api/reports/${report.id}/document`).expect(200);
    assert.equal(none.body.document, null);

    const before = await balance(agent);
    const launched = await agent.post(`/api/reports/${report.id}/document`).send({}).expect(202);
    assert.equal(launched.body.document.status, 'writing');
    // Un second clic pendant la rédaction ne relance rien et ne repaie pas.
    await agent.post(`/api/reports/${report.id}/document`).send({}).expect(200);

    const document = await waitForDocument(agent, report.id);
    assert.equal(document.status, 'ready', JSON.stringify(document.error));
    assert.equal(providers.writerCalls.length - writerBefore, 2, 'une seule rédaction malgré le double clic');

    const after = await balance(agent);
    const entry = after.entries.find((line: { actionId: string }) => line.actionId === 'market_report_write');
    assert.ok(entry, 'le débit est tracé sous sa propre action');
    assert.equal(before.credits.total - after.credits.total, 3, 'trois points, débités une seule fois');

    // Ce que le rédacteur a reçu : sources, notes de l'étude, fiche — mais aucun taux.
    const prompt = providers.writerCalls.at(-1)!.prompt;
    assert.match(prompt, /Sources numérotées/);
    assert.match(prompt, /Notes de l’étude du web/, 'les notes de l’étude sont gardées pour le rapport');
    assert.doesNotMatch(prompt, /\/100|Demande|Saturation|Rentabilité|Viralité/, 'aucun taux transmis');

    // Le texte rendu : titre, renvois contrôlés, bibliographie du rédacteur écartée.
    assert.equal(document.title, `Rapport stratégique : ${report.nicheName}`, 'le titre choisi par le rédacteur');
    const markdown = document.markdown!;
    assert.doesNotMatch(markdown, /invente\.example|## Bibliographie/, 'la liste de sources du rédacteur est écartée');
    assert.doesNotMatch(markdown, /\[42\]/, 'un renvoi vers une source inexistante est retiré');
    assert.doesNotMatch(markdown, /\]\(https:/, 'un renvoi en lien redevient un simple renvoi');
    const known = new Set(report.groundingSources.map((source) => source.id));
    for (const match of markdown.matchAll(/\[(\d+)\]/g)) assert.ok(known.has(Number(match[1])), `renvoi [${match[1]}] vers une source réelle`);

    // L'annexe : tous les sites consultés, marqués cités ou non.
    assert.deepEqual(
      document.bibliography.map((source) => source.url),
      report.groundingSources.map((source) => source.url),
    );
    assert.ok(document.bibliography.some((source) => source.cited));
    assert.ok(document.bibliography.every((source) => source.site && !source.site.startsWith('www.')));
    assert.equal(document.compliance?.exportAllowed, true);
    assert.ok(document.compliance?.rulesVersion);

    // Réécrire : nouveau texte, nouveau débit.
    await agent.post(`/api/reports/${report.id}/document`).send({}).expect(202);
    assert.equal((await waitForDocument(agent, report.id)).status, 'ready');
    assert.equal(before.credits.total - (await balance(agent)).credits.total, 6);
  });

  it('rend les points une seule fois quand la rédaction échoue', async () => {
    const { agent } = await signInWithPlan(app, 'redaction-echec@exemple.com', 'pro');
    const report = await analyzedReport(agent, 'rapport refusé');
    const before = await balance(agent);

    await agent.post(`/api/reports/${report.id}/document`).send({}).expect(202);
    const document = await waitForDocument(agent, report.id);
    assert.equal(document.status, 'failed');
    assert.equal(document.error?.code, 'REPORT_FAILED');
    assert.doesNotMatch(document.error!.message, /perplexity|gemini|\bIA\b/i, 'aucun fournisseur nommé');
    assert.equal(document.markdown, null);

    await agent.get(`/api/reports/${report.id}/document`).expect(200);
    assert.equal((await balance(agent)).credits.total, before.credits.total, 'points rendus, une seule fois');
  });

  it('ne laisse lire ni rédiger le rapport d’un autre compte', async () => {
    const { agent: owner } = await signInWithPlan(app, 'redaction-proprietaire@exemple.com', 'pro');
    const report = await analyzedReport(owner, 'apiculture urbaine');
    const { agent: other } = await signInWithPlan(app, 'redaction-intrus@exemple.com', 'pro');

    const read = await other.get(`/api/reports/${report.id}/document`).expect(404);
    assert.equal(read.body.error.code, 'REPORT_NOT_FOUND');
    await other.post(`/api/reports/${report.id}/document`).send({}).expect(404);
    await other.get('/api/reports/pas-un-identifiant/document').expect(404);
  });
});
