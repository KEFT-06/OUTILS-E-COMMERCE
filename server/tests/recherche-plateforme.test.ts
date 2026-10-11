import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Le nom d'une plateforme désigne ses boutiques, et chaque nombre est celui de la liste.
 *
 * Demande du propriétaire, 11/10/2026, devant les pastilles « maketou 50 · shopify 50 · chariow 50 » :
 * « j'espère que les 50 sont le nombre de publicités réel qu'affiche Espionnage… si je recherche
 * les publicités chariow je dois voir les publicités chariow uniquement et non d'autres publicités
 * d'autres sites ». Constat : cherché comme un mot, « chariow » rendait toute annonce dont le texte
 * le citait, et un compte au palier Gratuit lisait « 50 » sur une recherche qui lui en montrait 6.
 */

const SECRET = 'secret-du-planificateur-de-test';
const JOUR = 86_400;
const maintenant = Math.floor(Date.now() / 1000);

/** Une annonce telle que la bibliothèque la rend (champs en « snake_case »). */
const annonce = (id: string, lien: string, texte: string, jours = 40) => ({
  ad_archive_id: id,
  is_active: true,
  start_date: maintenant - jours * JOUR,
  end_date: maintenant,
  collation_count: 1,
  publisher_platform: ['FACEBOOK'],
  page_id: `77${id}`,
  page_name: `Page ${id}`,
  snapshot: {
    link_url: lien,
    caption: new URL(lien).hostname,
    title: texte,
    body: { text: `${texte} — texte de l’annonce ${id}` },
    images: [{ resized_image_url: `https://scontent.xx.fbcdn.net/${id}.jpg` }],
    videos: [],
    cards: [],
    page_name: `Page ${id}`,
    cta_text: 'En savoir plus',
    display_format: 'IMAGE',
  },
});

let app: Express;
const collecteur = () => ({
  plan: () => request(app).get('/api/cron/collecte').set('Authorization', `Bearer ${SECRET}`),
  verse: (body: Record<string, unknown>) => request(app).post('/api/cron/collecte').set('Authorization', `Bearer ${SECRET}`).send(body),
});

type Search = { id: string; query: string; adsFound: number; storefront: string | null; subject: string | null; hiddenByPlan: number; ads: { externalId: string; storeHost: string | null }[] };
type Overview = { recent: { id: string; query: string; country: string; adsFound: number }[] };

before(async () => {
  // Aucune lecture payante : la recherche répond avec nos relevés, comme en production le 11/10/2026.
  app = await createTestApp({ CRON_SECRET: SECRET, SPY_SEARCH_RESULTS: '50' });
  // Le mur : douze boutiques Chariow (dont une qui vend une formation, et aucune qui écrive « chariow »),
  // trois Maketou — dont une dont le TEXTE cite Chariow —, deux Shopify.
  const chariow = Array.from({ length: 12 }, (_, index) =>
    annonce(`10${String(index).padStart(2, '0')}`, `https://boutique-${index}.mychariow.shop/prd_${index}`, index === 3 ? 'Formation couture pour débutantes' : `Guide pratique numéro ${index}`, 60 - index),
  );
  await collecteur()
    .verse({
      country: 'CM',
      items: [
        ...chariow,
        annonce('2001', 'https://atelier-a.mymaketou.shop/p/1', 'Mieux que Chariow : vendez sans commission'),
        annonce('2002', 'https://atelier-b.mymaketou.shop/p/2', 'Formation pâtisserie maison'),
        annonce('2003', 'https://atelier-c.mymaketou.store/p/3', 'Planner de budget familial'),
        annonce('3001', 'https://mode-dakar.myshopify.com/products/robe', 'Robes en wax, livraison rapide'),
        annonce('3002', 'https://tech-abidjan.myshopify.com/products/casque', 'Casque sans fil'),
      ],
    })
    .expect(200);
});

after(async () => {
  await closeTestApp();
});

describe('ce qu’une recherche demande', () => {
  it('reconnaît le nom d’une plateforme, seul ou avec un sujet, et laisse un mot-clé ordinaire tel quel', async () => {
    const { keywordScope, libraryTermOf } = await import('@server/shared/storefronts');
    for (const mot of ['chariow', 'Chariow', ' MyChariow ', 'chariow.com', 'publicités chariow', 'les pubs sur Chariow']) {
      assert.deepEqual(keywordScope(mot), { storefront: 'chariow', subject: '' }, mot);
    }
    assert.deepEqual(keywordScope('formation chariow'), { storefront: 'chariow', subject: 'formation' });
    assert.deepEqual(keywordScope('Maketou'), { storefront: 'maketou', subject: '' });
    assert.deepEqual(keywordScope('boutiques sur shopify'), { storefront: 'shopify', subject: '' });
    // Un mot qui contient le nom sans l'être, un mot-clé ordinaire : rien ne change.
    assert.deepEqual(keywordScope('chariowa'), { storefront: null, subject: 'chariowa' });
    assert.deepEqual(keywordScope('formation excel'), { storefront: null, subject: 'formation excel' });
    // Dans la bibliothèque, les boutiques d'une plateforme se trouvent par leur adresse.
    assert.equal(libraryTermOf('chariow'), 'mychariow');
    assert.equal(libraryTermOf('formation chariow'), 'mychariow formation');
    assert.equal(libraryTermOf('formation excel'), 'formation excel');
  });
});

describe('Espionnage — le nom d’une plateforme désigne ses boutiques', () => {
  it('« chariow » rend les boutiques Chariow et elles seules, et son nombre est celui de la liste', async () => {
    const { agent } = await signInWithPlan(app, 'proprietaire@exemple.test', 'elite');
    const recherche = (await agent.post('/api/espionnage/searches').send({ query: 'chariow' }).expect(202)).body.search as Search;

    assert.equal(recherche.storefront, 'chariow');
    assert.equal(recherche.ads.length, 12, 'les douze boutiques Chariow du mur, qu’elles écrivent « chariow » ou non');
    assert.ok(
      recherche.ads.every((ad) => /\.mychariow\.com$/.test(ad.storeHost ?? '')),
      `aucune annonce d’un autre site : ${recherche.ads.map((ad) => ad.storeHost).join(', ')}`,
    );
    assert.ok(!recherche.ads.some((ad) => ad.externalId === '2001'), 'l’annonce Maketou dont le texte cite Chariow n’est pas une publicité Chariow');
    assert.equal(recherche.adsFound, recherche.ads.length, 'le nombre annoncé est celui de la liste');

    const pastilles = ((await agent.get('/api/espionnage/searches').expect(200)).body as Overview).recent;
    assert.deepEqual(pastilles.map((p) => [p.query, p.adsFound]), [['chariow', 12]], 'la pastille dit ce que la recherche montre');
  });

  it('« maketou », « shopify » : chacune ses boutiques ; « formation chariow » : ce sujet, sur Chariow seulement', async () => {
    const { agent } = await signInWithPlan(app, 'curieuse@exemple.test', 'elite');
    const maketou = (await agent.post('/api/espionnage/searches').send({ query: 'Maketou' }).expect(202)).body.search as Search;
    assert.deepEqual(maketou.ads.map((ad) => ad.externalId).sort(), ['2001', '2002', '2003']);
    assert.equal(maketou.adsFound, 3);

    const shopify = (await agent.post('/api/espionnage/searches').send({ query: 'shopify' }).expect(202)).body.search as Search;
    assert.deepEqual(shopify.ads.map((ad) => ad.externalId).sort(), ['3001', '3002']);

    const sujet = (await agent.post('/api/espionnage/searches').send({ query: 'formation chariow' }).expect(202)).body.search as Search;
    assert.deepEqual([sujet.storefront, sujet.subject], ['chariow', 'formation']);
    assert.deepEqual(sujet.ads.map((ad) => ad.externalId), ['1003'], 'la formation vendue sur Chariow — pas celle de Maketou');

    // Un mot-clé ordinaire reste un mot-clé : toutes les plateformes qui l'emploient.
    const mot = (await agent.post('/api/espionnage/searches').send({ query: 'formation' }).expect(202)).body.search as Search;
    assert.equal(mot.storefront, null);
    assert.deepEqual(mot.ads.map((ad) => ad.externalId).sort(), ['1003', '2002']);
  });

  it('le collecteur cherche l’adresse des boutiques, et ce qu’il rapporte d’ailleurs n’entre pas dans la liste', async () => {
    const { agent } = await signInWithPlan(app, 'veilleur@exemple.test', 'elite');
    const recherche = (await agent.post('/api/espionnage/searches').send({ query: 'chariow', country: 'CI' }).expect(202)).body.search as Search;
    assert.equal(recherche.ads.length, 0, 'rien de relevé en Côte d’Ivoire pour l’instant');

    const plan = (await collecteur().plan().expect(200)).body as { searches: { id: string; query: string; country: string }[] };
    const demande = plan.searches.find((search) => search.id === recherche.id);
    assert.deepEqual([demande?.query, demande?.country], ['mychariow', 'CI'], 'dans la bibliothèque, une boutique Chariow se trouve par son adresse');

    // La bibliothèque rend tout ce qui cite le mot : une boutique Chariow, un blog qui en parle, une boutique Maketou.
    await collecteur()
      .verse({
        country: 'CI',
        search: { id: recherche.id, first: true, done: true },
        items: [
          annonce('4001', 'https://abidjan-ebooks.mychariow.com/prd_1', 'Ebook : réussir son concours'),
          annonce('4002', 'https://www.blog-ecommerce.com/avis-mychariow', 'Notre avis sur mychariow'),
          annonce('4003', 'https://rivale.mymaketou.shop/p/9', 'Quittez mychariow pour nous'),
        ],
      })
      .expect(200);
    const complete = (await agent.get(`/api/espionnage/searches/${recherche.id}`).expect(200)).body.search as Search;
    assert.deepEqual(complete.ads.map((ad) => ad.externalId), ['4001'], 'seule la boutique Chariow est gardée');
    assert.equal(complete.adsFound, 1);
  });

  it('un compte dont le palier montre moins d’annonces lit, sur la pastille, le nombre qu’il verra', async () => {
    const { agent } = await signInWithPlan(app, 'decouverte@exemple.test', 'free');
    const pastilles = ((await agent.get('/api/espionnage/searches').expect(200)).body as Overview).recent;
    const chariow = pastilles.find((p) => p.query === 'chariow' && p.country === 'ALL')!;
    const ouverte = (await agent.get(`/api/espionnage/searches/${chariow.id}`).expect(200)).body.search as Search;
    assert.ok(ouverte.hiddenByPlan > 0, 'ce palier ne montre qu’une partie de la liste');
    assert.equal(chariow.adsFound, ouverte.ads.length, `la pastille (${chariow.adsFound}) dit ce que ce compte voit (${ouverte.ads.length}), pas le total`);
    assert.equal(ouverte.adsFound, ouverte.ads.length + ouverte.hiddenByPlan, 'le total, lui, reste la somme de ce qui est montré et de ce qui attend');
  });

  it('une recherche « chariow » enregistrée avant la règle, pleine d’annonces d’ailleurs, se remet d’aplomb dès qu’on la regarde', async () => {
    const { getDb } = await import('@server/db/client');
    const { adSearchResults, adSearches } = await import('@server/db/schema');
    const { agent } = await signInWithPlan(app, 'revenante@exemple.test', 'elite');
    // Telle que la production en gardait le 11/10/2026 : cinquante annonces annoncées, presque toutes d'un autre site.
    const [ancienne] = await getDb()
      .insert(adSearches)
      .values({ query: 'Chariow', queryKey: 'chariow', country: 'SN', status: 'done', adsFound: 50, resultsLimit: 50, collector: 'pending', finishedAt: new Date() })
      .returning();
    await getDb()
      .insert(adSearchResults)
      .values(
        ['https://atelier-a.mymaketou.shop/p/1', 'https://mode-dakar.myshopify.com/products/robe', 'https://www.blog-ecommerce.com/chariow'].map((lien, position) => ({
          searchId: ancienne!.id,
          position,
          ad: { id: `${ancienne!.id}-${position}`, externalId: `ancienne-${position}`, storeHost: new URL(lien).hostname, landingUrl: lien, title: 'Chariow ou pas ?' } as Record<string, unknown>,
        })),
      );

    const pastilles = ((await agent.get('/api/espionnage/searches').expect(200)).body as Overview).recent;
    const pastille = pastilles.find((p) => p.id === ancienne!.id)!;
    const ouverte = (await agent.get(`/api/espionnage/searches/${ancienne!.id}`).expect(200)).body.search as Search;
    assert.ok(ouverte.ads.every((ad) => /\.mychariow\.com$/.test(ad.storeHost ?? '')), 'plus aucune annonce d’un autre site');
    assert.equal(ouverte.adsFound, ouverte.ads.length);
    assert.equal(pastille.adsFound, ouverte.ads.length, 'et la pastille le disait déjà avant qu’on l’ouvre');
    const [relue] = await getDb().select().from(adSearches).where(eq(adSearches.id, ancienne!.id));
    assert.equal(relue!.adsFound, ouverte.ads.length, 'le nombre enregistré est corrigé lui aussi');
  });
});
