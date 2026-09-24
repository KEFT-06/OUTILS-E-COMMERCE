import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Radar, contre une fausse vitrine Chariow.
 *
 * Ce que ces tests verrouillent est la raison d'être du module : un relevé unique n'apprend
 * rien qu'une page ne montre déjà, et toute la valeur vient de la COMPARAISON de deux
 * passages. Un produit retiré, un prix qui change, des ventes qui accélèrent : aucune de
 * ces trois informations n'est lisible sur la vitrine, parce qu'une vitrine ne publie que
 * son présent.
 *
 * Deux détails relevés sur la vraie API et vérifiés ici :
 *  - l'identifiant de la boutique n'est pas dans l'adresse, il est DANS la page ;
 *  - `sales_count` est public — c'est sa progression qui mesure la demande, jamais son total,
 *    qui contient des ventes antérieures au premier passage.
 */

const BOUTIQUE = 'store_faussevitrine';

interface FauxProduit {
  id: string;
  name: string;
  prix: number;
  ventes: number;
  status?: string;
}

/** Catalogue servi par la fausse vitrine. Un test le modifie pour simuler le lendemain. */
let catalogue: FauxProduit[] = [];
let appelsCatalogue = 0;

const PAGE = `<!DOCTYPE html><html><head>
<meta property="og:title" content="BOUTIQUE TÉMOIN"/>
<title>BOUTIQUE TÉMOIN</title>
</head><body><script>self.__next_f.push([1,"{\\"store\\":{\\"id\\":\\"${BOUTIQUE}\\"}}"])</script></body></html>`;

const fausseVitrine = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://vitrine.test');

  if (url.pathname === `/storefront/${BOUTIQUE}/products`) {
    appelsCatalogue += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        data: catalogue.map((produit) => ({
          id: produit.id,
          name: produit.name,
          type: 'downloadable',
          status: produit.status ?? 'published',
          pricing: { effective: { value: produit.prix, currency: 'XAF' } },
          sales_count: { value: produit.ventes },
          store: { name: 'BOUTIQUE TÉMOIN', url: 'https://temoin.mychariow.shop' },
        })),
        pagination: { next_page_url: null, has_more_pages: false },
      }),
    );
    return;
  }

  if (url.pathname === '/' || url.pathname === '') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ detail: 'Not Found' }));
});

let app: Express;
let base = '';

before(async () => {
  await new Promise<void>((r) => fausseVitrine.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(fausseVitrine.address() as AddressInfo).port}`;
  app = await createTestApp({ CHARIOW_STOREFRONT_URL: base });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => fausseVitrine.close(() => r()));
});

describe('Radar — surveillance continue', () => {
  it('lit l’identifiant de la boutique dans sa page, puis relève tout le catalogue', async () => {
    catalogue = [
      { id: 'prd_aaa', name: 'Pack 33 produits digitaux', prix: 10_000, ventes: 4 },
      { id: 'prd_bbb', name: 'Logiciel de réinitialisation', prix: 7_500, ventes: 10 },
      // Un brouillon n'est pas en vente : le compter ferait naître un faux produit.
      { id: 'prd_ccc', name: 'Brouillon non publié', prix: 1_000, ventes: 0, status: 'draft' },
    ];
    const avant = appelsCatalogue;

    const { agent } = await signInWithPlan(app, 'radar-ajout@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);

    assert.equal(ajout.body.watch.label, 'BOUTIQUE TÉMOIN', 'le libellé vient du titre de la vitrine');
    assert.ok(appelsCatalogue > avant, 'le premier relevé part tout de suite, sans attendre la nuit');
    assert.equal(ajout.body.firstSweep.observed, 2, 'le brouillon est écarté');
    assert.equal(ajout.body.firstSweep.appeared, 2);
    assert.equal(ajout.body.watch.liveItems, 2);
    assert.equal(ajout.body.watch.totalSales, 14, 'ventes affichées par la boutique : 4 + 10');

    // La même boutique deux fois n'a aucun sens : l'historique doit rester unique.
    await agent.post('/api/radar/watches').send({ target: base }).expect(409);
  });

  it('constate l’arrêt d’un produit, le changement de prix et l’accélération des ventes', async () => {
    catalogue = [
      { id: 'prd_ddd', name: 'Formation bureautique', prix: 12_000, ventes: 5 },
      { id: 'prd_eee', name: 'Modèles Canva', prix: 3_000, ventes: 0 },
    ];

    const { agent } = await signInWithPlan(app, 'radar-diff@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    const watchId = ajout.body.watch.id as string;

    // Le lendemain : un produit retiré, un prix baissé, des ventes qui décollent.
    catalogue = [{ id: 'prd_ddd', name: 'Formation bureautique', prix: 9_000, ventes: 12 }];

    const releve = await agent.post(`/api/radar/watches/${watchId}/sweep`).expect(200);
    assert.deepEqual(releve.body.outcome, {
      observed: 1,
      appeared: 0,
      disappeared: 1,
      priceChanged: 1,
      salesJumps: 1,
    });

    const { body } = await agent.get(`/api/radar/watches/${watchId}/events`).expect(200);
    const parGenre = new Map<string, string>(
      (body.events as { kind: string; summary: string }[]).map((event) => [event.kind, event.summary]),
    );

    assert.match(parGenre.get('disappeared') ?? '', /Modèles Canva/);
    assert.match(parGenre.get('disappeared') ?? '', /n'est plus en vente/);
    assert.match(parGenre.get('price_changed') ?? '', /baissé/);
    // \s couvre l'espace fine insécable que produit toLocaleString('fr-FR').
    assert.match(parGenre.get('price_changed') ?? '', /9\s?000/, 'le nouveau prix figure dans la phrase');
    assert.match(parGenre.get('sales_jump') ?? '', /7 ventes de plus/, '12 − 5, mesuré entre deux passages');

    // L'article arrêté garde sa ligne et sa date de mort : c'est l'information que la
    // vitrine ne donne pas, puisqu'elle n'affiche plus ce produit du tout.
    const articles = await agent.get(`/api/radar/watches/${watchId}/items`).expect(200);
    const items = articles.body.items as { name: string; endedAt: string | null; trackedDays: number }[];
    const arrete = items.find((item) => item.name.includes('Canva'));
    assert.ok(arrete?.endedAt, 'la date d’arrêt est conservée');
    // Le filtre d'ancienneté de l'écran repose entièrement sur ce champ : il doit être servi
    // pour tout article, y compris celui qui s'est arrêté.
    assert.ok(
      items.every((item) => typeof item.trackedDays === 'number'),
      'chaque article porte son ancienneté de suivi',
    );
  });

  it('mesure les ventes faites pendant la surveillance, jamais le compteur total du concurrent', async () => {
    catalogue = [{ id: 'prd_fff', name: 'Guide import Chine', prix: 5_000, ventes: 100 }];

    const { agent } = await signInWithPlan(app, 'radar-mesure@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    const watchId = ajout.body.watch.id as string;

    const debut = await agent.get('/api/radar/measurements').expect(200);
    assert.equal(debut.body.stores, 1);
    assert.equal(debut.body.liveOffers, 1);
    assert.deepEqual(debut.body.salesByCurrency, [], 'au premier passage, aucune vente ne nous est imputable');

    // Trois ventes de plus. Le concurrent en affiche 103 ; le radar n'en revendique que 3.
    catalogue = [{ id: 'prd_fff', name: 'Guide import Chine', prix: 5_000, ventes: 103 }];
    await agent.post(`/api/radar/watches/${watchId}/sweep`).expect(200);

    const apres = await agent.get('/api/radar/measurements').expect(200);
    assert.deepEqual(apres.body.salesByCurrency, [{ currency: 'XAF', units: 3, revenue: 15_000 }]);
    assert.deepEqual(apres.body.medianPriceByCurrency, [{ currency: 'XAF', price: 5_000 }]);
    // Moins de deux jours de recul : une vitesse serait inventée.
    assert.equal(apres.body.salesPerDay, null);
  });

  it('refuse le radar au palier gratuit, et la surveillance d’autrui à tout le monde', async () => {
    catalogue = [{ id: 'prd_ggg', name: 'Pack réseaux sociaux', prix: 2_000, ventes: 1 }];

    const { agent: gratuit } = await signInWithPlan(app, 'radar-gratuit@exemple.test', 'free');
    const refus = await gratuit.post('/api/radar/watches').send({ target: base }).expect(403);
    assert.equal(refus.body.error.code, 'WATCH_LIMIT_REACHED');

    const tableau = await gratuit.get('/api/radar').expect(200);
    assert.equal(tableau.body.limit, 0, 'l’écran sait qu’il doit proposer un palier supérieur');
    assert.deepEqual(tableau.body.watches, []);

    const { agent: proprietaire } = await signInWithPlan(app, 'radar-proprio@exemple.test', 'pro');
    const ajout = await proprietaire.post('/api/radar/watches').send({ target: base }).expect(201);
    const watchId = ajout.body.watch.id as string;

    const { agent: intrus } = await signInWithPlan(app, 'radar-intrus@exemple.test', 'pro');
    await intrus.get(`/api/radar/watches/${watchId}/items`).expect(404);
    await intrus.post(`/api/radar/watches/${watchId}/sweep`).expect(404);
    await intrus.delete(`/api/radar/watches/${watchId}`).expect(404);
    // Le fil d'autrui n'apparaît pas non plus dans le sien.
    const chezIntrus = await intrus.get('/api/radar').expect(200);
    assert.deepEqual(chezIntrus.body.events, []);
  });

  /*
    Le balayage relevait vingt boutiques par tour, et annonçait vingt boutiques dues.

    Sur un hébergement sans serveur, où le planificateur ne se réveille qu'une fois par jour
    — l'offre Hobby de Vercel n'autorisant QU'UN cron quotidien — la plateforme entière était
    donc plafonnée à vingt relevés par jour. Un seul compte Max en consomme vingt.

    Et rien ne le disait : le compte des surveillances dues était lui-même tronqué par la
    même limite, si bien que le journal affichait « 20/20 relevées » sur une file de cent.
    Un plafond qui se déclare atteint à chaque fois est indiscernable d'un travail terminé.
  */
  it('compte toutes les surveillances dues, et dit ce qui reste quand le temps manque', async () => {
    const { getDb } = await import('@server/db/client');
    const { watches } = await import('@server/db/schema');
    const { sweepDueWatches } = await import('@server/services/radar/sweeper');

    const { userId } = await signInWithPlan(app, 'radar-file@exemple.test', 'pro');

    // Vingt-cinq : au-delà de l'ancienne limite fixe de vingt, c'est là que le défaut apparaît.
    await getDb()
      .insert(watches)
      .values(
        Array.from({ length: 25 }, (_, rang) => ({
          userId,
          source: 'chariow_store' as const,
          externalId: `store_file_${rang}`,
          label: `Boutique ${rang}`,
          url: `https://file-${rang}.mychariow.com`,
          active: true,
          lastSweptAt: null,
        })),
      );

    /*
      Budget nul : aucune boutique n'est relevée, donc aucun appel n'est fait chez un tiers.
      Ce qui est vérifié ici n'est pas le relevé mais la COMPTABILITÉ du balayage — le seul
      endroit où le défaut se voyait.
    */
    const tour = await sweepDueWatches(new Date(), 0);

    assert.ok(tour.due >= 25, `toutes les surveillances dues sont comptées, pas seulement les vingt premières (reçu ${tour.due})`);
    assert.equal(tour.swept, 0, 'sans budget, rien n’est relevé');
    assert.equal(tour.remaining, tour.due, 'et la file entière est annoncée comme restant à faire');
  });

  it('n’accepte à surveiller qu’une vitrine de la plateforme, pas une adresse quelconque', async () => {
    const { agent } = await signInWithPlan(app, 'radar-hors-champ@exemple.test', 'pro');
    // Sans cette barrière, une adresse fournie par un utilisateur ferait appeler par le
    // serveur n'importe quelle machine, y compris sur le réseau interne de l'hébergeur.
    const refus = await agent.post('/api/radar/watches').send({ target: 'https://exemple.test/interne' }).expect(400);
    assert.equal(refus.body.error.code, 'RADAR_SOURCE_UNSUPPORTED');
  });
});
