import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createAdmin, createTestApp } from './support/helpers';

/**
 * Mur d'espionnage, contre un faux fournisseur de collecte.
 *
 * Les annonces de ce test reproduisent la forme réelle relevée le 23/09/2026 sur la bibliothèque
 * publicitaire de Meta — y compris ses pièges, qui sont la raison d'être de ces vérifications :
 *
 *  1. `inputUrl` contient le mot-clé cherché dans CHAQUE enregistrement. Chercher la preuve de
 *     redirection dans l'enregistrement entier ferait passer toutes les annonces pour des nôtres.
 *     Seuls `snapshot.linkUrl` et `snapshot.caption` font foi.
 *  2. `startDate` est en SECONDES. Le lire en millisecondes daterait tout de 1970 et l'ancienneté,
 *     qui est l'intérêt même du mur, n'aurait aucun sens.
 *  3. « .shop » et « .com » désignent la même boutique : sans normalisation, la même boutique
 *     apparaîtrait deux fois et ne rejoindrait pas la surveillance du radar.
 *  4. Une seule collecte doit alimenter les DEUX écrans — boutiques repérées et mur — sinon on
 *     paie deux fois la même donnée.
 */

const JOUR = 86_400;
const maintenant = () => Math.floor(Date.now() / 1000);

/** Annonces servies par le faux fournisseur, calquées sur la vraie forme. */
const ANNONCES = [
  {
    // Piège n°1 : le mot-clé est ici, mais cette annonce mène bien à la plateforme.
    inputUrl: 'https://www.facebook.com/ads/library/?q=mychariow',
    adArchiveID: '111',
    startDate: maintenant() - 200 * JOUR,
    isActive: true,
    collationCount: 3,
    publisherPlatform: ['FACEBOOK', 'INSTAGRAM'],
    pageName: 'Éditions Numériques',
    snapshot: {
      linkUrl: 'https://ejygewbm.mychariow.shop/50l',
      caption: 'ejygewbm.mychariow.shop',
      title: 'Les 50 lois de la guerre',
      body: { text: 'Pourquoi certains empires dominent-ils le monde pendant des siècles…' },
      images: [{ originalImageUrl: 'https://scontent.xx.fbcdn.net/image-111.jpg' }],
      videos: [],
      pageName: 'Éditions Numériques',
    },
  },
  {
    inputUrl: 'https://www.facebook.com/ads/library/?q=mychariow',
    adArchiveID: '222',
    startDate: maintenant() - 12 * JOUR,
    isActive: true,
    collationCount: 1,
    publisherPlatform: ['FACEBOOK'],
    pageName: 'Formation Express',
    snapshot: {
      // Piège n°3 : la même boutique, mais en .com cette fois.
      linkUrl: 'https://ejygewbm.mychariow.com/bureautique',
      caption: null,
      title: 'Formation bureautique complète',
      body: { text: 'Maîtrisez Excel en 7 jours.' },
      images: [],
      videos: [{ videoPreviewImageUrl: 'https://scontent.xx.fbcdn.net/apercu-222.jpg' }],
      pageName: 'Formation Express',
    },
  },
  {
    // Celle-ci ne mène PAS à la plateforme : seul `inputUrl` contient le mot-clé. À écarter.
    inputUrl: 'https://www.facebook.com/ads/library/?q=mychariow',
    adArchiveID: '333',
    startDate: maintenant() - 40 * JOUR,
    isActive: true,
    collationCount: 1,
    publisherPlatform: ['FACEBOOK'],
    pageName: 'Boutique Hors Sujet',
    snapshot: {
      linkUrl: 'https://exemple-hors-sujet.com/offre',
      caption: 'exemple-hors-sujet.com',
      title: 'Offre sans rapport',
      body: { text: 'Rien à voir avec la plateforme.' },
      images: [{ originalImageUrl: 'https://scontent.xx.fbcdn.net/image-333.jpg' }],
      videos: [],
      pageName: 'Boutique Hors Sujet',
    },
  },
];

const collectes: Record<string, unknown>[] = [];

const fauxApify = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://faux.test');
    if (req.method === 'POST' && url.pathname.includes('/run-sync-get-dataset-items')) {
      collectes.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(ANNONCES));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Not Found' }));
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((r) => fauxApify.listen(0, '127.0.0.1', r));
  app = await createTestApp({
    APIFY_TOKEN: 'jeton-apify-de-test',
    APIFY_API_URL: `http://127.0.0.1:${(fauxApify.address() as AddressInfo).port}`,
    APIFY_ADS_ACTOR: 'apify~facebook-ads-scraper',
    RADAR_DISCOVERY_LIMIT: '60',
    RADAR_DISCOVERY_QUERY: 'mychariow',
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => fauxApify.close(() => r()));
});

describe('Mur d’espionnage', () => {
  it('ne garde que les annonces qui mènent vraiment à la plateforme, et remplit les deux écrans d’un seul passage', async () => {
    const { agent: admin } = await createAdmin(app, 'espion-admin@exemple.test');
    const avant = collectes.length;

    const collecte = await admin.post('/api/radar/discover/refresh').expect(200);
    assert.equal(collectes.length, avant + 1, 'une seule collecte, pas une par écran');

    // Trois annonces examinées, deux retenues : celle qui ne mène pas à la plateforme est écartée
    // même si `inputUrl` contient le mot-clé.
    assert.equal(collecte.body.outcome.adsExamined, 3);
    assert.equal(collecte.body.outcome.adsKept, 2);
    // Et le même passage a rempli les boutiques repérées.
    assert.ok(collecte.body.outcome.storesFound >= 1, 'le passage alimente aussi les boutiques repérées');

    const { agent } = await signInWithPlan(app, 'espion@exemple.test', 'pro');
    const mur = await agent.get('/api/espionnage').expect(200);
    assert.equal(mur.body.total, 2);
    // Les deux annonces visent la même boutique, en .shop et en .com : une seule après normalisation.
    assert.equal(mur.body.stores, 1, '« .shop » et « .com » sont la même boutique');

    const titres = (mur.body.ads as { title: string }[]).map((ad) => ad.title);
    assert.ok(!titres.includes('Offre sans rapport'), 'l’annonce hors plateforme est écartée');

    const ancienne = (mur.body.ads as { title: string; runningDays: number; storeHost: string; variants: number }[]).find(
      (ad) => ad.title === 'Les 50 lois de la guerre',
    )!;
    // `startDate` est en secondes : lu en millisecondes, l'ancienneté serait absurde.
    assert.ok(ancienne.runningDays >= 199 && ancienne.runningDays <= 201, `ancienneté lue : ${ancienne.runningDays}`);
    assert.equal(ancienne.storeHost, 'ejygewbm.mychariow.com');
    assert.equal(ancienne.variants, 3);
  });

  it('trie les plus anciennes d’abord, et filtre sur l’ancienneté réelle', async () => {
    const { agent } = await signInWithPlan(app, 'espion-tri@exemple.test', 'pro');

    // Par défaut les plus anciennes : ce sont celles qui ont prouvé quelque chose.
    const defaut = await agent.get('/api/espionnage').expect(200);
    assert.equal((defaut.body.ads as { title: string }[])[0]!.title, 'Les 50 lois de la guerre');

    const recentes = await agent.get('/api/espionnage?sort=newest').expect(200);
    assert.equal((recentes.body.ads as { title: string }[])[0]!.title, 'Formation bureautique complète');

    // « 90 jours et plus » : la formation de 12 jours doit disparaître.
    const installees = await agent.get('/api/espionnage?minDays=90').expect(200);
    assert.equal(installees.body.ads.length, 1);
    assert.equal((installees.body.ads as { title: string }[])[0]!.title, 'Les 50 lois de la guerre');

    // Format : l'une est une image, l'autre une vidéo.
    const videos = await agent.get('/api/espionnage?mediaKind=video').expect(200);
    assert.equal(videos.body.ads.length, 1);
    assert.equal((videos.body.ads as { title: string }[])[0]!.title, 'Formation bureautique complète');

    // Recherche libre dans le texte de l'annonce.
    const trouvees = await agent.get('/api/espionnage?search=Excel').expect(200);
    assert.equal(trouvees.body.ads.length, 1);

    // Un filtre invalide ne casse pas l'écran : le mur est servi sans lui.
    const tolerant = await agent.get('/api/espionnage?minDays=beaucoup').expect(200);
    assert.equal(tolerant.body.ads.length, 2);
  });

  /*
    Une annonce arrêtée ne doit pas continuer de vieillir.

    Une collecte ne désactive pas les annonces qu'elle ne retrouve pas — elle n'en ramène
    qu'un nombre plafonné, trié par impressions, donc une absence ne prouve pas un arrêt.
    L'ancienneté se comptait jusqu'à AUJOURD'HUI : une annonce arrêtée le lendemain de sa
    collecte vieillissait donc indéfiniment. Le tri par défaut montrant les plus anciennes
    d'abord, les annonces mortes arrivaient en tête du mur, présentées comme les mieux
    éprouvées — l'inverse exact de ce que ce mur promet.
  */
  it('arrête de compter l’ancienneté d’une annonce le jour où on cesse de la voir', async () => {
    const { getDb } = await import('@server/db/client');
    const { spiedAds } = await import('@server/db/schema');

    const jours = (n: number) => new Date(Date.now() - n * 86_400_000);
    await getDb()
      .insert(spiedAds)
      .values({
        externalId: 'annonce-abandonnee',
        storeHost: 'boutique-morte.mychariow.com',
        landingUrl: 'https://boutique-morte.mychariow.com/p/offre',
        title: 'Offre abandonnée',
        // Lancée il y a 300 jours, mais plus revue depuis 200 : on ne l'a observée en
        // diffusion que pendant les 100 premiers.
        startedAt: jours(300),
        lastSeenAt: jours(200),
        variants: 1,
        platforms: ['FACEBOOK'],
        active: true,
      });

    try {
      const { agent } = await signInWithPlan(app, 'espion-perime@exemple.test', 'pro');
      const vue = await agent.get('/api/espionnage').expect(200);
      const morte = (vue.body.ads as { externalId: string; runningDays: number; daysSinceSeen: number }[]).find(
        (ad) => ad.externalId === 'annonce-abandonnee',
      );

      assert.ok(morte, 'l’annonce est bien sur le mur');
      assert.equal(morte.runningDays, 100, 'on ne compte que ce qu’on a observé, pas ce qu’on suppose');
      assert.ok(morte.daysSinceSeen >= 199, 'et l’écran peut dire depuis quand elle n’a plus été vue');
    } finally {
      // Le mur est partagé par les tests suivants : cette annonce ne doit pas leur rester
      // dans les jambes, sinon on ne saurait plus lequel a écrit quoi.
      const { eq } = await import('drizzle-orm');
      await getDb().delete(spiedAds).where(eq(spiedAds.externalId, 'annonce-abandonnee'));
    }
  });

  it('permet de passer d’une annonce à une surveillance du radar, et reste fermé aux non-membres', async () => {
    const { agent } = await signInWithPlan(app, 'espion-suivi@exemple.test', 'pro');
    const mur = await agent.get('/api/espionnage').expect(200);
    const host = (mur.body.ads as { storeHost: string }[])[0]!.storeHost;

    /*
      Le pont entre les deux modules tient à une seule chose : l'hôte du mur doit être de la forme
      que le résolveur du radar accepte. On le vérifie ici sans appeler la route — un ajout par nom
      d'hôte irait chercher la VRAIE vitrine du tiers, et une suite de tests ne doit solliciter le
      site de personne. La création d'une surveillance est éprouvée dans radar.test.ts, sur une
      vitrine locale.
    */
    assert.match(host, /^[a-z0-9][a-z0-9-]*\.mychariow\.com$/, 'le mur rend un hôte que le radar sait résoudre');

    // Et la barrière de test se vérifie : hors boucle locale, le radar refuse de sortir.
    const refus = await agent.post('/api/radar/watches').send({ target: host }).expect(400);
    assert.equal(refus.body.error.code, 'RADAR_SOURCE_UNSUPPORTED');

    // Le mur n'est pas public.
    const { default: request } = await import('supertest');
    await request(app).get('/api/espionnage').expect(401);
  });
});

describe('Mur d’espionnage — ce que le palier laisse voir', () => {
  it('bride le gratuit sans l’aveugler, et dit combien d’annonces il manque', async () => {
    // Le mur a été rempli par la collecte du premier bloc : deux annonces retenues.
    const { agent: gratuit } = await signInWithPlan(app, 'espion-gratuit@exemple.test', 'free');

    // Le palier Gratuit voit 6 annonces : ici les deux passent, rien n'est caché.
    const large = await gratuit.get('/api/espionnage').expect(200);
    assert.equal(large.body.visibleLimit, 6);
    assert.equal(large.body.hiddenByPlan, 0);
    assert.equal(large.body.ads.length, 2, 'un compte gratuit VOIT le mur : un écran vide ne convainc personne');

    /*
      Une page plus courte parce que l'ÉCRAN en a demandé moins n'est pas un manque imputable
      à l'abonnement. Accuser le palier de ce qu'il n'a pas fait pousse à payer pour rien : on
      souscrit, et rien ne change.
    */
    const serre = await gratuit.get('/api/espionnage?limit=1').expect(200);
    assert.equal(serre.body.ads.length, 1);
    assert.equal(serre.body.hiddenByPlan, 0, 'le palier n’a rien caché : c’est l’écran qui a demandé une seule annonce');

    // Un palier supérieur voit davantage, sans nouvelle collecte : la donnée est déjà là.
    const { agent: pro } = await signInWithPlan(app, 'espion-pro@exemple.test', 'pro');
    const chezPro = await pro.get('/api/espionnage').expect(200);
    assert.equal(chezPro.body.visibleLimit, 100);
    assert.equal(chezPro.body.hiddenByPlan, 0);
  });

  /*
    Le défaut que ce test verrouille coûtait de l'argent aux comptes payants.

    L'écran demandait soixante annonces, en dur. Un palier qui en promet cent n'en servait donc
    que soixante, et affichait à côté « votre palier affiche 100 annonces à la fois » avec
    quarante annonces manquantes. Le plafond venait du code ; la phrase accusait l'abonnement.

    Il faut plus de soixante annonces pour que la différence apparaisse : c'est tout l'objet de
    ce remplissage.
  */
  it('sert au palier tout ce qu’il a payé, au-delà de l’ancienne limite fixe de soixante', async () => {
    const { getDb } = await import('@server/db/client');
    const { spiedAds } = await import('@server/db/schema');

    const debut = new Date(Date.now() - 90 * 86_400_000);
    await getDb()
      .insert(spiedAds)
      .values(
        Array.from({ length: 70 }, (_, rang) => ({
          externalId: `masse-${rang}`,
          storeHost: 'boutique-masse.mychariow.com',
          landingUrl: 'https://boutique-masse.mychariow.com/p/offre',
          title: `Annonce ${rang}`,
          startedAt: debut,
          variants: 1,
          platforms: ['FACEBOOK'],
          active: true,
        })),
      );

    const { agent: pro } = await signInWithPlan(app, 'espion-pro-masse@exemple.test', 'pro');
    const vue = await pro.get('/api/espionnage').expect(200);

    assert.equal(vue.body.visibleLimit, 100);
    assert.ok(vue.body.ads.length > 60, `le palier Pro voit au-delà de soixante (reçu ${vue.body.ads.length})`);
    assert.equal(vue.body.hiddenByPlan, 0, 'rien n’est caché tant que le palier n’est pas atteint');

    // Et le palier Gratuit, lui, est bien borné — et le dit.
    const { agent: gratuit } = await signInWithPlan(app, 'espion-gratuit-masse@exemple.test', 'free');
    const bride = await gratuit.get('/api/espionnage').expect(200);
    assert.equal(bride.body.ads.length, 6, 'le palier Gratuit s’arrête à six');
    assert.ok(bride.body.hiddenByPlan > 60, 'et l’écran peut annoncer tout ce qui manque');
  });
});
