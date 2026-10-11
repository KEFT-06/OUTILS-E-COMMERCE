import { useSyncExternalStore } from 'react';
import { createPersistentStore } from '@/shared/stores/persistentStore';

/**
 * Produits que le compte a supprimés de ses listes.
 *
 * Un produit créé à la main disparaît de `custom_products`. Celui qui vient d'une analyse de
 * niche, lui, fait partie d'un rapport qu'on ne réécrit pas : il est donc noté ici, et chaque
 * liste de produits du compte (Studio, Mes créations, kits, pages, guides, créatifs) le laisse
 * de côté. Le rapport d'analyse garde son idée de produit : c'est son contenu.
 */

const MAX_REMOVED = 500;

const store = createPersistentStore<string[]>({
  kind: 'removed_products',
  legacyKey: 'smartcreator_removed_products_v1',
  parse: (raw) => (Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 120))].slice(-MAX_REMOVED) : []),
  empty: [],
  merge: (account, legacy) => [...new Set([...account, ...legacy])].slice(-MAX_REMOVED),
});

/** Les produits d'une liste que le compte n'a pas supprimés. */
export function withoutRemoved<T extends { id: string }>(products: readonly T[], removed: readonly string[]): T[] {
  if (removed.length === 0) return [...products];
  const gone = new Set(removed);
  return products.filter((product) => !gone.has(product.id));
}

export function useRemovedProducts() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getState);
  return {
    ids: snapshot.value,
    /** Laisse de côté, dans une liste, ce que le compte a supprimé. */
    keep: <T extends { id: string }>(products: readonly T[]) => withoutRemoved(products, snapshot.value),
    add: (productId: string) => {
      const current = store.getState().value;
      if (!current.includes(productId)) store.commit([...current, productId].slice(-MAX_REMOVED));
    },
  };
}
