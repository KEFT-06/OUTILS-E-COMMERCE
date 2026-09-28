import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY_UTM, buildAffiliateLinks } from '@/modules/affiliation/utm';

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
