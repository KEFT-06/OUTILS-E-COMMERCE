import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createAdmin, createTestApp } from './support/helpers';

/**
 * Collecte du mur d'espionnage, contre un faux Apify, un faux Supabase et un faux serveur
 * d'images. Les annonces reprennent la forme d'un vrai lot relevé le 27/09/2026 (30 annonces).
 *
 * Ce que ces tests verrouillent, et qui manquait au mur :
 *  1. les boutiques en .store, .online et .market — onze annonces sur trente du vrai lot
 *     étaient jetées faute de reconnaître l'extension ;
 *  2. un passage LANCÉ puis récolté plus tard : attendre sa fin coupait la requête, et le
 *     passage payé était perdu ;
 *  3. les annonceurs connus relevés page par page, dans la limite facturée ;
 *  4. l'aperçu conservé chez nous : les adresses de Meta expirent en quelques jours ;
 *  5. ce qu'il faut pour une page « comme celle de Meta » : bouton, légende, variantes.
 */

const JOUR = 86_400;
const IMAGE = Buffer.from('ffd8ffe000104a46494600', 'hex');
/** Peu importe le contenu : le relais passe des octets, il ne lit pas la vidéo. */
const VIDEO = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');
const CLE = 'sb_secret_cle_de_test_0000000000';

let base = '';
const lancements: { startUrls: { url: string }[]; resultsLimit: number }[] = [];
const lots = new Map<string, unknown[]>();
/** Passages que le faux Apify dit encore en cours. */
const enCours = new Set<string>();
const objets = new Map<string, Buffer>();

const annonce = (id: string, lien: string, extra: Record<string, unknown> = {}) => ({
  inputUrl: 'https://www.facebook.com/ads/library/?q=mychariow',
  adArchiveID: id,
  pageID: '436342699565102',
  pageName: 'Homme Responsable',
  startDate: Math.floor(Date.now() / 1000) - 40 * JOUR,
  isActive: true,
  collationCount: 1,
  publisherPlatform: ['FACEBOOK', 'INSTAGRAM'],
  snapshot: {
    linkUrl: lien,
    caption: new URL(lien).hostname.toUpperCase(),
    title: `Titre ${id}`,
    body: { text: `Texte de l’annonce ${id}` },
    ctaText: 'Learn more',
    displayFormat: 'IMAGE',
    linkDescription: 'Le guide complet',
    pageProfileUri: 'https://www.facebook.com/HommeResponsable/',
    images: [{ resizedImageUrl: `${base}/images/${id}.jpg`, originalImageUrl: `${base}/images/${id}-grand.jpg` }],
    videos: [],
    cards: [],
    ...extra,
  },
});

const faux = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://faux.test');
    const corps = Buffer.concat(chunks);
    const json = (code: number, contenu: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(contenu));
    };

    // ——— Faux Apify ———
    if (req.method === 'POST' && url.pathname === '/acts/apify~facebook-ads-scraper/runs') {
      const entree = JSON.parse(corps.toString('utf8')) as { startUrls: { url: string }[]; resultsLimit: number };
      lancements.push(entree);
      const n = lancements.length;
      const pages = entree.startUrls.some((depart) => depart.url.includes('view_all_page_id='));
      lots.set(
        `lot-${n}`,
        pages
          ? [annonce('9001', 'https://tgkurxbj.mychariow.store/nouveau'), annonce('9002', 'https://exemple.com/hors-plateforme')]
          : [
              annonce('1001', 'https://tgkurxbj.mychariow.store/guerre'),
              annonce('1002', 'https://cldyszdx.mychariow.online/excel'),
              annonce('1003', 'https://medflash.mychariow.market/qcm', {
                displayFormat: 'DCO',
                images: [],
                // Création dynamique : le visuel et les variantes sont dans les cartes.
                cards: [
                  { title: 'Variante A', body: 'Accroche A', linkUrl: 'https://medflash.mychariow.market/qcm', ctaText: 'Download', resizedImageUrl: `${base}/images/1003.jpg` },
                  { title: 'Variante B', body: 'Accroche B', linkUrl: 'https://medflash.mychariow.market/qcm', ctaText: 'Download', resizedImageUrl: `${base}/images/1003b.jpg` },
                ],
                linkDescription: '{{product.description}}',
              }),
              annonce('1004', 'https://toutlivres.mychariow.shop/livre'),
            ],
      );
      return json(201, { data: { id: `passage-${n}`, defaultDatasetId: `lot-${n}`, status: 'RUNNING' } });
    }
    const suivi = /^\/actor-runs\/(passage-\d+)$/.exec(url.pathname);
    if (req.method === 'GET' && suivi) return json(200, { data: { status: enCours.has(suivi[1]!) ? 'RUNNING' : 'SUCCEEDED' } });
    const lot = /^\/datasets\/(lot-\d+)\/items$/.exec(url.pathname);
    if (req.method === 'GET' && lot) return json(200, lots.get(lot[1]!) ?? []);

    // ——— Faux serveur d'images de Meta ———
    if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(IMAGE.length) });
      res.end(IMAGE);
      return;
    }

    // ——— Faux serveur vidéo de Meta : sert des morceaux, et refuse une adresse périmée ———
    if (req.method === 'GET' && url.pathname === '/videos/perimee.mp4') return json(403, { error: 'URL signature expired' });
    if (req.method === 'GET' && url.pathname.startsWith('/videos/')) {
      const morceau = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
      if (!morceau) {
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(VIDEO.length), 'accept-ranges': 'bytes' });
        res.end(VIDEO);
        return;
      }
      const debut = Number(morceau[1]);
      const fin = morceau[2] ? Number(morceau[2]) : VIDEO.length - 1;
      res.writeHead(206, {
        'content-type': 'video/mp4',
        'content-length': String(fin - debut + 1),
        'content-range': `bytes ${debut}-${fin}/${VIDEO.length}`,
      });
      res.end(VIDEO.subarray(debut, fin + 1));
      return;
    }

    // ——— Faux Supabase Storage ———
    if (url.pathname.startsWith('/storage/v1/')) {
      if (req.headers.authorization !== `Bearer ${CLE}`) return json(401, { message: 'Unauthorized' });
      if (req.method === 'POST' && url.pathname === '/storage/v1/bucket') return json(200, { name: 'espionnage' });
      const depot = /^\/storage\/v1\/object\/espionnage\/(.+)$/.exec(url.pathname);
      if (req.method === 'POST' && depot) {
        objets.set(depot[1]!, corps);
        return json(200, { Key: `espionnage/${depot[1]!}` });
      }
      const lecture = /^\/storage\/v1\/object\/authenticated\/espionnage\/(.+)$/.exec(url.pathname);
      if (req.method === 'GET' && lecture) {
        const objet = objets.get(lecture[1]!);
        if (!objet) return json(404, { message: 'Object not found' });
        res.writeHead(200, { 'content-type': 'image/jpeg' });
        res.end(objet);
        return;
      }
      if (req.method === 'DELETE' && url.pathname === '/storage/v1/object/espionnage') {
        for (const chemin of (JSON.parse(corps.toString('utf8')) as { prefixes: string[] }).prefixes) objets.delete(chemin);
        return json(200, []);
      }
    }
    json(404, { detail: 'Not Found' });
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(faux.address() as AddressInfo).port}`;
  app = await createTestApp({
    APIFY_TOKEN: 'jeton-apify-de-test',
    APIFY_API_URL: base,
    APIFY_ADS_ACTOR: 'apify~facebook-ads-scraper',
    RADAR_DISCOVERY_LIMIT: '250',
    RADAR_DISCOVERY_QUERY: 'mychariow, chariow',
    SPY_PAGES_MAX: '25',
    SPY_PAGE_ADS_LIMIT: '12',
    SUPABASE_API_SECRET_KEY: CLE,
    SUPABASE_URL: base,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => faux.close(() => r()));
});

type Ad = {
  id: string;
  externalId: string;
  storeHost: string;
  pageId: string | null;
  pageUrl: string | null;
  ctaText: string | null;
  displayFormat: string | null;
  linkCaption: string | null;
  linkDescription: string | null;
  cards: { title: string | null }[];
  thumbnailUrl: string | null;
};

describe('Mur d’espionnage — collecte', () => {
  it('garde les boutiques de toutes les extensions, avec ce qu’il faut pour une page façon Meta', async () => {
    const { agent: admin } = await createAdmin(app, 'collecte-admin@exemple.test');
    const collecte = await admin.post('/api/radar/discover/refresh').expect(200);

    // Premier passage : aucun annonceur connu, donc une seule recherche, sur les deux mots-clés.
    assert.equal(lancements.length, 1);
    assert.deepEqual(
      lancements[0]!.startUrls.map((depart) => new URL(depart.url).searchParams.get('q')),
      ['mychariow', 'chariow'],
    );
    assert.equal(lancements[0]!.resultsLimit, 250, 'plafond facturé par mot-clé');
    assert.equal(collecte.body.outcome.adsKept, 4, '.store, .online, .market et .shop sont tous gardés');

    const { agent } = await signInWithPlan(app, 'collecte-lecteur@exemple.test', 'pro');
    const mur = (await agent.get('/api/espionnage').expect(200)).body as { ads: Ad[]; collecting: boolean };
    const hotes = mur.ads.map((ad) => ad.storeHost).sort();
    assert.deepEqual(hotes, ['cldyszdx.mychariow.com', 'medflash.mychariow.com', 'tgkurxbj.mychariow.com', 'toutlivres.mychariow.com']);
    assert.equal(mur.collecting, false);

    const dco = mur.ads.find((ad) => ad.externalId === '1003')!;
    assert.equal(dco.displayFormat, 'DCO');
    assert.deepEqual(dco.cards.map((carte) => carte.title), ['Variante A', 'Variante B'], 'les variantes sont gardées');
    assert.equal(dco.linkDescription, null, 'un gabarit non rempli de Meta n’est pas affiché');

    const simple = mur.ads.find((ad) => ad.externalId === '1001')!;
    assert.equal(simple.ctaText, 'Learn more');
    assert.equal(simple.linkCaption, 'TGKURXBJ.MYCHARIOW.STORE');
    assert.equal(simple.pageId, '436342699565102');
    assert.equal(simple.pageUrl, 'https://www.facebook.com/HommeResponsable/');

    // « Toutes les annonces de cet annonceur ».
    const page = (await agent.get('/api/espionnage?pageId=436342699565102').expect(200)).body as { ads: Ad[] };
    assert.equal(page.ads.length, 4);
  });

  it('relève en entier les annonceurs connus, et récolte plus tard un passage encore en cours', async () => {
    const { agent: admin } = await createAdmin(app, 'collecte-admin-2@exemple.test');
    const avant = lancements.length;
    // Le passage « pages » restera en cours : il ne doit pas être perdu.
    enCours.add(`passage-${avant + 2}`);

    const collecte = await admin.post('/api/radar/discover/refresh').timeout(120_000).expect(200);
    assert.equal(lancements.length, avant + 2, 'mots-clés, puis annonceurs');
    const pages = lancements.at(-1)!;
    assert.equal(pages.resultsLimit, 12, 'plafond facturé par annonceur');
    assert.match(pages.startUrls[0]!.url, /view_all_page_id=436342699565102/);
    assert.equal(collecte.body.outcome.pending, 1, 'le passage en cours est annoncé, pas abandonné');

    const { agent } = await signInWithPlan(app, 'collecte-lecteur-2@exemple.test', 'pro');
    const pendant = (await agent.get('/api/espionnage').expect(200)).body as { ads: Ad[]; collecting: boolean };
    assert.equal(pendant.collecting, true, 'l’écran peut dire que des annonces arrivent');
    assert.ok(!pendant.ads.some((ad) => ad.externalId === '9001'));

    // Le passage se termine chez Apify : la récolte suivante le verse au mur.
    enCours.clear();
    const { harvestCollectionRuns } = await import('@server/services/radar/discovery');
    const recolte = await harvestCollectionRuns();
    assert.equal(recolte.adsKept, 1, 'l’annonce hors plateforme de l’annonceur est écartée');
    assert.equal(recolte.pending, 0);
    const apres = (await agent.get('/api/espionnage').expect(200)).body as { ads: Ad[] };
    assert.ok(apres.ads.some((ad) => ad.externalId === '9001'));
  });

  it('conserve l’aperçu, le sert en cache public, et l’efface trente jours après la dernière vue', async () => {
    const { storeMissingThumbnails, purgeStaleThumbnails } = await import('@server/services/espionnage/media');
    // Le mur copie déjà les aperçus en arrière-plan à chaque consultation : cet appel termine le reste.
    const resultat = await storeMissingThumbnails(50);
    assert.equal(resultat.failed, 0);

    const { agent } = await signInWithPlan(app, 'collecte-apercu@exemple.test', 'pro');
    const mur = (await agent.get('/api/espionnage').expect(200)).body as { ads: Ad[] };
    assert.ok(mur.ads.length >= 5);
    assert.ok(mur.ads.every((ad) => ad.thumbnailUrl), 'chaque annonce a son aperçu conservé, qui ne périme pas');
    const avecApercu = mur.ads.find((ad) => ad.externalId === '1001')!;
    assert.equal(avecApercu.thumbnailUrl, `/api/espionnage/media/${avecApercu.id}`);

    // Servi sans session : ce sont des publicités publiques, mises en cache par l'hébergeur.
    const { default: request } = await import('supertest');
    const image = await request(app).get(avecApercu.thumbnailUrl!).buffer(true).expect(200);
    assert.deepEqual(Buffer.from(image.body as Buffer), IMAGE);
    assert.match(String(image.headers['cache-control']), /public/);

    // Annonce plus vue depuis trente et un jours : son aperçu est effacé.
    const { getDb } = await import('@server/db/client');
    const { spiedAds } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    await getDb().update(spiedAds).set({ lastSeenAt: new Date(Date.now() - 31 * JOUR * 1000) }).where(eq(spiedAds.externalId, '1001'));
    const { purged } = await purgeStaleThumbnails();
    assert.equal(purged, 1);
    await request(app).get(avecApercu.thumbnailUrl!).expect(404);
  });

  it('donne une vidéo à lire sur le mur : son adresse chez Meta, et un relais qui sert les morceaux demandés', async () => {
    const { getDb } = await import('@server/db/client');
    const { spiedAds } = await import('@server/db/schema');
    const { inArray } = await import('drizzle-orm');
    const commun = { landingUrl: 'https://boutique-video.mychariow.com/p/offre', title: 'Clip du mur', variants: 1, platforms: ['FACEBOOK'], active: true, mediaKind: 'video' };
    const chezMeta = 'https://video.fdla1-1.fna.fbcdn.net/v/t42.1790-2/clip.mp4?oh=abc&oe=123';
    const legere = 'https://video.fdla1-1.fna.fbcdn.net/v/t42.1790-2/clip-leger.mp4?oh=abc&oe=123';
    const lignes = await getDb()
      .insert(spiedAds)
      .values([
        { ...commun, externalId: 'video-lisible', storeHost: 'boutique-video.mychariow.com', downloadUrl: `${base}/videos/clip.mp4` },
        { ...commun, externalId: 'video-perimee', storeHost: 'boutique-video.mychariow.com', downloadUrl: `${base}/videos/perimee.mp4` },
        { ...commun, externalId: 'video-meta', storeHost: 'autre-boutique.myshopify.com', downloadUrl: chezMeta },
        { ...commun, externalId: 'video-legere', storeHost: 'autre-boutique.myshopify.com', downloadUrl: chezMeta, playUrl: legere },
      ])
      .returning({ id: spiedAds.id, externalId: spiedAds.externalId });
    const idDe = (externalId: string) => lignes.find((ligne) => ligne.externalId === externalId)!.id;

    try {
      const { agent } = await signInWithPlan(app, 'collecte-video@exemple.test', 'pro');
      // Le mur ne donne à lire qu'une adresse servie par Meta — celle d'une boutique tierce comprise.
      const mur = (await agent.get(`/api/espionnage?search=${encodeURIComponent('Clip du mur')}`).expect(200)).body as { ads: (Ad & { videoUrl: string | null })[] };
      assert.equal(mur.ads.find((ad) => ad.externalId === 'video-meta')?.videoUrl, chezMeta);
      // La définition légère passe devant : c'est elle qui démarre vite sur une connexion mobile.
      assert.equal(mur.ads.find((ad) => ad.externalId === 'video-legere')?.videoUrl, legere);
      assert.equal(mur.ads.find((ad) => ad.externalId === 'video-lisible')?.videoUrl, null);

      // Le relais : la vidéo entière, puis un morceau — sans quoi on ne peut ni avancer, ni lire sur iPhone.
      const entiere = await agent.get(`/api/espionnage/ads/${idDe('video-lisible')}/video`).buffer(true).expect(200);
      assert.deepEqual(Buffer.from(entiere.body as Buffer), VIDEO);
      assert.equal(entiere.headers['content-type'], 'video/mp4');
      assert.equal(entiere.headers['accept-ranges'], 'bytes');
      const morceau = await agent
        .get(`/api/espionnage/ads/${idDe('video-lisible')}/video`)
        .set('Range', 'bytes=4-9')
        .buffer(true)
        .expect(206);
      assert.deepEqual(Buffer.from(morceau.body as Buffer), Buffer.from(VIDEO.subarray(4, 10)));
      assert.equal(morceau.headers['content-range'], `bytes 4-9/${VIDEO.length}`);

      // Adresse périmée chez Meta : le lecteur est prévenu, il renverra à la bibliothèque.
      const perimee = await agent.get(`/api/espionnage/ads/${idDe('video-perimee')}/video`).expect(410);
      assert.equal((perimee.body as { error: { code: string } }).error.code, 'SPY_MEDIA_EXPIRED');
      // Le relais est réservé aux comptes connectés.
      const { default: request } = await import('supertest');
      await request(app).get(`/api/espionnage/ads/${idDe('video-lisible')}/video`).expect(401);
    } finally {
      await getDb().delete(spiedAds).where(inArray(spiedAds.id, lignes.map((ligne) => ligne.id)));
    }
  });
});
