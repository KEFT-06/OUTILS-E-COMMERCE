import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import type request from 'supertest';
import { type FakeProviders, signInWithPlan, startFakeProviders } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Analyse mise en attente quand le fournisseur d'IA est saturé, au lieu d'être perdue.
 *
 * C'est la panne que l'auteur a réellement rencontrée : « Le service de rédaction est surchargé ».
 * Elle survenait APRÈS l'étude du web — la partie longue et payée. L'ancien comportement jetait ce
 * travail et rendait les points, ce qui obligeait à tout refaire et à repayer l'étude.
 *
 * Ce que ces tests verrouillent :
 *  · l'analyse passe en attente, pas en échec ;
 *  · les points ne sont PAS rendus pendant l'attente — les rendre puis les reprendre ferait deux
 *    écritures de compte pour un seul achat, et ferait croire à un remboursement définitif ;
 *  · les sources trouvées restent affichées : l'écran montre que le travail n'est pas perdu ;
 *  · la place du compte reste occupée, sinon on lancerait une seconde analyse et on paierait deux fois ;
 *  · une panne qui ne s'arrangera pas d'elle-même échoue tout de suite et rembourse.
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
  status: string;
  reportId: string | null;
  error: { code: string; message: string } | null;
  retryAfter?: string | null;
  sources?: { id: number }[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Attend qu'une analyse atteigne l'un des états demandés. */
async function waitForStatus(agent: TestAgent, jobId: string, states: string[]): Promise<Job> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { body } = await agent.get(`/api/analyze-niche/jobs/${jobId}`).expect(200);
    const job = body.job as Job;
    if (states.includes(job.status)) return job;
    await sleep(50);
  }
  throw new Error(`l’analyse n’a pas atteint ${states.join(' ou ')}`);
}

const creditsOf = async (agent: TestAgent): Promise<number> =>
  (await agent.get('/api/account/credits').expect(200)).body.credits.total as number;

/**
 * Avance le rendez-vous d'une analyse en attente : un test n'attend pas deux minutes.
 * `retryCount` permet en plus de se placer directement à la dernière tentative, au lieu de
 * dérouler les trois attentes — ce qui rendrait le test long et son échéance imprévisible.
 */
async function avancerRendezVous(jobId: string, retryCount?: number): Promise<void> {
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('@server/db/client');
  const { analysisJobs } = await import('@server/db/schema');
  await getDb()
    .update(analysisJobs)
    .set({ retryAfter: new Date(Date.now() - 1_000), ...(retryCount === undefined ? {} : { retryCount }) })
    .where(eq(analysisJobs.id, jobId));
}

describe('Analyse — attente quand l’IA est saturée', () => {
  it('attend au lieu d’échouer, garde les points réservés, puis aboutit à la reprise', async () => {
    const { agent } = await signInWithPlan(app, 'attente@exemple.test', 'pro');
    const avant = await creditsOf(agent);

    // Quatre refus d'affilée : c'est le nombre de tentatives du client, donc le tour de
    // rédaction échoue entièrement — comme un vrai épisode de saturation chez Google.
    providers.setOverload(4);

    const lance = await agent.post('/api/analyze-niche').send({ query: '« saturé » marché du café', market: 'CM' }).expect(202);
    const jobId = (lance.body.job as Job).id;

    const enAttente = await waitForStatus(agent, jobId, ['waiting', 'failed']);
    assert.equal(enAttente.status, 'waiting', 'une saturation met en attente, elle ne fait pas échouer');
    assert.equal(enAttente.error?.code, 'ANALYSIS_OVERLOADED');
    assert.ok(enAttente.retryAfter, 'l’écran doit pouvoir annoncer l’heure du prochain essai');
    assert.ok((enAttente.sources?.length ?? 0) > 0, 'les sources de l’étude sont conservées et montrées');

    // Le point crucial : rien n'est rendu. Les points sont réservés, pas remboursés.
    const pendant = await creditsOf(agent);
    assert.equal(pendant, avant - 5, 'les 5 points de l’analyse restent débités pendant l’attente');

    // La place reste occupée : sans cela, l'auteur relancerait et paierait une seconde fois.
    const active = await agent.get('/api/analyze-niche/jobs/active').expect(200);
    assert.equal((active.body.job as Job | null)?.id, jobId);

    // L'heure du rendez-vous arrive : le suivi du navigateur relance le travail.
    await avancerRendezVous(jobId);
    const fini = await waitForStatus(agent, jobId, ['completed', 'failed']);
    assert.equal(fini.status, 'completed', 'la reprise aboutit dès que le fournisseur répond');
    assert.ok(fini.reportId);

    // Ni double débit, ni remboursement : un seul achat, un seul rapport.
    assert.equal(await creditsOf(agent), avant - 5);
  });

  it('ne réessaie pas indéfiniment : au bout des tentatives prévues, il échoue et rembourse', async () => {
    const { agent } = await signInWithPlan(app, 'attente-abandon@exemple.test', 'pro');
    const avant = await creditsOf(agent);

    // Saturation qui ne se lève jamais : 4 tentatives par tour, 4 tours au plus.
    providers.setOverload(1_000);

    const lance = await agent.post('/api/analyze-niche').send({ query: '« saturé » marché du thé', market: 'CM' }).expect(202);
    const jobId = (lance.body.job as Job).id;

    const enAttente = await waitForStatus(agent, jobId, ['waiting', 'failed']);
    assert.equal(enAttente.status, 'waiting');

    // On se place à la dernière tentative prévue : la suivante doit renoncer, pas attendre encore.
    await avancerRendezVous(jobId, 3);
    const dernier = await waitForStatus(agent, jobId, ['failed', 'completed']);

    assert.equal(dernier.status, 'failed', 'l’analyse finit par renoncer');
    assert.match(dernier.error?.message ?? '', /surchargé/);
    // Et là, les points reviennent : l'attente est terminée, le service n'a rien rendu.
    assert.equal(await creditsOf(agent), avant, 'les points sont rendus à l’abandon');
    providers.setOverload(0);
  });

  it('échoue tout de suite sur une panne qui ne s’arrangera pas d’elle-même', async () => {
    const { agent } = await signInWithPlan(app, 'attente-panne@exemple.test', 'pro');
    const avant = await creditsOf(agent);

    // Erreur 500 du fournisseur : ce n'est pas une saturation, attendre n'y changerait rien.
    const lance = await agent.post('/api/analyze-niche').send({ query: '« panne » du marché', market: 'CM' }).expect(202);
    const jobId = (lance.body.job as Job).id;

    const fini = await waitForStatus(agent, jobId, ['failed', 'waiting', 'completed']);
    assert.equal(fini.status, 'failed', 'une panne franche ne doit pas faire attendre l’auteur pour rien');
    assert.equal(await creditsOf(agent), avant, 'points rendus immédiatement');
  });
});
