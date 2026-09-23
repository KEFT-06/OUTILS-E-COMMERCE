import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { type FakeProviders, fakeAnalysis, signInWithPlan, startFakeProviders } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Sans l'étude de Perplexity, aucune analyse n'est lancée : un rapport sans source n'établirait
 * aucun verdict. Et si un rapport devait être assemblé sans source, aucun fait de marché n'y
 * serait avancé, même proposé par le modèle.
 */

let app: Express;
let providers: FakeProviders;

before(async () => {
  providers = await startFakeProviders();
  app = await createTestApp({ GEMINI_API_URL: `${providers.base}/gemini` });
});

after(async () => {
  await closeTestApp();
  await providers.close();
});

describe('Analyse de niche sans recherche web', () => {
  it('refuse de lancer l’analyse sans retirer de points et dit ce qui manque', async () => {
    const { agent } = await signInWithPlan(app, 'sans-web@exemple.com', 'pro');
    const before = (await agent.get('/api/account/credits').expect(200)).body.credits.total as number;

    const refused = await agent.post('/api/analyze-niche').send({ query: 'formation Excel' }).expect(503);
    assert.equal(refused.body.error.code, 'WEB_SEARCH_NOT_CONFIGURED');
    assert.match(refused.body.error.message, /Aucun point n’a été retiré/);

    assert.equal((await agent.get('/api/account/credits').expect(200)).body.credits.total, before);
    assert.equal(providers.geminiCalls.length, 0, 'Gemini n’est pas appelé');
    assert.equal(providers.agentCalls.length, 0);
    assert.equal((await agent.get('/api/analyze-niche/jobs/active').expect(200)).body.job, null);
  });

  it('n’avance aucun fait sans source, même proposé par le modèle', async () => {
    const { assembleReport } = await import('@server/services/analysis');
    const { buildAnalysisPrompt, parseAnalysisResponse } = await import('@server/services/analysis/prompt');

    const prompt = buildAnalysisPrompt({
      query: 'formation Excel',
      marketName: null,
      today: '17 septembre 2026',
      sources: [],
      webSearchConfigured: false,
    });
    assert.match(prompt, /la recherche web n’est pas branchée/);
    const report = assembleReport({
      id: '00000000-0000-4000-8000-000000000001',
      query: 'formation Excel',
      market: null,
      now: new Date('2026-09-17T08:00:00Z'),
      timeZone: 'UTC',
      sources: [],
      webSearchConfigured: false,
      research: null,
      response: parseAnalysisResponse(fakeAnalysis(prompt)),
      model: 'gemini-3.5-flash',
      currency: 'USD',
    });

    assert.deepEqual(report.competitors, [], 'le concurrent proposé par le modèle est écarté faute de source');
    assert.deepEqual(report.groundingSources, []);
    for (const key of ['demand', 'saturation', 'profitability', 'opportunity', 'virality'] as const) {
      assert.equal(report.rates[key].basis, 'unavailable', key);
      assert.equal(report.rates[key].score, null, key);
    }
    assert.equal(report.dataProvenance?.rates, undefined, 'aucune provenance de taux sans source');
    assert.equal(report.dataProvenance?.competitors, undefined);
    assert.equal(report.overallVerdict, null);
    assert.match(report.verdictRationale ?? '', /aucune recherche web/);
    assert.match(report.digitalProducts[0]?.pricingNote ?? '', /faute de recherche web/);
    /*
      Sans aucune source, la décision la plus importante est de NE RIEN produire. Le rapport la
      formule au lieu de la taire, et propose une sortie concrète plutôt qu'un constat.
    */
    const sansSource = report.decisions?.find((decision) => decision.gap.includes('Aucune recherche web'));
    assert.ok(sansSource, 'l’absence de source doit être dite comme une décision');
    assert.match(sansSource!.proposal, /Ne lancez aucune production/);
    assert.match(sansSource!.basis, /prudence/);
    assert.equal(report.generator?.webSearch, null);
    assert.equal(report.generator?.research, undefined);
  });
});
