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

const SECRET = 'secret-du-planificateur-de-test';

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
  app = await createTestApp({ GEMINI_API_URL: `http://127.0.0.1:${(fakeWriter.address() as AddressInfo).port}`, CRON_SECRET: SECRET });
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

  it('rédige le contenu d’un produit par le même moteur : prix fixe, longueur déduite des modules, plan de l’auteur gardé', async () => {
    // Ce palier plafonne les ouvrages à 100 pages : le plafond borne une longueur CHOISIE, pas celle d'un produit.
    const { agent } = await signInWithPlan(app, 'autrice-produit@exemple.com', 'pro');
    const start = await balance(agent);
    prompts.length = 0;

    const launch = await agent.post('/api/writing/ebook').send({ ...REQUEST, kind: 'product', productId: 'produit-fixe', targetPages: 200 }).expect(202);
    const job = (launch.body as { job: { id: string; kind: string; targetPages: number } }).job;
    assert.equal(job.kind, 'product');
    assert.equal(job.targetPages, 4, 'deux modules : la longueur vient du nombre de modules, pas de la demande');
    assert.equal(start - (await balance(agent)), 4, 'le prix reste celui de la rédaction d’un produit, quelle que soit la longueur envoyée');

    await waitForCompletion(agent, job.id);
    // Écrit section par section, comme un ebook : une coupure ne coûte plus que la section en cours.
    assert.equal(prompts.filter((prompt) => prompt.includes('Tu rédiges une section')).length, 4);
    assert.ok(
      prompts.find((prompt) => prompt.includes('tu construis la charpente'))!.includes('CHAPITRES IMPOSÉS PAR L’AUTEUR'),
      'le plan de l’auteur est imposé au rédacteur',
    );

    const { body } = await agent.get(`/api/writing/ebook/${job.id}/result`).expect(200);
    const result = body as { kind: string; productId: string; chapters: { index: number; title: string; content: string }[]; findings: unknown[] };
    assert.equal(result.kind, 'product');
    assert.equal(result.productId, 'produit-fixe');
    // Le rang de chaque chapitre : c'est par lui que le texte retrouve le module de l'auteur.
    assert.deepEqual(result.chapters.map((chapter) => chapter.index), [1, 2]);
    assert.ok(result.chapters[1]!.content.includes('Texte de Les matériaux.'));
    assert.ok(Array.isArray(result.findings), 'le contrôle de conformité accompagne le texte');

    // Au-delà de seize modules, ce n'est plus un produit à prix fixe : refusé avant tout débit.
    const before = await balance(agent);
    const trop = await agent
      .post('/api/writing/ebook')
      .send({ ...REQUEST, kind: 'product', chapters: Array.from({ length: 17 }, (_, index) => ({ title: `Module ${index + 1}`, details: '' })) })
      .expect(400);
    assert.equal((trop.body as { error: { code: string } }).error.code, 'PRODUCT_TOO_MANY_MODULES');
    assert.equal(await balance(agent), before);
  });

  it('garde pour l’auteur le texte d’une rédaction finie en son absence, et ne le propose qu’une fois', async () => {
    // Vu en production le 06/10/2026 : rédaction terminée écran fermé, texte écrit et payé, jamais affiché au retour.
    const { agent } = await signInWithPlan(app, 'autrice-remise@exemple.com', 'pro');
    const { agent: other } = await signInWithPlan(app, 'curieuse-remise@exemple.com', 'pro');
    const pending = async (who: typeof agent, productId: string) =>
      (await who.get('/api/writing/ebook/pending').query({ productId }).expect(200)).body.job as { id: string; status: string } | null;

    const launch = await agent.post('/api/writing/ebook').send({ ...REQUEST, productId: 'produit-absence' }).expect(202);
    const jobId = (launch.body as { job: { id: string } }).job.id;
    assert.equal((await pending(agent, 'produit-absence'))?.id, jobId, 'en cours : c’est elle qu’on suit');
    await waitForCompletion(agent, jobId);

    // L'auteur n'était pas là : plus rien n'est « en cours », mais son texte l'attend.
    assert.equal((await agent.get('/api/writing/ebook/active').expect(200)).body.job, null);
    const waiting = await pending(agent, 'produit-absence');
    assert.equal(waiting?.id, jobId);
    assert.equal(waiting?.status, 'completed');
    assert.equal(await pending(agent, 'un-autre-produit'), null, 'jamais proposé pour un autre produit');
    assert.equal(await pending(other, 'produit-absence'), null, 'ni à un autre compte');
    await other.post(`/api/writing/ebook/${jobId}/delivered`).expect(404);

    // Versé au brouillon : il n'est plus proposé, et reste lisible.
    await agent.post(`/api/writing/ebook/${jobId}/delivered`).expect(204);
    assert.equal(await pending(agent, 'produit-absence'), null, 'un texte versé ne revient pas écraser le brouillon');
    await agent.get(`/api/writing/ebook/${jobId}/result`).expect(200);

    // Une nouvelle rédaction du même produit remplace un ancien texte jamais versé.
    const first = await agent.post('/api/writing/ebook').send({ ...REQUEST, productId: 'produit-remplace' }).expect(202);
    await waitForCompletion(agent, (first.body as { job: { id: string } }).job.id);
    const second = await agent.post('/api/writing/ebook').send({ ...REQUEST, productId: 'produit-remplace' }).expect(202);
    const secondId = (second.body as { job: { id: string } }).job.id;
    await waitForCompletion(agent, secondId);
    assert.equal((await pending(agent, 'produit-remplace'))?.id, secondId, 'seul le dernier texte attend');
    await agent.post(`/api/writing/ebook/${secondId}/delivered`).expect(204);
    assert.equal(await pending(agent, 'produit-remplace'), null, 'l’ancien, remplacé, ne ressort pas');
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

  /*
    Vu par un client le 04/10/2026, au téléphone : « La rédaction a été interrompue trop
    longtemps. Relancez-la : vos points ont été rendus. » L'écran s'était éteint ; au retour,
    l'ouvrage à moitié écrit était jeté. Une absence n'est pas une panne.
  */
  it('reprend où elle en était quand l’auteur revient après des heures, au lieu d’abandonner', async () => {
    const { agent, userId } = await signInWithPlan(app, 'autrice-absente@exemple.com', 'pro');
    const start = await balance(agent);
    const { getDb } = await import('@server/db/client');
    const { ebookJobs } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');

    // Une rédaction commencée il y a trois heures, plan fait, une section écrite, puis plus rien.
    const troisHeures = new Date(Date.now() - 3 * 3_600_000);
    const sections = CHAPTERS.flatMap((chapter, rang) => chapter.sections.map((title) => ({ chapterIndex: rang + 1, chapterTitle: chapter.title, title })));
    const [job] = await getDb()
      .insert(ebookJobs)
      .values({
        userId,
        kind: 'ebook',
        productId: 'produit-absent',
        title: REQUEST.title,
        market: 'SN',
        status: 'writing',
        targetPages: 20,
        request: REQUEST as unknown as Record<string, unknown>,
        outline: {
          kind: 'ebook',
          title: REQUEST.title,
          throughLine: 'Monter un poulailler propre en trente jours.',
          chapters: CHAPTERS.map((chapter, rang) => ({ index: rang + 1, title: chapter.title, purpose: chapter.purpose })),
          sections: sections.map((section, rang) => ({ ...section, index: rang + 1, angle: `Angle de ${section.title}`, beats: ['Un point'], targetWords: 400 })),
          targetWords: 1_600,
        } as unknown as Record<string, unknown>,
        sections: [{ index: 1, content: 'Texte de Lire le terrain.', gist: 'Le terrain.', words: 4 }] as unknown as Record<string, unknown>[],
        sectionsDone: 1,
        sectionsTotal: 4,
        wordsWritten: 4,
        creditsCharged: 0,
        createdAt: troisHeures,
        updatedAt: troisHeures,
        progressAt: troisHeures,
      })
      .returning();
    prompts.length = 0;

    const retour = (await agent.get(`/api/writing/ebook/${job!.id}`).expect(200)).body.job as { status: string; error: unknown };
    assert.equal(retour.status, 'writing', 'trois heures d’absence ne font pas échouer la rédaction');
    assert.equal(retour.error, null);

    await waitForCompletion(agent, job!.id);
    const ecrites = prompts.filter((prompt) => prompt.includes('Tu rédiges une section'));
    assert.equal(ecrites.length, 3, 'seules les trois sections manquantes sont écrites');
    assert.ok(!ecrites.some((prompt) => prompt.includes('— Lire le terrain\n')), 'la section déjà écrite n’est pas refaite');
    const [fini] = await getDb().select().from(ebookJobs).where(eq(ebookJobs.id, job!.id));
    assert.equal(fini!.refunded, false);
    assert.equal(await balance(agent), start, 'aucun point rendu ni repris : la rédaction a simplement abouti');
  });

  it('renonce et rembourse seulement après une vingtaine de refus d’affilée du service de rédaction', async () => {
    const { agent } = await signInWithPlan(app, 'autrice-panne@exemple.com', 'pro');
    const start = await balance(agent);
    const { getDb } = await import('@server/db/client');
    const { ebookJobs } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    saturation = 6;

    const launch = await agent.post('/api/writing/ebook').send(REQUEST).expect(202);
    const jobId = (launch.body as { job: { id: string } }).job.id;
    type Job = { status: string; error: { code: string; message: string } | null; notice: unknown };
    let job = launch.body.job as Job;
    for (let attempt = 0; attempt < 150 && !job.notice; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = (await agent.get(`/api/writing/ebook/${jobId}`).expect(200)).body.job as Job;
    }
    const [enPause] = await getDb().select().from(ebookJobs).where(eq(ebookJobs.id, jobId));
    assert.equal(enPause!.stalls, 1, 'un refus compté, la rédaction reste en cours');
    assert.equal(job.status, 'writing');

    // Dix-neuf refus de plus, sans une seule section enregistrée entre-temps : c'est une vraie panne.
    await getDb().update(ebookJobs).set({ stalls: 20, leaseUntil: new Date(Date.now() - 1_000) }).where(eq(ebookJobs.id, jobId));
    const abandon = (await agent.get(`/api/writing/ebook/${jobId}`).expect(200)).body.job as Job;
    assert.equal(abandon.status, 'failed');
    assert.equal(abandon.error?.code, 'EBOOK_STALLED');
    assert.match(abandon.error?.message ?? '', /points ont été rendus/);
    assert.doesNotMatch(abandon.error?.message ?? '', /interrompue|Relancez/, 'plus de reproche d’interruption');
    assert.equal(await balance(agent), start, 'points rendus');
    saturation = 0;
  });

  it('écrit la tranche suivante à la demande du site lui-même, sans aucun navigateur', async () => {
    const request = (await import('supertest')).default;
    const { userId } = await signInWithPlan(app, 'autrice-ecran-eteint@exemple.com', 'pro');
    const { getDb } = await import('@server/db/client');
    const { ebookJobs } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');

    const [job] = await getDb()
      .insert(ebookJobs)
      .values({
        userId,
        kind: 'ebook',
        productId: 'produit-ecran-eteint',
        title: REQUEST.title,
        market: 'SN',
        status: 'queued',
        targetPages: 20,
        request: REQUEST as unknown as Record<string, unknown>,
        creditsCharged: 0,
        progressAt: new Date(),
      })
      .returning();

    // Sans le secret du planificateur, personne ne peut faire tourner une rédaction.
    await request(app).post('/api/cron/redaction').send({ jobId: job!.id }).expect(401);
    await request(app).post('/api/cron/redaction').set('Authorization', 'Bearer mauvais-secret-de-seize-car').send({ jobId: job!.id }).expect(401);
    await request(app).post('/api/cron/redaction').set('Authorization', `Bearer ${SECRET}`).send({ jobId: 'pas-un-identifiant' }).expect(400);

    const accepte = await request(app).post('/api/cron/redaction').set('Authorization', `Bearer ${SECRET}`).send({ jobId: job!.id }).expect(202);
    assert.equal(accepte.body.accepted, true, 'la réponse part tout de suite ; la tranche s’écrit ensuite');

    // Aucun suivi d'écran : on ne lit que la base.
    let etat = job!;
    for (let attempt = 0; attempt < 100 && etat.status !== 'completed'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      [etat] = (await getDb().select().from(ebookJobs).where(eq(ebookJobs.id, job!.id))) as [typeof etat];
    }
    assert.equal(etat.status, 'completed', 'la rédaction aboutit sans qu’aucun écran ne la suive');
    assert.equal(etat.sectionsDone, 4);
  });
});
