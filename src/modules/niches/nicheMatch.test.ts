import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NICHE_SECTORS } from '@/modules/niches/nicheCatalog';
import { suggestCatalog } from '@/modules/niches/nicheMatch';

/** Rangement automatique d'une niche ajoutée, contre le VRAI catalogue du site. */
describe('Rangement d’une niche dans son catalogue', () => {
  const sector = (niche: string) => suggestCatalog(niche, NICHE_SECTORS)?.id ?? null;
  const idOf = (fragment: string) => NICHE_SECTORS.find((entry) => entry.label.toLowerCase().includes(fragment))!.id;

  it('range une niche dans le secteur dont elle partage le vocabulaire', () => {
    // Le mot spécifique décide : « gestion », que quinze secteurs emploient, envoyait cette niche dans « Business ».
    assert.equal(sector('Gestion du diabète au quotidien'), 'sante');
    assert.equal(sector('Recettes pour diabétiques pressés'), 'nutrition');
    assert.equal(sector('Élevage de poulets de chair en ville'), idOf('agricult'));
    assert.equal(sector('Cours de guitare pour débutants'), idOf('musique'));
    assert.equal(sector('Vendre des ebooks sur Chariow'), 'ecommerce', '« vendre » rejoint « vente en ligne »');
    assert.equal(sector('Prière et étude biblique en petit groupe'), 'spiritualite');
    assert.equal(sector('Trading de cryptomonnaies pour débutants'), 'crypto');
    assert.equal(sector('Dressage de chiens de garde'), 'animaux');
  });

  it('ne devine rien quand aucun mot ne s’y retrouve', () => {
    assert.equal(sector('Zzyzx qwfp'), null);
    assert.equal(sector('de la et pour'), null, 'les mots vides ne comptent pas');
    assert.equal(sector(''), null);
  });

  it('préfère le catalogue créé par l’utilisateur quand son nom porte le sujet', () => {
    // Le site a déjà une niche d'escargots en agriculture : le catalogue que l'utilisateur a créé pour eux l'emporte.
    const own = { id: 'perso-1', label: 'Escargots', niches: ['Vente d’escargots séchés'], own: true };
    assert.equal(suggestCatalog('Élevage d’escargots à petite échelle', [own, ...NICHE_SECTORS])?.id, 'perso-1');
  });
});
