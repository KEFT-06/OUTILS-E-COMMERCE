import { useSyncExternalStore } from 'react';
import { createPersistentStore } from '@/shared/stores/persistentStore';
import { isProduct } from '@/shared/stores/useProductDrafts';
import type { DigitalProductIdea } from '@/shared/types/analysis';

/**
 * Produits créés hors d'une analyse de niche — saisis à la main ou tirés d'une
 * vidéo —, conservés sur le compte. Ils rejoignent ceux de la niche analysée dans
 * le Studio, le Kit de lancement, les pages produits et les guides.
 */

export const MAX_CUSTOM_PRODUCTS = 30;

const store = createPersistentStore<DigitalProductIdea[]>({
  kind: 'custom_products',
  legacyKey: 'smartcreator_custom_products_v1',
  parse: (raw) => (Array.isArray(raw) ? raw.filter(isProduct) : []),
  empty: [],
  merge: (account, legacy) => [...account, ...legacy.filter((product) => !account.some((kept) => kept.id === product.id))],
});

/** Produit vierge, à compléter dans le mode Expert ou à faire rédiger par l'IA. */
export function blankProduct(currency: string): DigitalProductIdea {
  return {
    id: `produit-${crypto.randomUUID()}`,
    origin: { kind: 'manual' },
    title: 'Nouveau produit',
    subtitle: '',
    type: 'ebook',
    typeName: 'Ebook',
    recommendedPrice: null,
    currency,
    estimatedProductionDays: null,
    estimatedMarginPercent: null,
    pricingNote: 'Prix à fixer dans le simulateur.',
    targetAudience: '',
    transformationPromise: '',
    tableOfContents: [1, 2, 3].map((moduleNumber) => ({ moduleNumber, title: `Module ${moduleNumber}`, details: '' })),
    leadMagnet: { title: '', format: '', hook: '' },
    imageUrl: '',
  };
}

export function useCustomProducts() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getState);
  return {
    products: snapshot.value,
    status: snapshot.status,
    writeFailed: snapshot.writeFailed,
    canAdd: snapshot.status === 'ready' && snapshot.value.length < MAX_CUSTOM_PRODUCTS,
    add: (product: DigitalProductIdea) => store.commit([product, ...store.getState().value].slice(0, MAX_CUSTOM_PRODUCTS)),
    remove: (productId: string) => store.commit(store.getState().value.filter((product) => product.id !== productId)),
  };
}
