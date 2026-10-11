import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DigitalProductIdea } from '@/shared/types/analysis';
import { gatherProducts } from './useAccountProducts';

/**
 * Les ouvrages du compte, d'où qu'ils viennent : un ebook rédigé à partir d'une autre analyse ne
 * disparaît plus des écrans quand on change de niche.
 */
const produit = (id: string, title: string) => ({ id, title }) as unknown as DigitalProductIdea;

describe('ouvrages du compte', () => {
  const analyseOuverte = [produit('idee-poules-1', 'Élever des poules en ville'), produit('idee-poules-2', 'Vendre ses œufs')];
  const horsAnalyse = [produit('produit-main', 'Vendre ses beignets')];
  // Versions de travail : un ouvrage de l'analyse ouverte, un créé à la main, et un rédigé à partir d'une AUTRE analyse.
  const travailles = [produit('idee-poules-1', 'Élever des poules en ville (rédigé)'), produit('produit-main', 'Vendre ses beignets'), produit('idee-couture-1', 'Coudre et vendre')];

  it('réunit l’analyse ouverte, la création hors analyse et les ouvrages travaillés ailleurs, sans doublon', () => {
    const mine = gatherProducts({ fromReport: analyseOuverte, custom: horsAnalyse, drafted: travailles, removed: [] });
    assert.deepEqual(mine.all.map((p) => p.id), ['idee-poules-1', 'idee-poules-2', 'produit-main', 'idee-couture-1']);
    assert.deepEqual(mine.elsewhere.map((p) => p.title), ['Coudre et vendre'], 'l’ebook d’une autre niche reste un ouvrage du compte');
  });

  it('sans analyse ouverte, les ouvrages rédigés restent tous là', () => {
    const mine = gatherProducts({ fromReport: [], custom: [], drafted: travailles, removed: [] });
    assert.deepEqual(mine.all.map((p) => p.id), ['idee-poules-1', 'produit-main', 'idee-couture-1']);
  });

  it('ce que le compte a supprimé ne revient par aucune des trois portes', () => {
    const mine = gatherProducts({ fromReport: analyseOuverte, custom: horsAnalyse, drafted: travailles, removed: ['idee-poules-2', 'idee-couture-1'] });
    assert.deepEqual(mine.all.map((p) => p.id), ['idee-poules-1', 'produit-main']);
  });
});
