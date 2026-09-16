import { useSyncExternalStore } from 'react';
import { createPersistentStore, isRecord, mergeRecords } from '@/shared/stores/persistentStore';
import { DigitalProductIdea } from '@/shared/types/analysis';

/**
 * Brouillons du mode Expert — feuille de route 3.1.
 *
 * Les retouches de l'utilisateur sont enregistrées à côté du produit d'origine,
 * jamais à sa place : on peut toujours revenir à la version issue du rapport, et
 * un export sait s'il porte sur une version retouchée.
 */

type ProductDrafts = Record<string, DigitalProductIdea>;

const PRODUCT_TYPES: readonly DigitalProductIdea['type'][] = [
  'ebook',
  'template',
  'masterclass',
  'bundle',
  'micro_tool',
];

/** Les analyses n'avancent ni prix, ni marge, ni délai sans source : ces champs peuvent être nuls. */
function isNumberOrNull(value: unknown): boolean {
  return value === null || typeof value === 'number';
}

function isModule(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.moduleNumber === 'number' &&
    typeof value.title === 'string' &&
    typeof value.details === 'string'
  );
}

function isOrigin(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'manual') return true;
  return value.kind === 'video' && typeof value.label === 'string' && (value.url === undefined || typeof value.url === 'string');
}

/** Produit relu depuis le compte : validé champ par champ. */
export function isProduct(value: unknown): value is DigitalProductIdea {
  if (!isRecord(value)) return false;

  const leadMagnet = value.leadMagnet;
  const modules = value.tableOfContents;
  if (!isRecord(leadMagnet) || !Array.isArray(modules)) return false;

  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.subtitle === 'string' &&
    PRODUCT_TYPES.includes(value.type as DigitalProductIdea['type']) &&
    typeof value.typeName === 'string' &&
    isNumberOrNull(value.recommendedPrice) &&
    typeof value.currency === 'string' &&
    isNumberOrNull(value.estimatedProductionDays) &&
    isNumberOrNull(value.estimatedMarginPercent) &&
    (value.pricingNote === undefined || typeof value.pricingNote === 'string') &&
    (value.origin === undefined || isOrigin(value.origin)) &&
    typeof value.targetAudience === 'string' &&
    typeof value.transformationPromise === 'string' &&
    typeof value.imageUrl === 'string' &&
    modules.every(isModule) &&
    typeof leadMagnet.title === 'string' &&
    typeof leadMagnet.format === 'string' &&
    typeof leadMagnet.hook === 'string'
  );
}

const store = createPersistentStore<ProductDrafts>({
  kind: 'product_drafts',
  legacyKey: 'smartcreator_product_drafts_v1',
  merge: mergeRecords,
  empty: {},
  parse: (raw) => {
    if (!isRecord(raw)) return {};
    // Une clé qui ne correspond pas à l'identifiant du produit stocké signale
    // une donnée altérée : on l'écarte plutôt que d'afficher le mauvais produit.
    return Object.fromEntries(
      Object.entries(raw).filter(([id, product]) => isProduct(product) && product.id === id),
    ) as ProductDrafts;
  },
});

export function useProductDrafts() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getState);
  const drafts = snapshot.value;

  return {
    writeFailed: snapshot.writeFailed,

    hasDraft: (productId: string) => Object.prototype.hasOwnProperty.call(drafts, productId),

    /** Version à afficher et à exporter : le brouillon s'il existe, sinon l'original. */
    effective: (product: DigitalProductIdea): DigitalProductIdea => drafts[product.id] ?? product,

    saveDraft: (product: DigitalProductIdea) =>
      store.commit({ ...store.getState().value, [product.id]: product }),

    discardDraft: (productId: string) => {
      const next = { ...store.getState().value };
      delete next[productId];
      store.commit(next);
    },
  };
}
