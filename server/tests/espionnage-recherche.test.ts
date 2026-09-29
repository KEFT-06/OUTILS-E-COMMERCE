import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Recherche par mot-clé dans la bibliothèque publicitaire, comme sur celle de Meta, contre un
 * faux Apify. Ce que ces tests verrouillent :
 *  - une recherche rend les publicités de TOUS les comptes qui utilisent le mot, pas seulement
 *    celles de la plateforme — et celles de la plateforme rejoignent aussi le mur ;
 *  - la même recherche, par un autre compte, dans les 24 heures, est relue sans nouvel appel payé ;
 *  - les refus (palier, quota, plafond du serveur) tombent AVANT tout appel au fournisseur.
 */

const JOUR = 86_400;
const lancements: { url: string; resultsLimit: number }[] = [];
const suivis = new Map<string, number>();

const annonce = (id: string, lien: string, page: string) => ({
  adArchiveID: id,
  pageID: `9${id}`,
  pageName: page,
  startDate: Math.floor(Date.now() / 1000) - 30 * JOUR,
  isActive: true,
  collationCount: 1,
  publisherPlatform: ['FACEBOOK'],
  snapshot: {
    linkUrl: lien,
    caption: new URL(lien).hostname,
    title: `Offre ${id}`,
    body: { text: `Texte ${id}` },
    ctaText: 'Shop now',
    images: [{ resizedImageUrl: `https://scontent.xx.fbcdn.net/${id}.jpg` }],
    videos: [],
  },
});

const faux = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://faux.test');
    const json = (code: number, corps: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corps));
    };
    if (req.method === 'POST' && url.pathname === '/acts/apify~facebook-ads-scraper/runs') {
      const entree = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { startUrls: { url: string }[]; resultsLimit: number };
      lancements.push({ url: entree.startUrls[0]!.url, resultsLimit: entree.resultsLimit });
      return json(201, { data: { id: `recherche-${lancements.length}`, defaultDatasetId: `lot-${lancements.length}` } });
    }
    const suivi = /^\/actor-runs\/(recherche-\d+)$/.exec(url.pathname);
    if (req.method === 'GET' && suivi) {
      // Premier suivi : encore en cours, comme un vrai passage d'une minute.
      const n = (suivis.get(suivi[1]!) ?? 0) + 1;
      suivis.set(suivi[1]!, n);
      return json(200, { data: { status: n === 1 ? 'RUNNING' : 'SUCCEEDED' } });
    }
    if (req.method === 'GET' && /^\/datasets\/lot-\d+\/items$/.test(url.pathname)) {
      return json(200, [
        annonce('501', 'https://kpougeet.mychariow.shop/formation', 'Kpougeet Formations'),
        annonce('502', 'https://www.boutique-independante.com/ebook', 'Éditions Indépendantes'),
        annonce('503', 'https://selar.co/p/guide', 'Coach Digital'),
      ]);
    }
    json(404, {});
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
  app = await createTestApp({
    APIFY_TOKEN: 'jeton-apify-de-test',
    APIFY_API_URL: `http://127.0.0.1:${(faux.address() as AddressInfo).port}`,
    APIFY_ADS_ACTOR: 'apify~facebook-ads-scraper',
    SPY_SEARCH_RESULTS: '50',
    // Plafond du serveur : cinq recherches nouvelles de cinquante publicités ce mois-ci.
    SPY_SEARCH_MONTHLY_ADS: '250',
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => faux.close(() => r()));
});

type Search = {
  id: string;
  status: string;
  fromCache: boolean;
  platformAds: number;
  ads: { externalId: string; storeHost: string | null; advertiser: string | null; ctaText: string | null; runningDays: number | null }[];
};

async function attendre(agent: Awaited<ReturnType<typeof signInWithPlan>>['agent'], id: string): Promise<Search> {
  for (let essai = 0; essai < 20; essai += 1) {
    const search = (await agent.get(`/api/espionnage/searches/${id}`).expect(200)).body.search as Search;
    if (search.status !== 'running') return search;
  }
  assert.fail('la recherche n’a pas abouti');
}

describe('Espionnage — recherche comme sur Meta', () => {
  it('rend les publicités de tous les comptes qui utilisent le mot, et verse celles de la plateforme au mur', async () => {
    const { agent } = await signInWithPlan(app, 'chercheur-pro@exemple.test', 'pro');
    const lance = await agent.post('/api/espionnage/searches').send({ query: 'Chariow', country: 'cm' }).expect(202);
    const debut = lance.body.search as Search;
    assert.equal(debut.status, 'running', 'une recherche nouvelle prend environ une minute');
    assert.equal(lancements.length, 1);
    const adresse = new URL(lancements[0]!.url);
    assert.equal(adresse.searchParams.get('q'), 'Chariow');
    assert.equal(adresse.searchParams.get('country'), 'CM');
    assert.equal(lancements[0]!.resultsLimit, 50, 'plafond facturé par recherche');

    const fin = await attendre(agent, debut.id);
    assert.equal(fin.status, 'done');
    assert.deepEqual(fin.ads.map((ad) => ad.advertiser), ['Kpougeet Formations', 'Éditions Indépendantes', 'Coach Digital']);
    assert.equal(fin.platformAds, 1, 'une seule mène à la plateforme');
    assert.equal(fin.ads[0]!.storeHost, 'kpougeet.mychariow.com');
    assert.equal(fin.ads[1]!.storeHost, null);
    assert.equal(fin.ads[0]!.ctaText, 'Shop now');
    assert.ok((fin.ads[0]!.runningDays ?? 0) >= 29);

    const mur = (await agent.get('/api/espionnage?etat=toutes').expect(200)).body as { ads: { externalId: string }[] };
    assert.ok(mur.ads.some((ad) => ad.externalId === '501'), 'l’annonce de la plateforme rejoint le mur');
    assert.ok(!mur.ads.some((ad) => ad.externalId === '502'), 'les autres restent dans la recherche');
  });

  it('relit gratuitement la même recherche, pour tout compte, même au palier Gratuit', async () => {
    const avant = lancements.length;
    const { agent: gratuit } = await signInWithPlan(app, 'chercheur-gratuit@exemple.test', 'free');
    const relue = (await gratuit.post('/api/espionnage/searches').send({ query: '  chariow ', country: 'CM' }).expect(202)).body.search as Search;
    assert.equal(relue.fromCache, true);
    assert.equal(relue.status, 'done');
    assert.equal(relue.ads.length, 3);
    assert.equal(lancements.length, avant, 'aucun nouvel appel payé');

    const { recent, quota } = (await gratuit.get('/api/espionnage/searches').expect(200)).body as {
      recent: { query: string }[];
      quota: { used: number; limit: number };
    };
    assert.deepEqual(recent.map((r) => r.query), ['Chariow']);
    assert.deepEqual({ used: quota.used, limit: quota.limit }, { used: 0, limit: 0 });

    // Une recherche nouvelle, elle, n'est pas ouverte au palier Gratuit — et ne coûte rien.
    const refus = await gratuit.post('/api/espionnage/searches').send({ query: 'ebook cuisine' }).expect(403);
    assert.equal(refus.body.error.code, 'SPY_SEARCH_PLAN');
    assert.equal(lancements.length, avant);
  });

  it('borne les recherches nouvelles au quota du palier, puis au plafond mensuel du serveur', async () => {
    const { agent: plus } = await signInWithPlan(app, 'chercheur-plus@exemple.test', 'plus');
    for (const mot of ['formation excel', 'coran enfants', 'guide pdf']) {
      await plus.post('/api/espionnage/searches').send({ query: mot }).expect(202);
    }
    const avant = lancements.length;
    const quota = await plus.post('/api/espionnage/searches').send({ query: 'quatrième mot' }).expect(429);
    assert.equal(quota.body.error.code, 'SPY_SEARCH_QUOTA', 'palier Plus : trois recherches nouvelles par mois');
    assert.equal(lancements.length, avant, 'refusée avant tout appel');

    // Quatre recherches faites sur cinq : le compte Pro en lance une, puis bute sur le plafond.
    const { agent: pro } = await signInWithPlan(app, 'chercheur-pro-2@exemple.test', 'pro');
    await pro.post('/api/espionnage/searches').send({ query: 'cinquième mot' }).expect(202);
    const plafond = await pro.post('/api/espionnage/searches').send({ query: 'sixième mot' }).expect(429);
    assert.equal(plafond.body.error.code, 'SPY_SEARCH_BUDGET');
    assert.equal(lancements.length, avant + 1);
  });

  it('reprend une récolte coupée en route au lieu de tourner sans fin', async () => {
    const { getDb } = await import('@server/db/client');
    const { adSearches } = await import('@server/db/schema');
    const { agent, userId } = await signInWithPlan(app, 'chercheur-bloque@exemple.test', 'pro');
    // Instance coupée entre « harvesting » et « done », il y a dix minutes.
    const [bloquee] = await getDb()
      .insert(adSearches)
      .values({
        query: 'coaching',
        queryKey: 'coaching',
        country: 'ALL',
        requestedBy: userId,
        resultsLimit: 50,
        status: 'harvesting',
        providerRunId: 'recherche-99',
        datasetId: 'lot-99',
        createdAt: new Date(Date.now() - 10 * 60_000),
      })
      .returning();

    const fin = await attendre(agent, bloquee!.id);
    assert.equal(fin.status, 'done', 'la recherche aboutit');
    assert.equal(fin.ads.length, 3);
    // Relue une seconde fois : les résultats ne sont pas doublés.
    const relue = (await agent.get(`/api/espionnage/searches/${bloquee!.id}`).expect(200)).body.search as Search;
    assert.equal(relue.ads.length, 3);
  });
});
