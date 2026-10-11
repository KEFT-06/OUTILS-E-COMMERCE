import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withoutRemoved } from './useRemovedProducts';

/** Un ebook supprimé ne revient dans aucune liste de produits du compte. */
describe('produits supprimés par le compte', () => {
  const produits = [
    { id: 'idee-1', title: 'Guide du potager' },
    { id: 'idee-2', title: 'Plan 21 jours sans sucre' },
    { id: 'idee-3', title: 'Vendre ses beignets' },
  ];

  it('laisse de côté ceux que le compte a supprimés, et garde l’ordre des autres', () => {
    assert.deepEqual(withoutRemoved(produits, ['idee-2']).map((produit) => produit.id), ['idee-1', 'idee-3']);
    assert.deepEqual(withoutRemoved(produits, ['idee-3', 'idee-1', 'inconnu']).map((produit) => produit.id), ['idee-2']);
  });

  it('sans suppression, rend la liste telle quelle — dans un tableau neuf', () => {
    const rendue = withoutRemoved(produits, []);
    assert.deepEqual(rendue, produits);
    assert.notEqual(rendue, produits);
  });
});
