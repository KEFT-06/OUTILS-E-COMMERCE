import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { type FakeProviders, signInWithPlan, startFakeProviders } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Analyse de niche sans recherche web : aucun fait de marché n'est avancé, même si
 * le modèle en propose, aucun taux n'est évalué et le rapport le dit.
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
  it('n’avance aucun fait sans source et le dit', async () => {
    const { agent } = await signInWithPlan(app, 'sans-web@exemple.com', 'pro');
    const response = await agent.post('/api/analyze-niche').send({ query: 'formation Excel' }).expect(201);
    const report = response.body as {
      overallVerdict: string | null;
      verdictRationale: string;
      competitors: unknown[];
      rates: Record<string, { basis: string; score: number | null }>;
      groundingSources: unknown[];
      limitations: string[];
      digitalProducts: { pricingNote: string; currency: string }[];
      dataProvenance: { rates?: unknown };
    };

    assert.equal(providers.searchQueries.length, 0, 'aucune recherche web sans clé');
    const prompt = providers.geminiCalls.at(-1)!.prompt;
    assert.match(prompt, /la recherche web n’est pas branchée/);
    assert.doesNotMatch(prompt, /MESURE PUBLICITAIRE/);

    assert.deepEqual(report.competitors, [], 'le concurrent proposé par le modèle est écarté faute de source');
    assert.deepEqual(report.groundingSources, []);
    for (const key of ['demand', 'saturation', 'profitability', 'opportunity', 'virality']) {
      assert.equal(report.rates[key]!.basis, 'unavailable', key);
      assert.equal(report.rates[key]!.score, null, key);
    }
    assert.equal(report.dataProvenance.rates, undefined, 'aucune provenance de taux sans source');
    assert.equal(report.overallVerdict, null);
    assert.match(report.verdictRationale, /aucune recherche web/);
    assert.match(report.digitalProducts[0]!.pricingNote, /faute de recherche web/);
    assert.equal(report.digitalProducts[0]!.currency, 'USD', 'sans pays, devise par défaut');
    assert.ok(report.limitations.some((limitation) => limitation.includes('Aucune recherche web')));
    assert.ok(report.limitations.every((limitation) => !limitation.includes('Meta')));
  });
});
