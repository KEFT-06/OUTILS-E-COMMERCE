import assert from 'node:assert/strict';
import { type Server, createServer } from 'node:http';
import { type AddressInfo, createServer as createTcpServer } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { type FakeProviders, signInWithPlan, startFakeProviders } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Un long rapport s'écrit jusqu'au bout sans que personne ne regarde l'écran.
 *
 * L'écran dit « Vous pouvez quitter cette page : la rédaction continue ». Ce n'était vrai que tant
 * qu'un écran restait ouvert pour réclamer chaque passage. Ici, le site écoute pour de bon sur une
 * adresse : à la fin de chaque passage, il se demande à lui-même le suivant. Aucun suivi n'est
 * fait pendant la rédaction ; seul l'état en base est lu.
 */

const SECRET = 'secret-du-declencheur-de-test';

let app: Express;
let providers: FakeProviders;
let site: Server;

/** Un port libre, réservé le temps de le lire : l'adresse du site doit être connue avant de le créer. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createTcpServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

before(async () => {
  providers = await startFakeProviders();
  const port = await freePort();
  app = await createTestApp({
    PERPLEXITY_API_KEY: 'cle-perplexity-de-test',
    PERPLEXITY_API_URL: `${providers.base}/perplexity`,
    PERPLEXITY_RESEARCH_PRESET: 'medium',
    // Une vague par passage : le rapport ne peut se finir qu'en enchaînant les passages.
    REPORT_SLICE_WAVES: '1',
    CRON_SECRET: SECRET,
    APP_URL: `http://127.0.0.1:${port}`,
  });
  site = createServer(app);
  await new Promise<void>((resolve) => site.listen(port, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise<void>((resolve) => site.close(() => resolve()));
  await closeTestApp();
  await providers.close();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Rapport long, écran fermé', () => {
  it('s’écrit jusqu’au bout en s’enchaînant lui-même, sans aucun suivi de l’écran', async () => {
    const { agent } = await signInWithPlan(app, 'redaction-ecran-ferme@exemple.com', 'elite');
    const started = await agent.post('/api/analyze-niche').send({ query: 'élevage de poulets', market: 'CM' }).expect(202);
    let reportId = '';
    for (let attempt = 0; attempt < 200 && !reportId; attempt += 1) {
      const { body } = await agent.get(`/api/analyze-niche/jobs/${started.body.job.id}`).expect(200);
      if (body.job.status === 'completed') reportId = body.job.reportId as string;
      else await sleep(50);
    }
    assert.ok(reportId, 'analyse terminée');

    const writerBefore = providers.writerCalls.length;
    await agent.post(`/api/reports/${reportId}/document`).send({ pages: 45 }).expect(202);

    // À partir d'ici, l'écran est fermé : plus aucun appel du navigateur. On ne lit que la base.
    const { getDb } = await import('@server/db/client');
    const { reportDocuments } = await import('@server/db/schema');
    const row = async () => (await getDb().select().from(reportDocuments).where(eq(reportDocuments.reportId, reportId)))[0]!;
    for (let attempt = 0; attempt < 600 && (await row()).status === 'writing'; attempt += 1) await sleep(50);

    const finished = await row();
    assert.equal(finished.status, 'ready', `${finished.errorCode ?? ''} ${finished.errorMessage ?? ''}`);
    const parties = providers.writerCalls.slice(writerBefore).filter((call) => call.prompt.includes('RÉDIGE LA PARTIE'));
    assert.equal(parties.length, 18, 'les dix-huit parties sont écrites, une fois chacune');
    assert.equal([...finished.markdown!.matchAll(/^### Partie \d+\.\d+$/gm)].length, 18);
  });

  it('n’accepte l’enchaînement que du site lui-même', async () => {
    const reportId = '00000000-0000-4000-8000-000000000000';
    await request(app).post('/api/cron/rapport').send({ reportId }).expect(401);
    await request(app).post('/api/cron/rapport').set('Authorization', 'Bearer un-autre-secret').send({ reportId }).expect(401);
    await request(app).post('/api/cron/rapport').set('Authorization', `Bearer ${SECRET}`).send({ reportId: 'pas-un-identifiant' }).expect(400);
    // Un rapport inconnu est accepté sans bruit : il n'y a simplement rien à continuer.
    await request(app).post('/api/cron/rapport').set('Authorization', `Bearer ${SECRET}`).send({ reportId }).expect(202);
  });
});
