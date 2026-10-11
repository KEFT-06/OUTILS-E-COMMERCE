import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * La recherche publicitaire quand la lecture payante se dérobe, contre un faux fournisseur qui
 * refuse le serveur et un faux GitHub.
 *
 * Signalé par le propriétaire le 11/10/2026 : « Recherche impossible — le service de collecte
 * publicitaire refuse l'accès du serveur… mais on a Playwright et Crawlee, pourquoi ça dérange
 * quand il n'est plus là ? ». Ce que ces tests verrouillent : la recherche n'échoue plus, elle
 * change de source — nos relevés tout de suite, puis la lecture de notre collecteur.
 */

const SECRET = 'secret-du-planificateur-de-test';
const JOUR = 86_400;
const maintenant = Math.floor(Date.now() / 1000);

/** Lancements refusés par le faux fournisseur, et passages demandés au faux GitHub. */
let refus = 0;
const passages: { path: string; authorization: string | undefined; body: { ref?: string; inputs?: Record<string, string> } }[] = [];

const faux = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://faux.test');
    if (url.pathname.startsWith('/apify/')) {
      refus += 1;
      res.writeHead(403, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { type: 'user-or-token-not-found', message: 'User was not found or authentication token is not valid' } }));
    }
    if (req.method === 'POST' && url.pathname.startsWith('/github/repos/')) {
      passages.push({ path: url.pathname, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as { ref?: string } });
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
});

/** Une annonce telle que la bibliothèque la rend (champs en « snake_case »). */
const annonce = (id: string, lien: string, texte: string, page = 'Page de test') => ({
  ad_archive_id: id,
  is_active: true,
  start_date: maintenant - 40 * JOUR,
  end_date: maintenant,
  collation_count: 1,
  publisher_platform: ['FACEBOOK'],
  page_id: `77${id}`,
  page_name: page,
  snapshot: {
    link_url: lien,
    caption: new URL(lien).hostname,
    title: texte,
    body: { text: `${texte} — texte de l’annonce ${id}` },
    images: [{ resized_image_url: `https://scontent.xx.fbcdn.net/${id}.jpg` }],
    videos: [],
    cards: [],
    page_name: page,
    cta_text: 'En savoir plus',
    display_format: 'IMAGE',
  },
});

let app: Express;

before(async () => {
  await new Promise<void>((resolve) => faux.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(faux.address() as AddressInfo).port}`;
  app = await createTestApp({
    CRON_SECRET: SECRET,
    // La lecture payante est branchée, mais son compte refuse le serveur.
    APIFY_TOKEN: 'jeton-refuse',
    APIFY_API_URL: `${base}/apify`,
    SPY_SEARCH_RESULTS: '50',
    COLLECTOR_DISPATCH_TOKEN: 'jeton-github-de-test',
    GITHUB_API_URL: `${base}/github`,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => faux.close(() => resolve()));
});

const collecteur = () => ({
  plan: () => request(app).get('/api/cron/collecte').set('Authorization', `Bearer ${SECRET}`),
  verse: (body: Record<string, unknown>) => request(app).post('/api/cron/collecte').set('Authorization', `Bearer ${SECRET}`).send(body),
});

type Search = { id: string; status: string; adsFound: number; error: string | null; refreshing: string | null; ads: { externalId: string; storeHost: string | null }[] };
const attendrePassages = async (nombre: number) => {
  for (let essai = 0; essai < 40 && passages.length < nombre; essai += 1) await new Promise((resolve) => setTimeout(resolve, 25));
};

describe('Recherche publicitaire sans la lecture payante', () => {
  it('répond avec nos relevés au lieu d’échouer, et appelle notre collecteur pour ce mot', async () => {
    // Le mur contient déjà deux annonces qui parlent de « formation excel », relevées par le collecteur.
    await collecteur()
      .verse({ country: 'CM', items: [annonce('9001', 'https://kpougeet.mychariow.shop/prd_excel', 'Formation Excel en 7 jours'), annonce('9000', 'https://excel-facile.mychariow.shop/prd_tableaux', 'Formation Excel : tableaux croisés')] })
      .expect(200);

    const { agent } = await signInWithPlan(app, 'chercheuse@exemple.test', 'pro');
    const lancee = await agent.post('/api/espionnage/searches').send({ query: 'formation excel' }).expect(202);
    const recherche = lancee.body.search as Search;

    assert.ok(refus >= 1, 'la lecture payante a bien été essayée, et a refusé');
    assert.equal(recherche.status, 'done', 'la recherche aboutit quand même');
    assert.equal(recherche.error, null);
    assert.doesNotMatch(JSON.stringify(lancee.body), /refuse l’accès|administrateur/, 'le refus du fournisseur n’est pas l’affaire de celui qui cherche');
    assert.deepEqual(recherche.ads.map((ad) => ad.externalId).sort(), ['9000', '9001'], 'ce que nos relevés contiennent pour ce mot');
    assert.equal(recherche.refreshing, 'soon', 'la liste va se compléter : le collecteur est appelé');

    await attendrePassages(1);
    assert.equal(passages.length, 1);
    assert.equal(passages[0]!.path, '/github/repos/KEFT-06/OUTILS-E-COMMERCE/actions/workflows/collecte.yml/dispatches');
    assert.equal(passages[0]!.authorization, 'Bearer jeton-github-de-test');
    assert.deepEqual(passages[0]!.body, { ref: 'lot1-socle-de-confiance', inputs: { demandes: 'oui' } }, 'un passage court : les recherches en attente seulement');

    // Le collecteur apprend, par son plan, quelle recherche lire.
    const plan = (await collecteur().plan().expect(200)).body as { searches: { id: string; query: string; country: string; max: number }[] };
    assert.deepEqual(plan.searches, [{ id: recherche.id, query: 'formation excel', country: 'ALL', max: 50 }]);

    // Il verse ce qu'il a lu, en deux lots : la lecture fraîche remplace nos relevés.
    await collecteur()
      .verse({
        country: 'ALL',
        search: { id: recherche.id, first: true, done: false },
        items: [annonce('9001', 'https://kpougeet.mychariow.shop/prd_excel', 'Formation Excel en 7 jours'), annonce('9002', 'https://www.ecole-bureautique.com/excel', 'Formation Excel certifiante')],
      })
      .expect(200);
    const enRoute = (await agent.get(`/api/espionnage/searches/${recherche.id}`).expect(200)).body.search as Search;
    assert.deepEqual([enRoute.adsFound, enRoute.refreshing], [3, 'soon'], 'les premières annonces sont déjà visibles, la suite arrive');

    const dernier = await collecteur()
      .verse({
        country: 'ALL',
        search: { id: recherche.id, first: false, done: true },
        items: [annonce('9002', 'https://www.ecole-bureautique.com/excel', 'Formation Excel certifiante'), annonce('9003', 'https://selar.co/p/excel', 'Excel pour comptables')],
      })
      .expect(200);
    assert.equal(dernier.body.searchStored, 1, 'une annonce déjà versée n’est pas doublée');

    const complete = (await agent.get(`/api/espionnage/searches/${recherche.id}`).expect(200)).body.search as Search;
    assert.equal(complete.refreshing, null, 'la liste est finale');
    assert.equal(complete.adsFound, 4);
    assert.deepEqual(
      complete.ads.map((ad) => ad.externalId),
      ['9001', '9002', '9003', '9000'],
      'la lecture fraîche en tête — toutes les annonces du mot, pas seulement celles des boutiques suivies —, puis celle de nos relevés qu’elle n’a pas retrouvée',
    );
    assert.deepEqual((await collecteur().plan().expect(200)).body.searches, [], 'elle n’attend plus');

    // Un autre compte qui cherche le même mot dans la journée relit cette liste, sans nouveau passage.
    const { agent: voisin } = await signInWithPlan(app, 'voisin@exemple.test', 'free');
    const relue = (await voisin.post('/api/espionnage/searches').send({ query: 'Formation  EXCEL' }).expect(202)).body.search as Search & { fromCache: boolean };
    assert.deepEqual([relue.id, relue.fromCache], [recherche.id, true]);
    assert.equal(passages.length, 1);
  });

  it('garde ce que nos relevés avaient trouvé quand la lecture fraîche revient vide', async () => {
    await collecteur().verse({ country: 'CI', items: [annonce('9101', 'https://boutique-ci.mychariow.shop/prd_coran', 'Coran pour enfants, méthode audio')] }).expect(200);
    const { agent } = await signInWithPlan(app, 'chercheur-vide@exemple.test', 'pro');
    const recherche = (await agent.post('/api/espionnage/searches').send({ query: 'coran pour enfants', country: 'CI' }).expect(202)).body.search as Search;
    assert.deepEqual(recherche.ads.map((ad) => ad.externalId), ['9101']);

    await collecteur().verse({ country: 'CI', items: [], search: { id: recherche.id, first: true, done: true } }).expect(200);
    const apres = (await agent.get(`/api/espionnage/searches/${recherche.id}`).expect(200)).body.search as Search;
    assert.deepEqual(apres.ads.map((ad) => ad.externalId), ['9101'], 'une page revenue vide ne remplace pas une réponse');
    assert.deepEqual([apres.adsFound, apres.refreshing], [1, null]);

    // Un lot pour une recherche inconnue, ou déjà lue, est versé au mur et rien de plus.
    const perdu = await collecteur().verse({ country: 'CI', items: [], search: { id: recherche.id, first: true, done: true } }).expect(200);
    assert.equal(perdu.body.searchStored, undefined);
  });

  it('garde les règles du palier, et ne demande pas deux passages pour deux recherches d’affilée', async () => {
    const { agent: gratuit } = await signInWithPlan(app, 'chercheur-gratuit@exemple.test', 'free');
    const avant = passages.length;
    const refuse = await gratuit.post('/api/espionnage/searches').send({ query: 'un mot jamais cherché' }).expect(403);
    assert.equal(refuse.body.error.code, 'SPY_SEARCH_PLAN');

    // Palier Plus : trois recherches nouvelles par mois, quelle que soit leur source.
    const { agent: plus } = await signInWithPlan(app, 'chercheur-plus-collecteur@exemple.test', 'plus');
    for (const mot of ['ebook cuisine', 'guide couture', 'cours anglais']) {
      const faite = (await plus.post('/api/espionnage/searches').send({ query: mot }).expect(202)).body.search as Search;
      assert.deepEqual([faite.status, faite.adsFound, faite.refreshing], ['done', 0, 'soon'], 'rien dans nos relevés : la liste est vide, et elle va se remplir');
    }
    const quota = await plus.post('/api/espionnage/searches').send({ query: 'quatrième mot' }).expect(429);
    assert.equal(quota.body.error.code, 'SPY_SEARCH_QUOTA');

    await attendrePassages(avant + 1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(passages.length, avant + 1, 'trois recherches dans la même minute : un seul passage les lira toutes');
    assert.equal((await collecteur().plan().expect(200)).body.searches.length, 3);
  });
});
