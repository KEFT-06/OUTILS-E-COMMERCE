import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import type request from 'supertest';
import { type FakeProviders, signInWithPlan, startFakeProviders } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Analyse de niche : étude de marché Perplexity (Agent API), rédaction Gemini, en arrière-plan,
 * contre de faux fournisseurs : aucun vrai appel payant. Le serveur doit garder les faits sourcés,
 * écarter tout ce qui est avancé sans source existante, renseigner la provenance, et rendre les
 * points une seule fois quand une étape échoue.
 */

let app: Express;
let providers: FakeProviders;

before(async () => {
  providers = await startFakeProviders();
  app = await createTestApp({
    GEMINI_API_URL: `${providers.base}/gemini`,
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

interface Job {
  id: string;
  query: string;
  status: string;
  reportId: string | null;
  error: { code: string; message: string } | null;
}

interface Report {
  id: string;
  nicheName: string;
  market: string | null;
  overallVerdict: string | null;
  rates: Record<string, { basis: string; level: string | null; score: number | null; sourceIds?: number[] }>;
  competitors: { name: string; urlOrHandle: string; sourceIds: number[] }[];
  searchTrends: { keyword: string; volume: string | null }[];
  digitalProducts: {
    id: string;
    recommendedPrice: number | null;
    estimatedMarginPercent: number | null;
    currency: string;
    pricingNote: string;
  }[];
  adCampaigns: { durationSeconds: number; scenes: { timing: string; phase: string }[]; complianceCheck: unknown[] }[];
  groundingSources: { id: number; url: string; title: string }[];
  dataProvenance: Record<string, { source: string; sampleSize?: number; isDemonstration: boolean } | undefined>;
  limitations: string[];
  generator: {
    webSearch: string | null;
    model: string;
    research?: {
      mode: string;
      preset: string | null;
      model: string | null;
      searches: number;
      pagesConsulted: number;
      sourcesCited: number;
      durationSeconds: number;
    };
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJob(agent: TestAgent, jobId: string): Promise<Job> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { body } = await agent.get(`/api/analyze-niche/jobs/${jobId}`).expect(200);
    const job = body.job as Job;
    if (job.status === 'completed' || job.status === 'failed') return job;
    await sleep(50);
  }
  throw new Error('analyse toujours en cours');
}

async function analyze(agent: TestAgent, body: Record<string, unknown>): Promise<Job> {
  const started = await agent.post('/api/analyze-niche').send(body).expect(202);
  return waitForJob(agent, (started.body.job as Job).id);
}

describe('Analyse de niche', () => {
  it('fonde le rapport sur l’étude Perplexity et renseigne la provenance de chaque bloc', async () => {
    const { agent } = await signInWithPlan(app, 'analyste@exemple.com', 'pro');
    const before = await agent.get('/api/account/credits').expect(200);
    const agentCallsBefore = providers.agentCalls.length;

    const launched = await agent.post('/api/analyze-niche').send({ query: 'élevage de poulets', market: 'CM' }).expect(202);
    const launchedJob = launched.body.job as Job;
    assert.ok(['queued', 'research'].includes(launchedJob.status), 'le lancement répond tout de suite');

    // Un second clic pendant l'analyse ne relance rien et ne repaie pas.
    const again = await agent.post('/api/analyze-niche').send({ query: 'autre chose' }).expect(200);
    assert.equal(again.body.job.id, launchedJob.id);
    const active = await agent.get('/api/analyze-niche/jobs/active').expect(200);
    assert.equal(active.body.job.id, launchedJob.id, 'le suivi reprend après un rechargement de la page');

    const job = await waitForJob(agent, launchedJob.id);
    assert.equal(job.status, 'completed', JSON.stringify(job.error));
    assert.equal((await agent.get('/api/analyze-niche/jobs/active').expect(200)).body.job, null);
    const report = (await agent.get(`/api/reports/${job.reportId}`).expect(200)).body.report as Report;

    // Étude : Agent API en arrière-plan, préréglage de recherche approfondie, pays du marché, clé en en-tête.
    const calls = providers.agentCalls.slice(agentCallsBefore);
    const creation = calls.find((call) => call.method === 'POST')!;
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1, 'une seule étude pour deux clics');
    assert.equal(creation.body?.preset, 'medium');
    assert.equal(creation.body?.background, true);
    assert.equal(creation.body?.tools?.[0]?.user_location?.country, 'CM');
    assert.match(creation.body?.input ?? '', /élevage de poulets/);
    assert.match(creation.body?.input ?? '', /Cameroun/);
    assert.ok(calls.every((call) => call.token === 'Bearer cle-perplexity-de-test'));
    assert.equal(providers.searchQueries.length, 0, 'pas de repli quand l’étude réussit');

    // Sources : seules les pages citées, renumérotées ; même page sous deux numéros fusionnée ; javascript: et numéro inconnu écartés.
    assert.deepEqual(
      report.groundingSources.map((source) => [source.id, source.url]),
      [
        [1, 'https://agri.example/poulets'],
        [2, 'https://forum.example/eleveurs'],
        [3, 'https://pouletpro.example/formation'],
      ],
    );
    assert.equal(report.groundingSources[0]!.title, 'Élever des poulets en ville');

    // Consigne de Gemini : l'étude aux marqueurs réécrits, puis les sources numérotées.
    const prompt = providers.geminiCalls.at(-1)!.prompt;
    assert.match(prompt, /ÉTUDE DE MARCHÉ MENÉE PAR PERPLEXITY/);
    assert.match(prompt, /Le marché urbain grandit \[1\]\./);
    assert.match(prompt, /formation à 15 000 FCFA \[3\]/);
    assert.doesNotMatch(prompt, /\[web:|\[99\]|\[4\]/);
    assert.match(prompt, /\[3\] PouletPro Académie/);
    assert.doesNotMatch(prompt, /\{ts:/, 'marques de temps des transcriptions retirées');
    assert.match(prompt, /N’invente aucun chiffre/);

    // Faits : concurrent sans source existante écarté, lien inventé remplacé par sa source.
    assert.equal(report.competitors.length, 1);
    assert.equal(report.competitors[0]!.name, 'PouletPro Académie');
    assert.equal(report.competitors[0]!.urlOrHandle, 'https://forum.example/eleveurs');
    assert.equal(report.rates.demand!.basis, 'assessment');
    assert.equal(report.rates.opportunity!.basis, 'unavailable', 'source 99 inexistante');
    assert.equal(report.overallVerdict, 'Opportunité Forte');
    assert.ok(report.searchTrends.every((keyword) => keyword.volume === null));
    assert.equal(report.digitalProducts[0]!.recommendedPrice, null);
    assert.equal(report.digitalProducts[0]!.currency, 'XAF', 'devise du marché visé');
    assert.equal(report.adCampaigns[0]!.scenes.at(-1)!.timing.split(' - ')[1], '0:30');

    // Provenance : chaque bloc dit d'où il vient ; plus aucune limite générique.
    // Le rapport ne nomme aucun fournisseur : il dit l'ampleur de l'étude, pas qui l'a menée.
    assert.match(report.dataProvenance.rates!.source, /Étude approfondie du web \(3 recherches, 4 pages lues\)/);
    assert.doesNotMatch(report.dataProvenance.rates!.source, /Perplexity|Gemini/, 'aucun nom de fournisseur dans un rapport');
    assert.equal(report.dataProvenance.rates!.sampleSize, 3);
    assert.match(report.dataProvenance.competitors!.source, /seuls les concurrents présents dans les sources/);
    assert.match(report.dataProvenance.searchTrends!.source, /volumes de recherche non mesurés/);
    assert.match(report.dataProvenance.digitalProducts!.source, /l’IA de rédaction/);
    assert.match(report.dataProvenance.adCampaigns!.source, /l’IA de rédaction/);
    assert.match(report.dataProvenance.strategicActionPlan!.source, /d’après l’étude/);
    assert.ok(Object.values(report.dataProvenance).every((entry) => entry!.isDemonstration === false));
    assert.deepEqual(report.limitations, ['Aucune donnée de ventes.']);
    assert.equal(report.generator.webSearch, 'Recherche web');
    assert.deepEqual(report.generator.research, {
      provider: 'Perplexity',
      mode: 'deep_research',
      preset: 'medium',
      model: 'openai/gpt-5.6-luna',
      searches: 3,
      pagesConsulted: 4,
      sourcesCited: 3,
      durationSeconds: report.generator.research?.durationSeconds,
    });

    // Points : 5 débités une seule fois, génération enregistrée.
    const afterCredits = await agent.get('/api/account/credits').expect(200);
    assert.equal(before.body.credits.total - afterCredits.body.credits.total, 5);
    assert.equal(afterCredits.body.entries[0].actionId, 'niche_analysis');

    // Rapport et analyse invisibles pour un autre compte.
    const { agent: stranger } = await signInWithPlan(app, 'curieuse@exemple.com', 'pro');
    await stranger.get(`/api/reports/${report.id}`).expect(404);
    await stranger.get(`/api/analyze-niche/jobs/${job.id}`).expect(404);
    await stranger.get('/api/analyze-niche/jobs/pas-un-identifiant').expect(404);

    await agent.delete(`/api/reports/${report.id}`).expect(204);
    await agent.get(`/api/reports/${report.id}`).expect(404);
  });

  it('se replie sur l’API Search quand l’étude échoue ou ne cite pas assez de pages', async () => {
    const { agent } = await signInWithPlan(app, 'repli@exemple.com', 'pro');

    for (const query of ['étude en échec', 'étude mince']) {
      const searchesBefore = providers.searchQueries.length;
      const job = await analyze(agent, { query, market: 'CM' });
      assert.equal(job.status, 'completed', `${query} : ${JSON.stringify(job.error)}`);
      const report = (await agent.get(`/api/reports/${job.reportId}`).expect(200)).body.report as Report;
      assert.ok(providers.searchQueries.length > searchesBefore, `${query} : pages brutes demandées`);
      assert.equal(report.generator.research?.mode, 'search');
      assert.deepEqual(
        report.groundingSources.map((source) => source.url),
        ['https://agri.example/poulets', 'https://pouletpro.example/formation', 'https://forum.example/eleveurs'],
      );
      assert.match(report.dataProvenance.rates!.source, /^Recherche web/);
    }
  });

  it('rend les points une seule fois et ne garde aucun rapport quand une étape échoue', async () => {
    const { agent } = await signInWithPlan(app, 'malchance@exemple.com', 'pro');
    const start = (await agent.get('/api/account/credits').expect(200)).body.credits.total as number;
    const searchesBefore = providers.searchQueries.length;

    const cases = [
      { query: 'panne générale', code: 'ANALYSIS_FAILED' },
      { query: 'illisible', code: 'ANALYSIS_UNREADABLE' },
      { query: 'crédit épuisé', code: 'WEB_SEARCH_INSUFFICIENT_CREDITS' },
    ];
    for (const { query, code } of cases) {
      const job = await analyze(agent, { query });
      assert.equal(job.status, 'failed', query);
      assert.equal(job.error?.code, code, query);
      assert.match(job.error?.message ?? '', /points ont été rendus/, query);
    }
    assert.equal(providers.searchQueries.length, searchesBefore, 'un crédit Perplexity épuisé ne se replie pas');

    const credits = (await agent.get('/api/account/credits').expect(200)).body;
    assert.equal(credits.credits.total, start, 'points rendus');
    assert.deepEqual((await agent.get('/api/reports').expect(200)).body.reports, []);
  });

  it('reprend après un redémarrage le suivi de l’étude en cours, sans en relancer une', async () => {
    const { userId } = await signInWithPlan(app, 'reprise@exemple.com', 'pro');
    const { getDb } = await import('@server/db/client');
    const { analysisJobs } = await import('@server/db/schema');
    const { resumeAnalysisJobs } = await import('@server/services/analysis/jobs');
    const { eq } = await import('drizzle-orm');

    const [interrupted] = await getDb()
      .insert(analysisJobs)
      .values({ userId, query: 'élevage de poulets', market: 'CM', status: 'research', researchRef: 'resp_reprise' })
      .returning();
    const [abandoned] = await getDb()
      .insert(analysisJobs)
      .values({
        userId: (await signInWithPlan(app, 'ancienne@exemple.com', 'pro')).userId,
        query: 'vieille analyse',
        status: 'research',
        createdAt: new Date(Date.now() - 60 * 60_000),
      })
      .returning();

    const postsBefore = providers.agentCalls.filter((call) => call.method === 'POST').length;
    assert.equal(await resumeAnalysisJobs(), 1);

    let row = interrupted!;
    for (let attempt = 0; attempt < 200 && row.status !== 'completed' && row.status !== 'failed'; attempt += 1) {
      await sleep(50);
      [row] = await getDb().select().from(analysisJobs).where(eq(analysisJobs.id, interrupted!.id));
    }
    assert.equal(row.status, 'completed');
    assert.ok(row.reportId);
    assert.equal(providers.agentCalls.filter((call) => call.method === 'POST').length, postsBefore, 'aucune nouvelle étude payée');
    assert.ok(providers.agentCalls.some((call) => call.method === 'GET' && call.path.endsWith('/resp_reprise')));

    const [stale] = await getDb().select().from(analysisJobs).where(eq(analysisJobs.id, abandoned!.id));
    assert.equal(stale!.status, 'failed');
    assert.equal(stale!.errorCode, 'ANALYSIS_INTERRUPTED');
  });

  it('refuse l’analyse sans connexion, hors palier ou sans points', async () => {
    const { default: request } = await import('supertest');
    await request(app).post('/api/analyze-niche').send({ query: 'poulets' }).expect(401);
    await request(app).get('/api/analyze-niche/jobs/active').expect(401);

    const { agent } = await signInWithPlan(app, 'gratuit@exemple.com', 'free');
    const refused = await agent.post('/api/analyze-niche').send({ query: 'poulets' }).expect(402);
    assert.equal(refused.body.error.code, 'INSUFFICIENT_CREDITS', 'le palier Gratuit a 3 points, l’analyse en coûte 5');
    assert.equal((await agent.get('/api/analyze-niche/jobs/active').expect(200)).body.job, null, 'aucune analyse créée');

    await agent.post('/api/analyze-niche').send({ query: 'x' }).expect(400);
    await agent.post('/api/analyze-niche').send({ query: 'poulets', market: 'ZZ' }).expect(400);
  });
});

describe('Étude Perplexity : sources citées', () => {
  it('renumérote dans l’ordre de citation, fusionne les doublons et efface les marqueurs sans page', async () => {
    const { citedSources } = await import('@server/services/analysis/research');
    const { memo, sources } = citedSources('A [web:7][web:2]. B [web:2][web:9]. C [3]. D [web:8].', [
      { id: 2, url: 'https://b.example/page#x', title: 'Page B', snippet: null, date: null, last_updated: '2026-01-02' },
      { id: 3, url: 'https://c.example', title: '', snippet: 'extrait', date: '2026-02-03', last_updated: null },
      { id: 7, url: 'https://a.example', title: 'Page <b>A</b>', snippet: 'vidéo {ts:4} texte', date: null, last_updated: null },
      { id: 9, url: 'https://b.example/page', title: 'Page B bis', snippet: null, date: null, last_updated: null },
    ]);
    assert.equal(memo, 'A [1][2]. B [2]. C [3]. D .');
    assert.deepEqual(
      sources.map((source) => [source.id, source.url, source.title, source.snippet, source.publishedAt]),
      [
        [1, 'https://a.example/', 'Page A', 'vidéo texte', null],
        [2, 'https://b.example/page', 'Page B', '', '2026-01-02'],
        [3, 'https://c.example/', 'c.example', 'extrait', '2026-02-03'],
      ],
    );
  });
});
