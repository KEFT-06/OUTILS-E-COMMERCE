import { useSyncExternalStore } from 'react';
import { createPersistentStore, isRecord } from '@/shared/lib/persistentStore';
import { FaqItem, ProductPageDraft, SectionRole } from '@/shared/types/productPage';

/** Saisies du générateur de pages, par produit, conservées dans le navigateur. */

const ROLES: readonly string[] = ['hero', 'problem', 'solution', 'content', 'audience', 'offer', 'faq_cta'] satisfies readonly SectionRole[];

const TEXT_FIELDS = [
  'headlineA',
  'headlineB',
  'ctaLabelA',
  'ctaLabelB',
  'checkoutUrl',
  'problem',
  'notFor',
  'offerConditions',
] as const;

function isFaqItem(value: unknown): value is FaqItem {
  return isRecord(value) && typeof value.question === 'string' && typeof value.answer === 'string';
}

function isPageDraft(value: unknown): value is ProductPageDraft {
  if (!isRecord(value)) return false;

  const images = value.images;
  const faq = value.faq;
  if (!isRecord(images) || !Array.isArray(faq)) return false;

  return (
    typeof value.productId === 'string' &&
    TEXT_FIELDS.every((field) => typeof value[field] === 'string') &&
    (value.price === undefined || typeof value.price === 'string') &&
    faq.every(isFaqItem) &&
    Object.entries(images).every(([role, url]) => ROLES.includes(role) && typeof url === 'string')
  );
}

type PageDrafts = Record<string, ProductPageDraft>;

const store = createPersistentStore<PageDrafts>(
  'smartcreator_product_pages_v1',
  (raw) =>
    isRecord(raw)
      ? (Object.fromEntries(
          Object.entries(raw).filter(([id, draft]) => isPageDraft(draft) && draft.productId === id),
        ) as PageDrafts)
      : {},
  {},
);

export function useProductPageDrafts() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getState);

  return {
    writeFailed: snapshot.writeFailed,
    get: (productId: string): ProductPageDraft | undefined => snapshot.value[productId],
    save: (draft: ProductPageDraft) => store.commit({ ...store.getState().value, [draft.productId]: draft }),
  };
}
