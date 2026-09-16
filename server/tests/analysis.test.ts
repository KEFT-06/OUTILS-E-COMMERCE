import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { type FakeProviders, signInWithPlan, startFakeProviders } from './analysis-fixtures';
import { closeTestApp, createTestApp } from './helpers';

/**
 * Analyse de niche avec recherche web, contre un faux Gemini et une fausse
 * recherche Perplexity : aucun vrai appel payant. Le serveur doit garder les faits sourcés et
 * écarter tout ce que le modèle avance sans source existante.
 */

let app: Express;
let providers: FakeProviders;

before(async () => {
  providers = await startFakeProviders();
  app = await createTestApp({
    GEMINI_API_URL: `${providers.base}/gemini`,
    PERPLEXITY_API_KEY: 'cle-perplexity-de-test',
    PERPLEXITY_API_URL: `${providers.base}/perplexity`,
  });
});

after(async () => {
  await closeTestApp();
  await providers.close();
});

interface Report {
  id: string;
  nicheName: string;
  market: string | null;
  overallVerdict: string | null;
  rates: Record<string, { basis: string; level: string | null; score: number | null; sourceIds?: number[] }>;
  competitors: { name: string; urlOrHandle: string; sourceIds: number[] }[];
  searchTrends: { keyword: string; volume: string | null }[];
  digitalProducts: { id: string; recommendedPrice: number | null; estimatedMarginPercent: number | null; currency: string; pricingNote: string }[];
  adCampaigns: { durationSeconds: number; scenes: { timing: string; phase: string }[]; complianceCheck: unknown[] }[];
  groundingSources: { id: number; url: string }[];
  limitations: string[];
  generator: { webSearch: string | null; model: string };
}

describe('Analyse de niche', () => {
  it('rédige un rapport dont chaque fait de marché renvoie à une source existante', async () => {
    const { agent } = await signInWithPlan(app, 'analyste@exemple.com', 'pro');
    const before = await agent.get('/api/account/credits').expect(200);

    const response = await agent.post('/api/analyze-niche').send({ query: 'élevage de poulets', market: 'CM' }).expect(201);
    const report = response.body as Report;

    // Sources : doublon fusionné, lien javascript: écarté, numérotation continue.
    assert.deepEqual(
      report.groundingSources.map((source) => [source.id, source.url]),
      [
        [1, 'https://agri.example/poulets'],
        [2, 'https://pouletpro.example/formation'],
      ],
    );
    assert.equal(report.generator.webSearch, 'Perplexity');

    // Recherche web : clé en en-tête, pays dans la requête, jamais la clé dans l'adresse.
    assert.ok(providers.searchQueries.length >= 1);
    assert.ok(providers.searchQueries.every((call) => call.token === 'Bearer cle-perplexity-de-test'));
    assert.match(providers.searchQueries[0]!.query ?? '', /élevage de poulets Cameroun/);
    assert.equal(providers.searchQueries[0]!.country, 'CM');

    // Consigne : règles sur les chiffres et sources numérotées transmises au modèle.
    const prompt = providers.geminiCalls.at(-1)!.prompt;
    assert.match(prompt, /N’invente aucun chiffre/);
    assert.match(prompt, /\[2\] PouletPro Académie/);

    // Concurrents : celui qui cite une source inexistante est écarté ; le lien inventé est remplacé par la source.
    assert.equal(report.competitors.length, 1);
    assert.equal(report.competitors[0]!.name, 'PouletPro Académie');
    assert.equal(report.competitors[0]!.urlOrHandle, 'https://pouletpro.example/formation');
    assert.deepEqual(report.competitors[0]!.sourceIds, [2]);

    // Taux : sourcés → appréciation ; source inexistante ou « non évaluable » → non évalué.
    assert.equal(report.rates.demand!.basis, 'assessment');
    assert.deepEqual(report.rates.demand!.sourceIds, [1, 2]);
    assert.equal(report.rates.demand!.score, null, 'aucun score inventé');
    assert.equal(report.rates.opportunity!.basis, 'unavailable');
    assert.equal(report.rates.opportunity!.level, null);
    assert.equal(report.rates.virality!.basis, 'unavailable');
    assert.equal(report.rates.saturation!.basis, 'assessment');
    assert.deepEqual(report.rates.saturation!.sourceIds, [2]);
    assert.equal(report.overallVerdict, 'Opportunité Forte');

    // Aucun chiffre sans source : ni volume, ni prix, ni marge.
    assert.equal(report.searchTrends.length, 2, 'mot-clé en double fusionné');
    assert.ok(report.searchTrends.every((keyword) => keyword.volume === null));
    const product = report.digitalProducts[0]!;
    assert.equal(product.recommendedPrice, null);
    assert.equal(product.estimatedMarginPercent, null);
    assert.equal(product.currency, 'XAF', 'devise du marché visé');
    assert.ok(product.id.startsWith(report.id), 'identifiant unique par rapport');

    // Script : minutage recalé sur 30 s, phase inconnue remplacée, aucune conformité « validée » écrite par l'IA.
    const script = report.adCampaigns[0]!;
    assert.equal(script.durationSeconds, 30);
    assert.equal(script.scenes.at(-1)!.timing.split(' - ')[1], '0:30');
    assert.equal(script.scenes[1]!.phase, 'Agitation');
    assert.deepEqual(script.complianceCheck, []);
    assert.ok(report.limitations.every((limitation) => !limitation.includes('Meta')), 'aucune mention de la collecte Meta retirée');

    // Points : 5 débités, génération enregistrée.
    const afterCredits = await agent.get('/api/account/credits').expect(200);
    assert.equal(before.body.credits.total - afterCredits.body.credits.total, 5);
    assert.equal(afterCredits.body.entries[0].actionId, 'niche_analysis');

    // Rapport conservé : listé, relu à l'identique, invisible pour un autre compte, supprimable.
    const list = await agent.get('/api/reports').expect(200);
    assert.deepEqual(
      list.body.reports.map((entry: { id: string; market: string | null }) => [entry.id, entry.market]),
      [[report.id, 'CM']],
    );
    const reread = await agent.get(`/api/reports/${report.id}`).expect(200);
    assert.deepEqual(reread.body.report, report);

    const { agent: stranger } = await signInWithPlan(app, 'curieuse@exemple.com', 'pro');
    await stranger.get(`/api/reports/${report.id}`).expect(404);
    await stranger.delete(`/api/reports/${report.id}`).expect(404);
    await stranger.get('/api/reports/pas-un-identifiant').expect(404);

    await agent.delete(`/api/reports/${report.id}`).expect(204);
    await agent.get(`/api/reports/${report.id}`).expect(404);
  });

  it('rend les points et ne garde rien quand le modèle échoue ou répond mal', async () => {
    const { agent } = await signInWithPlan(app, 'malchance@exemple.com', 'pro');
    const start = (await agent.get('/api/account/credits').expect(200)).body.credits.total as number;

    const failed = await agent.post('/api/analyze-niche').send({ query: 'panne générale' }).expect(502);
    assert.equal(failed.body.error.code, 'ANALYSIS_FAILED');

    const unreadable = await agent.post('/api/analyze-niche').send({ query: 'illisible' }).expect(502);
    assert.equal(unreadable.body.error.code, 'ANALYSIS_UNREADABLE');

    assert.equal((await agent.get('/api/account/credits').expect(200)).body.credits.total, start, 'points rendus');
    assert.deepEqual((await agent.get('/api/reports').expect(200)).body.reports, []);
  });

  it('refuse l’analyse sans connexion, hors palier ou sans points', async () => {
    const { default: request } = await import('supertest');
    await request(app).post('/api/analyze-niche').send({ query: 'poulets' }).expect(401);

    const { agent } = await signInWithPlan(app, 'gratuit@exemple.com', 'free');
    const refused = await agent.post('/api/analyze-niche').send({ query: 'poulets' }).expect(402);
    assert.equal(refused.body.error.code, 'INSUFFICIENT_CREDITS', 'le palier Gratuit a 3 points, l’analyse en coûte 5');

    await agent.post('/api/analyze-niche').send({ query: 'x' }).expect(400);
    await agent.post('/api/analyze-niche').send({ query: 'poulets', market: 'ZZ' }).expect(400);
  });
});
