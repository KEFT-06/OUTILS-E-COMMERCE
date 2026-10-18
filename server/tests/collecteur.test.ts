import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Collecteur maison : les annonces lues dans la bibliothèque publique par un navigateur piloté
 * (dossier collecteur/) sont versées par `/api/cron/collecte`.
 *
 * L'enregistrement ci-dessous a la forme EXACTE de ce que rend la bibliothèque (relevé réel du
 * 04/10/2026, valeurs remplacées) : champs en « snake_case », dates en secondes, médias signés.
 */

const SECRET = 'secret-du-planificateur-de-test';
const JOUR = 86_400;
const maintenant = Math.floor(Date.now() / 1000);

const annonce = (overrides: Record<string, unknown> = {}) => ({
  ad_archive_id: '1016806434734594',
  is_active: true,
  start_date: maintenant - 95 * JOUR,
  end_date: maintenant,
  collation_count: 3,
  publisher_platform: ['FACEBOOK', 'INSTAGRAM'],
  page_id: '1319145094611462',
  page_name: 'TechNova 1',
  impressions_with_index: { impressions_text: null, impressions_index: -1 },
  snapshot: {
    link_url: 'https://kpougeet.mychariow.shop/prd_4zo1o033',
    caption: 'kpougeet.mychariow.shop',
    title: 'Promo 24 heures !',
    // Un texte publicitaire réel : des emojis partout, dont un juste à la limite de coupe.
    body: { text: `${'a'.repeat(3_999)}🎬 la suite` },
    images: [],
    videos: [{ video_hd_url: 'https://video-los4-1.xx.fbcdn.net/o1/v/t2/f2/m366/hd.mp4', video_sd_url: 'https://video-los4-1.xx.fbcdn.net/o1/v/t2/f2/m412/sd.mp4', video_preview_image_url: 'https://scontent-los4-1.xx.fbcdn.net/v/t39.35426-6/apercu.jpg' }],
    cards: [],
    page_name: 'TechNova 1',
    page_profile_uri: 'https://www.facebook.com/61594144235750/',
    page_profile_picture_url: 'https://scontent-los4-1.xx.fbcdn.net/v/t39/photo.jpg',
    cta_text: 'En savoir plus',
    display_format: 'VIDEO',
    link_description: null,
  },
  ...overrides,
});

let app: Express;

before(async () => {
  app = await createTestApp({ CRON_SECRET: SECRET });
});
after(async () => {
  await closeTestApp();
});

const verser = (body: Record<string, unknown>) => request(app).post('/api/cron/collecte').set('Authorization', `Bearer ${SECRET}`).send(body);

describe('Collecteur maison', () => {
  it('refuse tout versement sans le secret du planificateur', async () => {
    await request(app).post('/api/cron/collecte').send({ items: [annonce()] }).expect(401);
    await request(app).get('/api/cron/collecte').expect(401);
  });

  it('ne laisse jamais une moitié d’emoji dans un texte coupé', async () => {
    const { clip } = await import('@server/services/espionnage/parse');
    assert.equal(clip('ab🎬cd', 3), 'ab', 'l’emoji coupé en deux est retiré, pas laissé orphelin');
    assert.equal(clip('ab🎬cd', 4), 'ab🎬');
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(clip(`${'a'.repeat(9)}🎬`, 10))));
  });

  it('range sur le mur une annonce lue dans la bibliothèque, avec son pays et son fichier d’origine', async () => {
    const versement = await verser({ country: 'CM', items: [annonce()] }).expect(200);
    assert.equal(versement.body.adsExamined, 1);
    assert.equal(versement.body.adsKept, 1, 'elle mène à une boutique de la plateforme');
    assert.equal(versement.body.storesNew, 1);
    assert.equal(versement.body.adsNew, 1, 'jamais vue sur le mur');

    const { agent } = await signInWithPlan(app, 'collecteur@exemple.test', 'pro');
    const mur = await agent.get('/api/espionnage').query({ country: 'CM' }).expect(200);
    const lue = mur.body.ads.find((ad: { externalId: string }) => ad.externalId === '1016806434734594');
    assert.ok(lue, 'l’annonce est sur le mur, filtrable par pays');
    assert.equal(lue.storeHost, 'kpougeet.mychariow.com', 'boutique reconnue dans le lien, ramenée à sa forme en .com');
    assert.equal(lue.advertiser, 'TechNova 1');
    assert.equal(lue.mediaKind, 'video');
    // À lire sur le mur : la définition légère, pas le fichier d'origine cinq à dix fois plus lourd.
    assert.equal(lue.videoUrl, 'https://video-los4-1.xx.fbcdn.net/o1/v/t2/f2/m412/sd.mp4');
    assert.deepEqual(lue.countries, ['CM']);
    assert.equal(lue.downloadable, true);
    assert.equal(lue.variants, 3);
    assert.ok(lue.runningDays >= 94, 'la date de début, en secondes, est bien lue');
    assert.deepEqual(mur.body.countries, ['CM']);

    // Le même relevé dans un second pays : les pays s'ajoutent, l'annonce ne se dédouble pas.
    const encore = await verser({ country: 'CI', items: [annonce()] }).expect(200);
    assert.equal(encore.body.adsNew, 0, 'déjà sur le mur : relue, pas nouvelle');
    const apres = await agent.get('/api/espionnage').expect(200);
    const memes = apres.body.ads.filter((ad: { externalId: string }) => ad.externalId === '1016806434734594');
    assert.equal(memes.length, 1);
    assert.deepEqual(memes[0].countries, ['CI', 'CM']);
  });

  it('demande au collecteur de contrôler une annonce installée pas revue, puis signale son arrêt', async () => {
    const { getDb } = await import('@server/db/client');
    const { spiedAds } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    // Trois jours sans la revoir : elle entre dans le plan de contrôle.
    await getDb().update(spiedAds).set({ lastSeenAt: new Date(Date.now() - 3 * JOUR * 1000) }).where(eq(spiedAds.externalId, '1016806434734594'));

    const plan = await request(app).get('/api/cron/collecte').set('Authorization', `Bearer ${SECRET}`).expect(200);
    assert.ok(plan.body.queries.length >= 1);
    assert.ok(plan.body.countries.includes('CM'));
    assert.deepEqual(plan.body.toVerify, ['1016806434734594'], 'en cours depuis 95 jours, pas revue depuis 3');
    assert.ok(plan.body.advertisers.includes('1319145094611462'), 'l’annonceur du mur est remis au collecteur, pour lire toute sa page');
    assert.equal(new Set(plan.body.advertisers).size, plan.body.advertisers.length, 'chaque annonceur une fois');

    // Le contrôle la trouve arrêtée : dernier lot du passage, les alertes sont recalculées.
    const controle = await verser({ country: 'ALL', items: [annonce({ is_active: false })], done: true, summary: { lues: 1 } }).expect(200);
    assert.equal(controle.body.alertes, 1, 'une publicité installée vient d’être arrêtée');

    const { agent } = await signInWithPlan(app, 'collecteur-alerte@exemple.test', 'pro');
    const fil = await agent.get('/api/alerts').expect(200);
    const arret = fil.body.alerts.find((alerte: { kind: string }) => alerte.kind === 'ad_stopped');
    assert.match(arret.body, /TechNova 1.*9\d jours.*désactivée/);
    assert.equal(arret.payload.storeHost, 'kpougeet.mychariow.com');

    // Le passage est inscrit au journal : la collecte payante n'est plus due.
    const { discoveryIsDue } = await import('@server/services/radar/discovery');
    const { lastDiscoveryAt } = await import('@server/services/radar/discovery');
    assert.ok((await lastDiscoveryAt()) !== null);
    assert.equal(await discoveryIsDue(), false);
  });

  it('remet d’abord les annonceurs jamais lus, et ne remet pas une page lue depuis moins de quinze jours', async () => {
    const { getDb } = await import('@server/db/client');
    const { spiedAds, spiedPages } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const plan = async () => (await request(app).get('/api/cron/collecte').set('Authorization', `Bearer ${SECRET}`).expect(200)).body.advertisers as string[];

    // Deux annonceurs jamais lus : l'un vu à l'instant, l'autre pas revu depuis dix jours (il ne diffuse sans doute plus).
    const actif = annonce({ ad_archive_id: '3001', page_id: '5550001' });
    const eteint = annonce({ ad_archive_id: '3002', page_id: '5550002' });
    await verser({ country: 'CM', items: [actif, eteint] }).expect(200);
    await getDb().update(spiedAds).set({ lastSeenAt: new Date(Date.now() - 10 * JOUR * 1000) }).where(eq(spiedAds.externalId, '3002'));
    let annonceurs = await plan();
    assert.ok(annonceurs.indexOf('5550001') < annonceurs.indexOf('5550002'), 'le plus récemment vu d’abord : sa page a des annonces à montrer');

    // Sa page est lue en entier : elle sort du plan (le 18/10/2026, un passage relisait les pages qu’il venait de lire).
    await verser({ country: 'ALL', items: [actif], page: { id: '5550001', ads: 1 } }).expect(200);
    annonceurs = await plan();
    assert.ok(!annonceurs.includes('5550001'), 'lue à l’instant : pas remise');
    assert.ok(annonceurs.includes('5550002'));

    // Seize jours plus tard, elle revient — après les pages jamais lues, même moins récemment vues.
    await getDb().update(spiedPages).set({ readAt: new Date(Date.now() - 16 * JOUR * 1000) }).where(eq(spiedPages.pageId, '5550001'));
    annonceurs = await plan();
    assert.ok(annonceurs.includes('5550001'));
    assert.ok(annonceurs.indexOf('5550002') < annonceurs.indexOf('5550001'), 'les pages jamais lues passent avant une page relue');

    // Une page refusée en forme ne s'enregistre pas.
    await verser({ country: 'ALL', items: [], page: { id: 'pas-un-numero', ads: 0 } }).expect(400);

    // Le mur retrouve son état : les tests suivants comptent ses annonces par plateforme.
    const { inArray } = await import('drizzle-orm');
    await getDb().delete(spiedAds).where(inArray(spiedAds.externalId, ['3001', '3002']));
    await getDb().delete(spiedPages).where(eq(spiedPages.pageId, '5550001'));
  });

  it('la migration 0050 marque lues les seules pages lues dans la fenêtre du 18/10/2026', async () => {
    const { readFileSync } = await import('node:fs');
    const { getDb } = await import('@server/db/client');
    const { spiedAds, spiedPages } = await import('@server/db/schema');
    const { eq, inArray, sql } = await import('drizzle-orm');
    const pendant = annonce({ ad_archive_id: '4001', page_id: '6660001' });
    const avant = annonce({ ad_archive_id: '4002', page_id: '6660002' });
    await verser({ country: 'CM', items: [pendant, avant] }).expect(200);
    await getDb().update(spiedAds).set({ lastSeenAt: new Date('2026-10-18T02:40:00Z') }).where(eq(spiedAds.externalId, '4001'));
    await getDb().update(spiedAds).set({ lastSeenAt: new Date('2026-10-17T23:10:00Z') }).where(eq(spiedAds.externalId, '4002'));

    const migration = readFileSync(new URL('../db/migrations/0050_pages_lues_avant_suivi.sql', import.meta.url), 'utf8');
    await getDb().execute(sql.raw(migration));
    const lues = await getDb().select({ pageId: spiedPages.pageId }).from(spiedPages).where(inArray(spiedPages.pageId, ['6660001', '6660002']));
    assert.deepEqual(lues.map((page) => page.pageId), ['6660001'], 'lue pendant le passage : marquée ; vue la veille : non');
    // Rejouée, elle ne change rien.
    await getDb().execute(sql.raw(migration));

    await getDb().delete(spiedAds).where(inArray(spiedAds.externalId, ['4001', '4002']));
    await getDb().delete(spiedPages).where(eq(spiedPages.pageId, '6660001'));
  });

  /*
    Relevé réel du 04/10/2026, 717 annonces cherchées au Cameroun, en Côte d'Ivoire et au
    Sénégal : 357 mènent à « *.myshopify.com », 335 à « *.mymaketou.shop » ou « .store ». Le mur
    ne gardait que Chariow.
  */
  it('reconnaît les boutiques Maketou et Shopify, sans les confier au Radar', async () => {
    const { findStorefront, followableOnRadar, storefrontOfHost } = await import('@server/shared/storefronts');
    assert.deepEqual(findStorefront('https://awa-shop.mymaketou.shop/p/guide'), { host: 'awa-shop.mymaketou.shop', storefront: 'maketou' });
    assert.deepEqual(findStorefront('AWA.MYMAKETOU.STORE'), { host: 'awa.mymaketou.store', storefront: 'maketou' }, 'l’extension Maketou est gardée');
    assert.deepEqual(findStorefront('https://q1x-9z.myshopify.com/products/x'), { host: 'q1x-9z.myshopify.com', storefront: 'shopify' });
    assert.deepEqual(findStorefront('https://kpougeet.mychariow.shop/prd_1'), { host: 'kpougeet.mychariow.com', storefront: 'chariow' });
    assert.equal(findStorefront('https://www.myshopify.com/ et https://exemple.com'), null, 'ni sous-domaine technique, ni site quelconque');
    assert.equal(storefrontOfHost('awa.mymaketou.store'), 'maketou');
    assert.equal(followableOnRadar('awa.mymaketou.shop'), false);
    assert.equal(followableOnRadar('kpougeet.mychariow.com'), true);

    const maketou = annonce({
      ad_archive_id: '2000000000000001',
      page_name: 'Boutique Awa',
      snapshot: { ...annonce().snapshot, link_url: 'https://awa-shop.mymaketou.shop/p/guide', caption: 'awa-shop.mymaketou.shop', page_name: 'Boutique Awa' },
    });
    // Annonce à plusieurs cartes : aucun lien à la racine, la destination est dans les cartes.
    const shopify = annonce({
      ad_archive_id: '2000000000000002',
      page_name: 'Mode Dakar',
      snapshot: {
        ...annonce().snapshot,
        link_url: null,
        caption: null,
        page_name: 'Mode Dakar',
        cards: [
          { title: 'Robe', body: 'Wax', link_url: 'https://q1x-9z.myshopify.com/products/robe', cta_text: 'Acheter' },
          { title: 'Sac', body: 'Cuir', link_url: 'https://q1x-9z.myshopify.com/products/sac', cta_text: 'Acheter' },
        ],
      },
    });
    const versement = await verser({ country: 'SN', items: [maketou, shopify] }).expect(200);
    assert.equal(versement.body.adsKept, 2, 'les deux sont rangées sur le mur');
    assert.equal(versement.body.storesNew, 0, 'le Radar ne relève que Chariow : aucune boutique ne lui est confiée');

    const { agent } = await signInWithPlan(app, 'collecteur-plateformes@exemple.test', 'pro');
    const mur = await agent.get('/api/espionnage').expect(200);
    assert.deepEqual(
      (mur.body.storefronts as { id: string; ads: number }[]).map((entry) => `${entry.id}:${entry.ads}`),
      ['chariow:1', 'maketou:1', 'shopify:1'],
      'le filtre ne propose que les plateformes présentes, avec leur compte',
    );
    // Le compte suit les autres réglages : l'annonce Chariow est arrêtée, elle ne compte pas parmi celles « en cours ».
    const enCours = await agent.get('/api/espionnage').query({ etat: 'active' }).expect(200);
    assert.deepEqual(
      (enCours.body.storefronts as { id: string; ads: number }[]).map((entry) => `${entry.id}:${entry.ads}`),
      ['maketou:1', 'shopify:1'],
    );
    const surMaketou = await agent.get('/api/espionnage').query({ storefront: 'maketou' }).expect(200);
    assert.deepEqual((surMaketou.body.ads as { storeHost: string }[]).map((ad) => ad.storeHost), ['awa-shop.mymaketou.shop']);
    const surShopify = await agent.get('/api/espionnage').query({ storefront: 'shopify' }).expect(200);
    const [robe] = surShopify.body.ads as { storeHost: string; landingUrl: string; countries: string[] }[];
    assert.equal(robe!.storeHost, 'q1x-9z.myshopify.com');
    assert.equal(robe!.landingUrl, 'https://q1x-9z.myshopify.com/products/robe', 'le lien de la première carte tient lieu de destination');
    assert.deepEqual(robe!.countries, ['SN']);
    const surChariow = await agent.get('/api/espionnage').query({ storefront: 'chariow' }).expect(200);
    assert.ok((surChariow.body.ads as { storeHost: string }[]).every((ad) => ad.storeHost.endsWith('.mychariow.com')));
    // Une plateforme inconnue n'est pas une erreur à afficher : le mur est servi sans ce filtre.
    const inconnue = await agent.get('/api/espionnage').query({ storefront: 'amazon' }).expect(200);
    assert.equal(inconnue.body.matching, mur.body.total);

    // Le plan du collecteur cherche ces plateformes pays par pays, jamais tous pays confondus.
    const plan = await request(app).get('/api/cron/collecte').set('Authorization', `Bearer ${SECRET}`).expect(200);
    assert.deepEqual(plan.body.extra.queries, ['mymaketou', 'myshopify']);
    assert.ok(plan.body.extra.countries.includes('SN') && !plan.body.extra.countries.includes('ALL'));
    assert.ok(plan.body.extra.maxPerQuery < plan.body.maxPerQuery, 'plafond plus bas que pour la plateforme principale');
  });

  it('n’affiche pas sur le mur un titre de catalogue resté vide', async () => {
    const base = annonce();
    await verser({
      country: 'CM',
      items: [{ ...base, ad_archive_id: '2020202020', snapshot: { ...base.snapshot, title: '{{product.name}}', body: { text: 'Livraison rapide {{product.brand}} partout au pays.' }, link_description: '{{product.description}}' } }],
    }).expect(200);
    const { agent } = await signInWithPlan(app, 'mur-gabarit@exemple.test', 'pro');
    const mur = await agent.get('/api/espionnage').expect(200);
    const lue = mur.body.ads.find((ad: { externalId: string }) => ad.externalId === '2020202020') as { title: string | null; bodyText: string | null; linkDescription: string | null };
    assert.ok(lue, 'l’annonce est sur le mur');
    assert.deepEqual([lue.title, lue.bodyText, lue.linkDescription], [null, 'Livraison rapide partout au pays.', null]);
  });

  it('écarte un lot illisible sans rien enregistrer', async () => {
    await verser({ country: 'Cameroun', items: [] }).expect(400);
    await verser({ items: 'pas une liste' }).expect(400);
  });
});
