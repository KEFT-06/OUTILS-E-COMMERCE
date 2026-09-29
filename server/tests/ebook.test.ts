import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Rédaction d'un ebook long, contre un faux service de rédaction.
 *
 * Ce qui est vérifié ici, et qu'aucun autre test ne couvre :
 *  - le plan est demandé une seule fois, puis chaque section est rédigée par un appel
 *    distinct — c'est ce découpage qui permet d'aller au-delà d'une réponse unique ;
 *  - une longueur au-dessus du palier est refusée avant tout débit ;
 *  - le coût suit la longueur demandée, par tranche de dix pages entamée ;
 *  - une section déjà écrite n'est jamais réécrite quand le travail reprend ;
 *  - le texte rendu suit l'ordre du plan, chapitre par chapitre.
 */

/** Consignes reçues par le faux service, pour vérifier le découpage réel. */
const prompts: string[] = [];

/** Refus « saturé » encore à servir pour la section « Les matériaux » : simule une panne chez Google. */
let saturation = 0;

const CHAPTERS = [
  { title: 'Choisir son emplacement', purpose: 'Poser le terrain', sections: ['Lire le terrain', 'Mesurer la surface'] },
  { title: 'Bâtir le poulailler', purpose: 'Construire', sections: ['Le plan', 'Les matériaux'] },
];

const fakeWriter = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { contents: { parts: { text: string }[] }[] };
    const prompt = body.contents[0]!.parts[0]!.text;
    prompts.push(prompt);

    if (saturation > 0 && prompt.includes('Section 4 — Les matériaux')) {
      saturation -= 1;
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'This model is currently experiencing high demand.' } }));
      return;
    }

    const answer = prompt.includes('tu construis la charpente')
      ? {
          throughLine: 'Monter un poulailler propre en trente jours.',
          chapters: CHAPTERS.map((chapter) => ({
            title: chapter.title,
            purpose: chapter.purpose,
            sections: chapter.sections.map((title) => ({ title, angle: `Angle de ${title}`, beats: ['Un point', 'Un autre'] })),
          })),
        }
      : {
          // Le titre de la section demandée est repris : le test vérifie ainsi l'ordre du rendu.
          content: `Texte de ${/Section \d+ — (.+)/.exec(prompt)?.[1] ?? 'inconnue'}.`,
          gist: 'Ce que cette section a apporté.',
        };

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }));
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((resolve) => fakeWriter.listen(0, '127.0.0.1', resolve));
  app = await createTestApp({ GEMINI_API_URL: `http://127.0.0.1:${(fakeWriter.address() as AddressInfo).port}` });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => fakeWriter.close(() => resolve()));
});

const REQUEST = {
  productId: 'produit-1',
  title: 'Guide du poulailler urbain',
  subtitle: 'De 10 à 50 poules',
  typeName: 'Ebook',
  targetAudience: 'Citadins',
  transformationPromise: 'Installer un poulailler propre',
  chapters: CHAPTERS.map((chapter) => ({ title: chapter.title, details: '' })),
  market: 'SN',
  targetPages: 20,
};

const balance = async (agent: Awaited<ReturnType<typeof signInWithPlan>>['agent']) =>
  (await agent.get('/api/account/credits').expect(200)).body.credits.total as number;

/**
 * Dépose un rapport d'analyse en base, sans passer par une vraie étude de marché : le
 * dossier se construit à partir du rapport enregistré, c'est lui qu'il faut fournir.
 */
async function createStoredReport(userId: string): Promise<string> {
  const { getDb } = await import('@server/db/client');
  const { reports } = await import('@server/db/schema');
  const id = randomUUID();
  await getDb()
    .insert(reports)
    .values({
      id,
      userId,
      query: 'poulailler urbain',
      nicheName: 'Poulailler urbain',
      market: 'SN',
      report: {
        id,
        query: 'poulailler urbain',
        nicheName: 'Poulailler urbain',
        market: 'SN',
        executiveSummary: 'La demande existe, l’offre structurée est rare.',
        overallVerdict: 'Opportunité Forte',
        rates: { demand: { label: 'Taux de demande', level: 'Élevé', score: 72, rationale: 'Recherches régulières.' } },
        competitors: [{ name: 'Ferme Diop', positioning: 'Formation en présentiel', strengths: ['Notoriété locale'], weaknesses: ['Aucune offre en ligne'] }],
        searchTrends: [{ keyword: 'élever des poules à Dakar', volume: null, intent: 'informational' }],
        digitalProducts: [{ title: 'Guide du poulailler', typeName: 'Ebook', recommendedPrice: null, targetAudience: 'Citadins' }],
        strategicActionPlan: [{ title: 'Semaine 1', steps: ['Valider la promesse'] }],
        groundingSources: [{ id: 1, title: 'Agriculture urbaine au Sénégal', url: 'https://agri.example/dakar' }],
        decisions: [{ gap: 'Aucune donnée de ventes.', proposal: 'Lancez à 5 000 XAF.', basis: 'Source [1].' }],
      },
      createdAt: new Date(),
    });
  return id;
}

/** Attend la fin de la rédaction, en sondant comme le ferait le navigateur. */
async function waitForCompletion(agent: Awaited<ReturnType<typeof signInWithPlan>>['agent'], jobId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { body } = await agent.get(`/api/writing/ebook/${jobId}`).expect(200);
    const job = body.job as { status: string; error: { message: string } | null };
    if (job.status === 'completed') return job;
    if (job.status === 'failed') assert.fail(`rédaction échouée : ${job.error?.message ?? ''}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('la rédaction n’a pas abouti dans le temps imparti');
}

describe('Rédaction d’un ebook long', () => {
  it('bâtit un plan, rédige chaque section séparément et rend le texte dans l’ordre', async () => {
    const { agent } = await signInWithPlan(app, 'autrice-ebook@exemple.com', 'pro');
    const start = await balance(agent);
    prompts.length = 0;

    const launch = await agent.post('/api/writing/ebook').send(REQUEST).expect(202);
    const jobId = (launch.body as { job: { id: string } }).job.id;

    await waitForCompletion(agent, jobId);

    const outlinePrompts = prompts.filter((prompt) => prompt.includes('tu construis la charpente'));
    assert.equal(outlinePrompts.length, 1, 'le plan n’est demandé qu’une fois');

    const sectionPrompts = prompts.filter((prompt) => prompt.includes('Tu rédiges une section'));
    assert.equal(sectionPrompts.length, 4, 'une consigne par section du plan, pas un seul appel pour tout');

    // Chaque section connaît ce qui précède : c'est ce qui l'empêche de se répéter.
    assert.ok(
      sectionPrompts.some((prompt) => prompt.includes('DÉJÀ ÉCRIT')),
      'les sections suivantes reçoivent le résumé des précédentes',
    );

    const { body } = await agent.get(`/api/writing/ebook/${jobId}/result`).expect(200);
    const result = body as { chapters: { title: string; content: string }[]; pages: number; productId: string };

    assert.equal(result.productId, 'produit-1', 'le texte revient au bon produit');
    assert.deepEqual(
      result.chapters.map((chapter) => chapter.title),
      ['Choisir son emplacement', 'Bâtir le poulailler'],
      'les chapitres gardent l’ordre du plan',
    );
    assert.ok(result.chapters[0]!.content.includes('Lire le terrain'), 'chaque section porte son intertitre');
    assert.ok(
      result.chapters[0]!.content.indexOf('Lire le terrain') < result.chapters[0]!.content.indexOf('Mesurer la surface'),
      'les sections gardent l’ordre du plan à l’intérieur du chapitre',
    );

    // 20 pages = deux tranches de dix, à deux points la tranche.
    assert.equal(start - (await balance(agent)), 4, 'le coût suit la longueur demandée');
  });

  it('développe une analyse en dossier, sur les seuls faits du rapport enregistré', async () => {
    const { agent, userId } = await signInWithPlan(app, 'analyste-dossier@exemple.com', 'pro');
    const reportId = await createStoredReport(userId);
    prompts.length = 0;

    const launch = await agent.post('/api/writing/market-report').send({ reportId, targetPages: 20 }).expect(202);
    const jobId = (launch.body as { job: { id: string } }).job.id;
    await waitForCompletion(agent, jobId);

    const all = prompts.join('\n');
    // Les faits partent du rapport relu sur le serveur, pas de la requête du navigateur.
    assert.match(all, /CE QUE L’ÉTUDE A ÉTABLI/, 'la matière de l’étude est transmise à la rédaction');
    assert.match(all, /Poulailler urbain/, 'le nom de la niche vient du rapport enregistré');
    assert.match(all, /dossier stratégique/i, 'la rédaction sait qu’elle écrit un dossier, pas un ebook');
    assert.match(
      all,
      /Tout fait de marché doit venir de l’étude ci-dessus/,
      'la consigne interdit d’avancer un fait que l’étude n’établit pas',
    );
  });

  it('laisse renoncer à une rédaction en cours et rend les points', async () => {
    const { agent } = await signInWithPlan(app, 'autrice-annule@exemple.com', 'pro');
    const start = await balance(agent);

    const launch = await agent.post('/api/writing/ebook').send(REQUEST).expect(202);
    const jobId = (launch.body as { job: { id: string } }).job.id;

    const cancelled = await agent.delete(`/api/writing/ebook/${jobId}`).expect(200);
    assert.equal((cancelled.body as { job: { status: string } }).job.status, 'failed', 'la rédaction ne tourne plus');

    assert.equal(await balance(agent), start, 'les points sont rendus intégralement');

    // Le compte est libéré tout de suite : on peut relancer sans attendre.
    await agent.post('/api/writing/ebook').send(REQUEST).expect(202);
  });

  it('refuse une longueur au-dessus du palier, sans retirer de points', async () => {
    const { agent } = await signInWithPlan(app, 'autrice-limite@exemple.com', 'free');
    const start = await balance(agent);

    const response = await agent.post('/api/writing/ebook').send({ ...REQUEST, targetPages: 120 }).expect(403);
    const error = response.body.error as { code: string; message: string };

    assert.equal(error.code, 'EBOOK_PAGES_OVER_PLAN');
    assert.match(error.message, /15 pages au plus/, 'le message dit la limite réelle du palier');
    assert.equal(await balance(agent), start, 'aucun point retiré pour une demande refusée');
  });

  it('ne réécrit jamais une section déjà rédigée quand le suivi rappelle le travail', async () => {
    const { agent } = await signInWithPlan(app, 'autrice-reprise@exemple.com', 'pro');
    prompts.length = 0;

    const launch = await agent.post('/api/writing/ebook').send(REQUEST).expect(202);
    const jobId = (launch.body as { job: { id: string } }).job.id;
    await waitForCompletion(agent, jobId);

    const before = prompts.filter((prompt) => prompt.includes('Tu rédiges une section')).length;
    // Le suivi continue après la fin : il ne doit plus rien relancer.
    await agent.get(`/api/writing/ebook/${jobId}`).expect(200);
    await agent.get(`/api/writing/ebook/${jobId}`).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(
      prompts.filter((prompt) => prompt.includes('Tu rédiges une section')).length,
      before,
      'une rédaction terminée ne relance aucune section',
    );
  });

  it('marque une pause quand Google sature, garde les sections écrites, puis termine sans rien réécrire', async () => {
    const { agent } = await signInWithPlan(app, 'autrice-patiente@exemple.com', 'pro');
    const start = await balance(agent);
    prompts.length = 0;
    // Six refus : toutes les tentatives d'un même appel (deux par modèle, trois modèles) échouent.
    saturation = 6;

    const launch = await agent.post('/api/writing/ebook').send(REQUEST).expect(202);
    const jobId = (launch.body as { job: { id: string } }).job.id;

    type Job = { status: string; sectionsDone: number; error: unknown; notice: { code: string; message: string } | null };
    let paused: Job | null = null;
    for (let attempt = 0; attempt < 150 && !paused; attempt += 1) {
      const job = (await agent.get(`/api/writing/ebook/${jobId}`).expect(200)).body.job as Job;
      assert.notEqual(job.status, 'failed', 'une saturation ne fait plus échouer la rédaction');
      if (job.notice) paused = job;
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(paused, 'la pause est annoncée à l’écran');
    assert.equal(paused.status, 'writing');
    assert.equal(paused.notice?.code, 'WRITING_OVERLOADED');
    assert.match(paused.notice?.message ?? '', /reprend d’elle-même/);
    assert.doesNotMatch(paused.notice?.message ?? '', /saturé/, 'ton neutre : l’auteur n’a rien à faire');
    assert.equal(paused.error, null, 'une pause n’est pas une erreur');
    assert.equal(paused.sectionsDone, 3, 'les sections du premier lot sont gardées');

    // Fin de la pause : on avance l'heure de la réservation au lieu d'attendre 45 s.
    const { getDb } = await import('@server/db/client');
    const { ebookJobs } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    await getDb().update(ebookJobs).set({ leaseUntil: new Date(Date.now() - 1_000) }).where(eq(ebookJobs.id, jobId));

    await waitForCompletion(agent, jobId);
    for (const title of ['Lire le terrain', 'Mesurer la surface', 'Le plan']) {
      assert.equal(
        prompts.filter((prompt) => prompt.includes('Tu rédiges une section') && prompt.includes(`— ${title}\n`)).length,
        1,
        `« ${title} » n’est pas réécrite après la pause`,
      );
    }
    assert.equal(start - (await balance(agent)), 4, 'facturé une seule fois, rien de rendu');
  });
});
