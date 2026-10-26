import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY_UTM, buildAffiliateLinks, buildUtmUrl, utmDefaultsOf } from '@/modules/affiliation/utm';

const champs = { campaign: 'lancement', id: '', sourcePlatform: '', term: '', content: '' };
const BASE = 'https://boutique.exemple.com/produit';

describe('Liens d’affiliés', () => {
  it('refuse un second code qui donnerait le même lien, au lieu de confondre leurs ventes', () => {
    const liens = buildAffiliateLinks(BASE, champs, ['Aïcha', 'aicha', 'AMA01', 'ama01']);
    assert.equal(liens[0]!.result.ok, true);
    assert.equal(liens[1]!.result.ok, false, '« aicha » recouvre « Aïcha »');
    assert.match(liens[1]!.result.ok ? '' : liens[1]!.result.errors[0]!, /Aïcha/);
    assert.equal(liens[2]!.result.ok, true);
    assert.equal(liens[3]!.result.ok, false, '« ama01 » recouvre « AMA01 »');
  });

  it('donne un lien distinct à chaque code distinct', () => {
    const liens = buildAffiliateLinks(BASE, champs, ['kofi', 'ama']);
    const urls = liens.map((lien) => (lien.result.ok ? lien.result.url : ''));
    assert.equal(new Set(urls).size, 2);
    assert.ok(urls[0]!.includes('utm_source=kofi') && urls[0]!.includes('utm_medium=affiliate'));
    assert.equal(EMPTY_UTM.source, '');
  });
});

describe('Lien de campagne prérempli', () => {
  it('porte la niche analysée, en minuscules sans accents, et donne un lien valide dès l’adresse collée', () => {
    const champs = utmDefaultsOf('Élevage de poules pondeuses en milieu urbain', new Date(2026, 9, 25));
    assert.equal(champs.campaign, 'lancement_elevage_poules_pondeuses');
    assert.equal(champs.id, '2026-10-lancement');
    const lien = buildUtmUrl('https://exemple.mychariow.com/poules', champs);
    assert.ok(lien.ok);
    assert.match(lien.url, /utm_source=facebook&utm_medium=cpc&utm_campaign=lancement_elevage_poules_pondeuses/);
  });

  it('ne coupe jamais sur un petit mot', () => {
    assert.equal(utmDefaultsOf('Élevage de poulets en ville', new Date(2026, 9, 25)).campaign, 'lancement_elevage_poulets_ville');
    assert.equal(utmDefaultsOf('Vente d’attiéké à Abidjan', new Date(2026, 9, 25)).campaign, 'lancement_vente_attieke_abidjan');
  });

  it('sans analyse, la campagne porte le mois', () => {
    assert.equal(utmDefaultsOf(null, new Date(2026, 7, 3)).campaign, 'lancement_aout');
  });
});
