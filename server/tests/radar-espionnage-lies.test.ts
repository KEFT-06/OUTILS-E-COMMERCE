import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Le Radar et l'Espionnage se complètent (propriétaire, 18/10/2026 : « quand le radar manque de
 * données il les tire depuis l'espionnage, et vice versa »).
 *
 *  - Une publicité du mur dit ce que le Radar sait du produit vers lequel elle mène : son nom, son
 *    prix, ses ventes, à la date du relevé — par la règle commune du segment d'adresse.
 *  - La concurrence d'une niche montre aussi les offres que ses boutiques poussent en publicité,
 *    même quand l'index des catalogues n'en connaît aucune.
 */

let app: Express;

before(async () => {
  app = await createTestApp();
  const { getDb } = await import('@server/db/client');
  const { marketProducts, spiedAds } = await import('@server/db/schema');
  const vu = new Date('2026-10-07T10:00:00Z');
  await getDb().insert(marketProducts).values([
    { storeExternalId: 'store_ferme', storeHost: 'ferme.mychariow.com', storeLabel: 'La ferme', externalId: 'prd_poules1', slug: 'guide-poules', name: 'Le guide des poules en ville', nameKey: 'le guide des poules en ville', priceValue: 5000, currency: 'XAF', salesCount: 340, salesAtFirstSeen: 300, lastSeenAt: vu },
    { storeExternalId: 'store_ferme', storeHost: 'ferme.mychariow.com', storeLabel: 'La ferme', externalId: 'prd_autre', name: 'Calendrier de ponte', nameKey: 'calendrier de ponte', priceValue: 2000, currency: 'XAF', salesCount: 12, lastSeenAt: vu },
  ]);
  const commun = { variants: 1, platforms: ['FACEBOOK'], mediaKind: 'image', startedAt: new Date(Date.now() - 40 * 86_400_000) };
  await getDb().insert(spiedAds).values([
    // Deux annonces du même produit : l'une vers sa page (par son identifiant), l'autre vers son paiement.
    { ...commun, externalId: 'pub-1', storeHost: 'ferme.mychariow.com', landingUrl: 'https://ferme.mychariow.shop/prd_poules1', title: 'Élevez vos poulets en ville', active: true },
    { ...commun, externalId: 'pub-2', storeHost: 'ferme.mychariow.com', landingUrl: 'https://ferme.mychariow.shop/prd_poules1/checkout', title: 'Vos poulets pondent tous les jours', active: false },
    // Une autre boutique de la niche, que le Radar n'a jamais relevée.
    { ...commun, externalId: 'pub-3', storeHost: 'voisine.mychariow.com', landingUrl: 'https://voisine.mychariow.shop/elevage', title: 'Formation élevage de poulets', active: true },
    // Hors sujet.
    { ...commun, externalId: 'pub-4', storeHost: 'cuisine.mychariow.com', landingUrl: 'https://cuisine.mychariow.shop/recettes', title: 'Recettes de beignets', active: true },
    // Hors sujet aussi, bien que son texte cite le poulet (relevé réel du 18/10/2026 : un pack de recettes).
    { ...commun, externalId: 'pub-5', storeHost: 'recettes.mychariow.com', landingUrl: 'https://recettes.mychariow.shop/pack', title: 'PACK DE +400 RECETTES CAMEROUNAISES', bodyText: 'Ndolé, poulet DG, eru… toutes les recettes du pays.', active: true },
    // Un mot de la niche noyé dans un autre mot ne compte pas (« excel » dans « excellence »).
    { ...commun, externalId: 'pub-6', storeHost: 'menuisier.mychariow.com', landingUrl: 'https://menuisier.mychariow.shop/guide', title: 'Deviens menuisier d’excellence', active: true },
    { ...commun, externalId: 'pub-7', storeHost: 'tableur.mychariow.com', landingUrl: 'https://tableur.mychariow.shop/excel', title: 'De débutant à expert Excel', active: true },
  ]);
});

after(async () => {
  await closeTestApp();
});

type MurAnnonce = { externalId: string; radar: { product: { name: string; sales: number | null; salesTracked: number | null; price: number | null; readAt: string; url: string } | null; store: { products: number; sales: number | null } | null } | null };

describe('Radar et Espionnage, liés', () => {
  it('une publicité du mur porte le produit annoncé, son prix et ses ventes relevées par le Radar', async () => {
    const { agent } = await signInWithPlan(app, 'lies-mur@exemple.test', 'pro');
    const { body } = await agent.get('/api/espionnage').expect(200);
    const parId = new Map((body.ads as MurAnnonce[]).map((ad) => [ad.externalId, ad]));

    const page = parId.get('pub-1')!.radar!;
    assert.equal(page.product?.name, 'Le guide des poules en ville');
    assert.equal(page.product?.sales, 340);
    assert.equal(page.product?.salesTracked, 40, 'ventes depuis notre premier relevé');
    assert.equal(page.product?.price, 5000);
    assert.equal(page.product?.readAt, '2026-10-07T10:00:00.000Z', 'la date du relevé accompagne le chiffre');
    assert.equal(page.product?.url, 'https://ferme.mychariow.com/guide-poules');
    assert.equal(parId.get('pub-2')!.radar?.product?.name, 'Le guide des poules en ville', 'l’annonce vers le paiement mène au même produit');
    assert.deepEqual(page.store, { products: 2, sales: 352, readAt: '2026-10-07T10:00:00.000Z' });

    assert.equal(parId.get('pub-3')!.radar, null, 'boutique jamais relevée : rien d’inventé');
  });

  it('la concurrence d’une niche montre les offres vues en publicité, réunies par produit', async () => {
    const { agent } = await signInWithPlan(app, 'lies-niche@exemple.test', 'pro');
    const { body } = await agent.get('/api/radar/market').query({ niche: 'Élevage de poulets en ville' }).expect(200);
    const offres = body.advertised as { storeHost: string; title: string; ads: number; activeAds: number; longestDays: number | null; product: { sales: number | null } | null }[];

    assert.deepEqual(offres.map((offre) => offre.storeHost).sort(), ['ferme.mychariow.com', 'voisine.mychariow.com'], 'ni les beignets, ni le pack de recettes qui cite le poulet DG');
    const ferme = offres.find((offre) => offre.storeHost === 'ferme.mychariow.com')!;
    assert.equal(ferme.ads, 2, 'page et paiement : une seule offre');
    assert.equal(ferme.activeAds, 1);
    assert.equal(ferme.title, 'Le guide des poules en ville', 'le nom relevé par le Radar plutôt que le texte publicitaire');
    assert.equal(ferme.product?.sales, 340);
    assert.equal(offres[0]!.storeHost, 'voisine.mychariow.com', 'deux mots de la niche dans son titre : elle passe devant');
    assert.ok((ferme.longestDays ?? 0) >= 39);
  });

  it('un mot de la niche compte entier, jamais noyé dans un autre', async () => {
    const { agent } = await signInWithPlan(app, 'lies-mots@exemple.test', 'pro');
    const { body } = await agent.get('/api/radar/market').query({ niche: 'Formation Excel' }).expect(200);
    assert.deepEqual((body.advertised as { storeHost: string }[]).map((offre) => offre.storeHost), ['tableur.mychariow.com'], '« excellence » n’est pas « Excel »');
  });
});
