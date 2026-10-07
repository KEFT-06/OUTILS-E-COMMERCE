import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Radar, index du marché et alertes, contre une fausse vitrine qui répond comme la vraie
 * plateforme depuis l'automne 2026 (mesuré le 04/10/2026 sur une vraie boutique) :
 *
 *   · la LISTE du catalogue ne donne plus les ventes — nom, prix, avis seulement ;
 *   · la FICHE de chaque produit donne `sales_count` et la catégorie ;
 *   · les prix reviennent dans la devise du LIEU du demandeur, sauf si `?currency=` est précisé :
 *     depuis le serveur d'Irlande, 1 100 FCFA revenaient « 2 EUR ».
 *
 * Le radar lisait la liste : toutes les ventes arrivaient vides, l'écran affichait « — » et
 * « 0 ventes », et plus aucune accélération n'était signalée.
 */

const BOUTIQUE = 'store_vitrinenouvelle';

interface Produit {
  id: string;
  name: string;
  slug: string;
  prix: number;
  ventes: number;
  /** false : la fiche de ce produit est illisible (panne passagère). */
  ficheLisible?: boolean;
}

let catalogue: Produit[] = [];
let fichesLues = 0;

const fausseVitrine = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://vitrine.test');
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === `/storefront/${BOUTIQUE}/products`) {
    // La liste, telle que la plateforme la rend aujourd'hui : AUCUN compte de ventes.
    return json(200, {
      data: catalogue.map((produit) => ({
        id: produit.id,
        name: produit.name,
        slug: produit.slug,
        type: 'downloadable',
        status: 'published',
        // Sans `?currency=`, la plateforme répond dans la devise du demandeur : ici l'euro, comme depuis l'Irlande.
        pricing:
          url.searchParams.get('currency') === 'XAF'
            ? { type: 'one_time', current_price: { value: produit.prix, currency: 'XAF' } }
            : { type: 'one_time', current_price: { value: Math.round((produit.prix / 656) * 100) / 100, currency: 'EUR' } },
        rating: { total_ratings: { value: 3 } },
      })),
      pagination: { next_page_url: null, has_more_pages: false },
    });
  }

  const fiche = new RegExp(`^/storefront/${BOUTIQUE}/products/(prd_[a-z0-9]+)$`).exec(url.pathname);
  if (fiche) {
    fichesLues += 1;
    const produit = catalogue.find((candidat) => candidat.id === fiche[1]);
    if (!produit || produit.ficheLisible === false) return json(500, { message: 'Server Error' });
    return json(200, {
      data: { id: produit.id, name: produit.name, sales_count: { value: produit.ventes, formatted: String(produit.ventes) }, category: { value: 'health_and_wellness', label: 'Health & Wellness' } },
    });
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><title>CUISINE DU PAYS</title></head><body><script>{"store":{"id":"${BOUTIQUE}"}}</script></body></html>`);
    return;
  }
  json(404, { detail: 'Not Found' });
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

describe('Radar — ventes lues dans la fiche de chaque produit', () => {
  it('affiche les ventes historiques dès la mise sous surveillance, et non « — »', async () => {
    catalogue = [
      { id: 'prd_recettes', name: 'Pack de 400 recettes camerounaises', slug: 'pack-recettes', prix: 1_100, ventes: 3_564 },
      { id: 'prd_marinades', name: 'Cubes et marinades naturels', slug: 'cubes-et-epices', prix: 1_100, ventes: 377 },
    ];
    const { agent } = await signInWithPlan(app, 'radar-fiches@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);

    assert.equal(fichesLues, 2, 'une fiche lue par produit');
    assert.equal(ajout.body.watch.totalSales, 3_941, 'le total historique de la boutique');
    assert.equal(ajout.body.watch.itemsWithSales, 2);
    assert.equal(ajout.body.watch.trackedSales, 0, 'rien n’a encore été vendu sous surveillance');

    const { body } = await agent.get(`/api/radar/watches/${ajout.body.watch.id}/items`).expect(200);
    const recettes = body.items.find((item: { name: string }) => item.name.startsWith('Pack'));
    assert.equal(recettes.sales, 3_564, 'les ventes faites AVANT la surveillance sont affichées');
    assert.equal(recettes.salesTracked, 0);
    assert.equal(recettes.category, 'health_and_wellness');
    assert.equal(recettes.price, 1_100, 'le prix de la boutique, et non sa conversion arrondie en euros');
    assert.equal(recettes.currency, 'XAF');
  });

  it('remplace sans bruit un ancien prix relevé en euros par le prix réel, sans annoncer de changement', async () => {
    const { getDb } = await import('@server/db/client');
    const { watchItems, watchEvents } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const { agent } = await signInWithPlan(app, 'radar-devise-serveur@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    const id = ajout.body.watch.id as string;

    // État d'avant le correctif : prix relevés depuis l'Irlande, en euros arrondis.
    await getDb().update(watchItems).set({ priceValue: 2, currency: 'EUR' }).where(eq(watchItems.watchId, id));
    const releve = await agent.post(`/api/radar/watches/${id}/sweep`).expect(200);
    assert.equal(releve.body.outcome.priceChanged, 0, 'la boutique n’a rien changé : aucun événement');

    const { body } = await agent.get(`/api/radar/watches/${id}/items`).expect(200);
    assert.ok(body.items.every((item: { price: number; currency: string }) => item.price === 1_100 && item.currency === 'XAF'));
    const evenements = await getDb().select().from(watchEvents).where(eq(watchEvents.watchId, id));
    assert.equal(evenements.filter((event) => event.kind === 'price_changed').length, 0);
  });

  it('sépare les ventes depuis la création de celles faites depuis le suivi, et signale l’accélération', async () => {
    const { agent } = await signInWithPlan(app, 'radar-suivi@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    const id = ajout.body.watch.id as string;

    // Le lendemain : douze ventes de plus sur le premier produit.
    catalogue[0]!.ventes += 12;
    const releve = await agent.post(`/api/radar/watches/${id}/sweep`).expect(200);
    assert.equal(releve.body.outcome?.salesJumps ?? releve.body.salesJumps, 1, 'l’accélération est de nouveau détectée');

    const tableau = await agent.get('/api/radar').expect(200);
    const watch = tableau.body.watches.find((candidat: { id: string }) => candidat.id === id);
    assert.equal(watch.totalSales, 3_953);
    assert.equal(watch.trackedSales, 12, 'seules les ventes faites sous surveillance');

    const { body } = await agent.get(`/api/radar/watches/${id}/items`).expect(200);
    const recettes = body.items.find((item: { name: string }) => item.name.startsWith('Pack'));
    assert.equal(recettes.sales, 3_576);
    assert.equal(recettes.salesTracked, 12);
  });

  it('garde le dernier compte connu quand une fiche ne répond pas, au lieu de revenir à « — »', async () => {
    const { agent } = await signInWithPlan(app, 'radar-panne@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    const id = ajout.body.watch.id as string;

    catalogue[1]!.ficheLisible = false;
    await agent.post(`/api/radar/watches/${id}/sweep`).expect(200);
    const { body } = await agent.get(`/api/radar/watches/${id}/items`).expect(200);
    const marinades = body.items.find((item: { name: string }) => item.name.startsWith('Cubes'));
    assert.equal(marinades.sales, 377, 'une panne passagère n’efface pas ce qui était connu');
    catalogue[1]!.ficheLisible = true;
  });
});

describe('Index du marché — la concurrence d’une niche', () => {
  it('retrouve les produits d’une niche chez les boutiques relevées, sans rien ressaisir', async () => {
    const { agent } = await signInWithPlan(app, 'marche-niche@exemple.test', 'pro');
    // Les boutiques relevées par les tests précédents ont nourri l'index partagé.
    const { body } = await agent.get('/api/radar/market').query({ niche: 'Recettes de cuisine camerounaise' }).expect(200);

    assert.ok(body.products.length >= 1, 'le pack de recettes est trouvé');
    const pack = body.products[0];
    assert.match(pack.name, /recettes/i);
    assert.equal(pack.currency, 'XAF');
    assert.ok(pack.sales >= 3_564, 'avec ses ventes');
    assert.ok(body.indexedProducts >= 2);
  });

  it('ne rattache pas un produit à une niche par un mot trop général', async () => {
    const { nicheKeywords } = await import('@server/services/market');
    assert.deepEqual(nicheKeywords('Gestion quotidienne du diabète'), ['diabete'], '« gestion » et « quotidienne » ne désignent aucune niche');
    assert.deepEqual(nicheKeywords('Élevage de poulets en ville'), ['elevage', 'poulet'], 'le pluriel est ramené à sa racine');
    await signInWithPlan(app, 'marche-vide@exemple.test', 'pro').then(({ agent }) => agent.get('/api/radar/market').expect(400));
  });
});

describe('Alertes', () => {
  it('déclare gagnant un produit LANCÉ sous nos yeux qui atteint 30 ventes en 3 jours, une seule fois', async () => {
    const { indexStoreCatalog } = await import('@server/services/market');
    const { detectAlerts } = await import('@server/services/alerts');
    const boutique = { externalId: 'store_gagnante', host: 'gagnante.mychariow.com', label: 'Boutique Gagnante' };
    const produit = (externalId: string, name: string, salesCount: number) => ({ externalId, name, kind: 'downloadable', priceValue: 5_000, currency: 'XAF', salesCount });
    const jour = (n: number) => new Date(Date.UTC(2026, 0, 1 + n, 3));

    // Premier relevé : le produit déjà là n'a pas de date de lancement connue.
    await indexStoreCatalog(boutique, [produit('prd_ancien', 'Guide ancien du jardinage', 500)], jour(0));
    assert.equal(await detectAlerts(jour(0)), 0, 'un produit déjà en vente au premier relevé n’est jamais « gagnant »');

    // Le lendemain, un nouveau produit apparaît ; deux jours plus tard il a 34 ventes.
    await indexStoreCatalog(boutique, [produit('prd_ancien', 'Guide ancien du jardinage', 501), produit('prd_neuf', 'Plan 21 jours sans sucre', 2)], jour(1));
    assert.equal(await detectAlerts(jour(1)), 0, 'deux ventes ne font pas un gagnant');
    await indexStoreCatalog(boutique, [produit('prd_ancien', 'Guide ancien du jardinage', 501), produit('prd_neuf', 'Plan 21 jours sans sucre', 34)], jour(3));
    assert.equal(await detectAlerts(jour(3)), 1);
    assert.equal(await detectAlerts(jour(3)), 0, 'un second passage ne répète pas l’alerte');

    const { agent } = await signInWithPlan(app, 'alertes@exemple.test', 'pro');
    assert.equal((await agent.get('/api/alerts/unread').expect(200)).body.unread, 1);
    const fil = await agent.get('/api/alerts').expect(200);
    const alerte = fil.body.alerts[0];
    assert.equal(alerte.kind, 'winner');
    assert.equal(alerte.level, 'opportunity');
    assert.match(alerte.body, /Plan 21 jours sans sucre.*Boutique Gagnante.*34 ventes en 2 jours/);
    assert.equal(alerte.payload.storeHost, 'gagnante.mychariow.com');
    assert.equal(alerte.unread, true);

    await agent.post('/api/alerts/seen').expect(204);
    assert.equal((await agent.get('/api/alerts/unread').expect(200)).body.unread, 0, 'la cloche s’éteint à l’ouverture du fil');
  });

  /*
    Les règles en ventes PAR JOUR : la différence entre deux relevés de jours consécutifs.
    Une boutique, six produits, trois jours — chacun illustre une règle, ou son absence.
  */
  it('lit les ventes du jour : premier signal, pression, scale éclair et chute brutale, sans rien inventer', async () => {
    const { indexStoreCatalog } = await import('@server/services/market');
    const { detectNewAlerts, detectAlerts } = await import('@server/services/alerts');
    const { getDb } = await import('@server/db/client');
    const { spiedAds } = await import('@server/db/schema');
    const boutique = { externalId: 'store_journal', host: 'journal.mychariow.com', label: 'Boutique Journal' };
    const jour = (n: number) => new Date(Date.UTC(2026, 4, 10 + n, 3));
    const produit = (externalId: string, name: string, salesCount: number | null) => ({ externalId, name, kind: 'downloadable', priceValue: 4_000, currency: 'XAF', salesCount });
    const releve = (ventes: (number | null)[]) => [
      produit('prd_eclair', 'Pack publicité Facebook', ventes[0]!),
      produit('prd_pression', 'Guide du maraîchage', ventes[1]!),
      produit('prd_signal', 'Recettes de jus naturels', ventes[2]!),
      produit('prd_chute', 'Formation couture', ventes[3]!),
      produit('prd_calme', 'Carnet de budget', ventes[4]!),
      produit('prd_muet', 'Méthode de lecture', ventes[5] ?? null),
    ];
    await getDb().insert(spiedAds).values({
      externalId: 'journal-ad-1',
      storeHost: 'journal.mychariow.com',
      landingUrl: 'https://journal.mychariow.com/p/couture',
      advertiser: 'Boutique Journal',
      variants: 1,
      platforms: ['FACEBOOK'],
      active: true,
      lastSeenAt: jour(2),
    });

    await indexStoreCatalog(boutique, releve([100, 50, 10, 200, 40, 30]), jour(0));
    await indexStoreCatalog(boutique, releve([103, 52, 11, 220, 44, 50]), jour(1));
    // Troisième jour : la fiche du dernier produit n'a pas répondu — ses ventes ne sont PAS lues.
    await indexStoreCatalog(boutique, releve([131, 64, 18, 220, 46, null]), jour(2));

    const creees = await detectNewAlerts(jour(2));
    const par = (nom: string) => creees.find((alerte) => alerte.payload.productName === nom);

    const eclair = par('Pack publicité Facebook');
    assert.equal(eclair?.kind, 'flash_scale');
    assert.equal(eclair?.level, 'major');
    assert.match(eclair!.body, /est passé de 3 à 28 ventes en une journée/);

    const pression = par('Guide du maraîchage');
    assert.equal(pression?.kind, 'daily_scale');
    assert.equal(pression?.level, 'opportunity');
    assert.match(pression!.body, /enregistre 12 ventes aujourd’hui/);

    const signal = par('Recettes de jus naturels');
    assert.equal(signal?.kind, 'first_traction');
    assert.equal(signal?.level, 'info');
    assert.match(signal!.body, /barre des 5 ventes dans la journée \(7 aujourd’hui\)/);

    const chute = par('Formation couture');
    assert.equal(chute?.kind, 'stockout');
    assert.equal(chute?.level, 'major');
    assert.match(chute!.body, /tombé à 0 vente aujourd’hui après 20 la veille, alors que sa publicité tourne encore/);

    assert.equal(par('Carnet de budget'), undefined, 'deux ventes dans la journée : rien à signaler');
    // 20 ventes la veille, aucun relevé aujourd'hui : ce n'est PAS « 0 vente », donc pas une chute.
    assert.equal(par('Méthode de lecture'), undefined, 'un compte non lu ne fabrique pas une rupture de stock');
    assert.equal(creees.length, 4, 'une alerte par constat, la plus forte seulement');
    // De quoi ouvrir la boutique et partir du produit dans le Studio, depuis la carte.
    assert.deepEqual(
      { host: eclair!.payload.storeHost, price: eclair!.payload.price, currency: eclair!.payload.currency, today: eclair!.payload.salesToday, yesterday: eclair!.payload.salesYesterday },
      { host: 'journal.mychariow.com', price: 4_000, currency: 'XAF', today: 28, yesterday: 3 },
    );
    assert.equal(await detectAlerts(jour(2)), 0, 'un second passage le même jour ne répète rien');

    // Sans relevé la veille, pas de « ventes du jour » : trois jours plus tard, rien n'est annoncé.
    await indexStoreCatalog(boutique, releve([400, 300, 200, 220, 46, 90]), jour(5));
    assert.equal(await detectAlerts(jour(5)), 0, 'un écart de trois jours n’est pas une journée');
  });

  /*
    Les ventes par jour demandent un relevé CHAQUE jour. Le temps de relevé est borné : les
    boutiques qui font de la publicité en ce moment passent donc devant, les autres attendent
    deux jours de plus à ancienneté égale — sans jamais être écartées.
  */
  it('relève d’abord les boutiques qui font de la publicité en ce moment, sans écarter les autres', async () => {
    const { dueDiscoveredStores } = await import('@server/services/market');
    const { getDb } = await import('@server/db/client');
    const { discoveredStores } = await import('@server/db/schema');
    const { inArray } = await import('drizzle-orm');
    const now = new Date(Date.UTC(2026, 5, 20, 4));
    const ilYA = (heures: number) => new Date(now.getTime() - heures * 3_600_000);
    const hotes = ['file-chaude.mychariow.com', 'file-froide.mychariow.com', 'file-froide-ancienne.mychariow.com', 'file-jamais.mychariow.com', 'file-a-jour.mychariow.com'];
    await getDb().insert(discoveredStores).values([
      // Publicité vue hier, relevée il y a 25 h : due aujourd'hui.
      { host: hotes[0]!, lastSeenAt: ilYA(20), indexedAt: ilYA(25) },
      // Plus de publicité depuis dix jours, relevée il y a 30 h : elle attend.
      { host: hotes[1]!, lastSeenAt: ilYA(240), indexedAt: ilYA(30) },
      // Sans publicité non plus, mais pas relevée depuis quatre jours : elle repasse devant.
      { host: hotes[2]!, lastSeenAt: ilYA(240), indexedAt: ilYA(96) },
      // Jamais relevée : toujours en tête.
      { host: hotes[3]!, lastSeenAt: ilYA(240), indexedAt: null },
      // Relevée il y a deux heures : pas due.
      { host: hotes[4]!, lastSeenAt: ilYA(2), indexedAt: ilYA(2) },
    ]);
    try {
      const ordre = (await dueDiscoveredStores(now)).map((store) => store.host).filter((host) => hotes.includes(host));
      assert.deepEqual(ordre, ['file-jamais.mychariow.com', 'file-froide-ancienne.mychariow.com', 'file-chaude.mychariow.com', 'file-froide.mychariow.com']);
    } finally {
      await getDb().delete(discoveredStores).where(inArray(discoveredStores.host, hotes));
    }
  });

  it('signale une tendance quand trois boutiques lancent un produit proche sous 72 heures', async () => {
    const { indexStoreCatalog } = await import('@server/services/market');
    const { detectAlerts, listAlerts } = await import('@server/services/alerts');
    const jour = (n: number) => new Date(Date.UTC(2026, 1, 1 + n, 3));
    const produit = (externalId: string, name: string) => ({ externalId, name, kind: 'downloadable', priceValue: 3_000, currency: 'XAF', salesCount: 0 });

    for (const rang of [1, 2, 3]) {
      const boutique = { externalId: `store_tendance${rang}`, host: `tendance${rang}.mychariow.com`, label: `Boutique ${rang}` };
      await indexStoreCatalog(boutique, [produit('prd_base', 'Catalogue de base')], jour(0));
      // Chacune lance, à un jour d'écart, un produit sur le même sujet.
      await indexStoreCatalog(boutique, [produit('prd_base', 'Catalogue de base'), produit(`prd_fumage${rang}`, `Formation fumage de poisson, méthode ${rang}`)], jour(rang));
      if (rang < 3) assert.equal(await detectAlerts(jour(rang)), 0, `${rang} boutique(s) : pas encore une tendance`);
    }
    assert.ok((await detectAlerts(jour(3))) >= 1);

    const { users } = await import('@server/db/schema');
    const { getDb } = await import('@server/db/client');
    const [compte] = await getDb().select({ id: users.id }).from(users).limit(1);
    const fil = await listAlerts(compte!.id);
    const tendance = fil.find((alerte) => alerte.kind === 'niche_trend' && /fumage|poisson/.test(alerte.body));
    assert.ok(tendance, 'la tendance est dans le fil');
    assert.equal(tendance.level, 'info');
    assert.match(tendance.body, /3 boutiques ont lancé un produit sur/);
  });

  it('ne signale l’arrêt d’une publicité que si elle tournait depuis longtemps et qu’un contrôle la dit arrêtée', async () => {
    const { getDb } = await import('@server/db/client');
    const { spiedAds } = await import('@server/db/schema');
    const { detectAlerts } = await import('@server/services/alerts');
    const now = new Date(Date.UTC(2026, 2, 1, 3));
    const ilYA = (jours: number) => new Date(now.getTime() - jours * 86_400_000);
    const annonce = (externalId: string, startedAt: Date, active: boolean, stoppedAt: Date | null) => ({
      externalId,
      storeHost: 'arret.mychariow.com',
      landingUrl: 'https://arret.mychariow.com/p/offre',
      advertiser: 'Boutique Arrêt',
      startedAt,
      variants: 1,
      platforms: ['FACEBOOK'],
      active,
      stoppedAt,
      lastSeenAt: now,
    });
    await getDb()
      .insert(spiedAds)
      .values([
        annonce('ad-longue-arretee', ilYA(95), false, ilYA(1)),
        annonce('ad-courte-arretee', ilYA(12), false, ilYA(1)),
        // Toujours en cours : simplement absente d'une collecte, ce qui ne prouve aucun arrêt.
        annonce('ad-longue-en-cours', ilYA(200), true, null),
      ]);

    assert.equal(await detectAlerts(now), 1, 'seule la publicité installée ET arrêtée est signalée');
    assert.equal(await detectAlerts(now), 0);
  });
});

/*
  « Ouvrir dans le Radar » mettait la boutique sous surveillance pour pouvoir la montrer. Palier
  plein, l'ajout était refusé (403) : on quittait une publicité pour arriver sur une erreur.
  La fiche se lit maintenant sans rien ajouter au compte, et ne dépend d'aucun quota.
*/
describe('Fiche d’une boutique — ouvrir sans surveiller', () => {
  const produit = (externalId: string, name: string, salesCount: number) => ({ externalId, name, kind: 'downloadable', priceValue: 5_000, currency: 'XAF', salesCount });
  const jour = (n: number) => new Date(Date.UTC(2026, 3, 1 + n, 3));

  it('montre catalogue, ventes et publicités à un palier plein, sans rien ajouter ni refuser', async () => {
    const { indexStoreCatalog } = await import('@server/services/market');
    const { getDb } = await import('@server/db/client');
    const { spiedAds } = await import('@server/db/schema');
    const boutique = { externalId: 'store_fiche', host: 'fiche.mychariow.com', label: 'Boutique Fiche' };
    await indexStoreCatalog(boutique, [produit('prd_manioc', 'Guide du manioc', 40), produit('prd_potager', 'Plan potager', 12)], jour(0));
    // Deux jours plus tard : un produit a vendu, l'autre a quitté la vitrine.
    await indexStoreCatalog(boutique, [produit('prd_manioc', 'Guide du manioc', 55)], jour(2));
    const annonce = (externalId: string, mediaKind: string, active: boolean) => ({
      externalId,
      storeHost: 'fiche.mychariow.com',
      landingUrl: 'https://fiche.mychariow.com/p/guide',
      advertiser: 'Boutique Fiche',
      mediaKind,
      startedAt: jour(-20),
      variants: 1,
      platforms: ['FACEBOOK'],
      active,
      lastSeenAt: jour(2),
    });
    await getDb().insert(spiedAds).values([annonce('fiche-ad-1', 'video', true), annonce('fiche-ad-2', 'image', true), annonce('fiche-ad-3', 'image', false)]);

    // Palier gratuit, sa seule surveillance déjà prise par une autre boutique.
    catalogue = [{ id: 'prd_autre', name: 'Autre boutique', slug: 'autre', prix: 1_000, ventes: 3 }];
    const { agent } = await signInWithPlan(app, 'fiche-palier-plein@exemple.test', 'free');
    await agent.post('/api/radar/watches').send({ target: base }).expect(201);

    // L'adresse arrive en « .shop » depuis une publicité : c'est la même boutique.
    const { body } = await agent.get('/api/radar/store?host=fiche.mychariow.shop').expect(200);
    assert.equal(body.host, 'fiche.mychariow.com');
    assert.equal(body.label, 'Boutique Fiche');
    assert.equal(body.followable, true);
    assert.equal(body.watchId, null, 'la boutique n’est pas surveillée par ce compte');
    assert.equal(body.limit, 1, 'le palier est connu de l’écran : il dit le quota sans appel refusé');
    assert.equal(body.liveItems, 1);
    assert.equal(body.endedItems, 1);
    assert.equal(body.totalSales, 55, 'les ventes des produits encore en vente');
    const manioc = body.products.find((entry: { name: string }) => entry.name === 'Guide du manioc');
    assert.equal(manioc.sales, 55);
    assert.equal(manioc.salesTracked, 15, 'ce qui s’est vendu depuis notre premier relevé');
    assert.equal(body.products[0].name, 'Guide du manioc', 'les produits en vente passent avant les arrêtés');
    assert.ok(body.products[1].endedAt, 'le produit retiré reste lisible, daté de son arrêt');
    assert.deepEqual({ active: body.ads.active, total: body.ads.total, videos: body.ads.videos }, { active: 2, total: 3, videos: 1 });
    // Ce qu'elle pousse en publicité : une offre, portée par trois annonces dont deux en cours.
    assert.deepEqual(body.advertised, [{ title: 'Offre sans titre', url: 'https://fiche.mychariow.com/p/guide', ads: 3, active: 2 }]);
    assert.equal(body.unreachable, false);

    const tableau = await agent.get('/api/radar').expect(200);
    assert.equal(tableau.body.watches.length, 1, 'ouvrir la fiche n’a rien mis sous surveillance');
  });

  it('reconnaît une boutique que le compte surveille déjà, et répond même pour une boutique jamais relevée', async () => {
    const { indexStoreCatalog } = await import('@server/services/market');
    catalogue = [{ id: 'prd_suivi', name: 'Produit suivi', slug: 'suivi', prix: 1_000, ventes: 3 }];
    const { agent } = await signInWithPlan(app, 'fiche-deja-suivie@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    // La même boutique, connue de l'index sous son adresse publique.
    await indexStoreCatalog({ externalId: BOUTIQUE, host: 'vitrine-nouvelle.mychariow.com', label: 'Vitrine nouvelle' }, [produit('prd_suivi', 'Produit suivi', 3)], jour(4));

    const suivie = await agent.get('/api/radar/store?host=vitrine-nouvelle.mychariow.com').expect(200);
    assert.equal(suivie.body.watchId, ajout.body.watch.id, 'l’écran ouvrira son catalogue suivi, avec son historique');

    // Jamais relevée, et injoignable sous test : la fiche répond quand même, vide, sans erreur.
    const inconnue = await agent.get('/api/radar/store?host=jamais-vue.mychariow.com').expect(200);
    assert.equal(inconnue.body.products.length, 0);
    assert.equal(inconnue.body.pending, false);
    assert.equal(inconnue.body.unreachable, true, 'l’écran dit que la vitrine ne répond pas, au lieu d’un catalogue « vide »');
    assert.equal(inconnue.body.ads.total, 0);
    assert.deepEqual(inconnue.body.advertised, []);

    // Une boutique d'une autre plateforme : pas de catalogue relevé, mais pas de refus non plus.
    const ailleurs = await agent.get('/api/radar/store?host=boutique.mymaketou.shop').expect(200);
    assert.equal(ailleurs.body.followable, false);
    assert.equal(ailleurs.body.storefront, 'maketou');

    await agent.get('/api/radar/store?host=pas%20une%20adresse').expect(400);
  });
});
