import { useSyncExternalStore } from 'react';
import { createPersistentStore, isRecord } from '@/shared/lib/persistentStore';
import { GalleryAd } from '@/shared/types/ingestion';

/**
 * Swipe file personnel — feuille de route 2.3.
 *
 * Stocké dans le navigateur en attendant la base de données. Chaque entrée
 * relue est validée : un octet corrompu coûte une entrée, pas l'écran entier.
 */

/** Contexte de collecte, conservé avec l'annonce pour qu'elle reste interprétable. */
export interface SwipeContext {
  niche: string;
  source: string;
  isDemonstration: boolean;
  collectedAt: string;
}

export interface SwipeEntry extends SwipeContext {
  /** Source + identifiant : une même publicité vue par deux sources reste distincte. */
  key: string;
  ad: GalleryAd;
  savedAt: string;
  note: string;
}

export function swipeKey(source: string, externalId: string): string {
  return `${source}::${externalId}`;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isSwipeEntry(value: unknown): value is SwipeEntry {
  if (!isRecord(value)) return false;

  const ad = value.ad;
  if (!isRecord(ad)) return false;

  return (
    typeof value.key === 'string' &&
    typeof value.niche === 'string' &&
    typeof value.source === 'string' &&
    typeof value.isDemonstration === 'boolean' &&
    typeof value.collectedAt === 'string' &&
    typeof value.savedAt === 'string' &&
    typeof value.note === 'string' &&
    typeof ad.externalId === 'string' &&
    typeof ad.advertiserId === 'string' &&
    typeof ad.advertiserName === 'string' &&
    typeof ad.startedAt === 'string' &&
    typeof ad.market === 'string' &&
    typeof ad.lifetimeDays === 'number' &&
    typeof ad.isActive === 'boolean' &&
    typeof ad.isEstablished === 'boolean' &&
    isOptionalString(ad.endedAt) &&
    isOptionalString(ad.creativeBody) &&
    isOptionalString(ad.landingPageUrl)
  );
}

const store = createPersistentStore<SwipeEntry[]>(
  'smartcreator_swipe_file_v1',
  (raw) => (Array.isArray(raw) ? raw.filter(isSwipeEntry) : []),
  [],
);

/** Lecture hors composant React : exports et vérification d'originalité. */
export function getSwipeEntries(): SwipeEntry[] {
  return store.getState().value;
}

export function useSwipeFile() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getState);
  const entries = snapshot.value;

  return {
    entries,
    writeFailed: snapshot.writeFailed,

    isSaved: (key: string) => entries.some((entry) => entry.key === key),

    toggle: (ad: GalleryAd, context: SwipeContext) => {
      const current = store.getState().value;
      const key = swipeKey(context.source, ad.externalId);

      if (current.some((entry) => entry.key === key)) {
        store.commit(current.filter((entry) => entry.key !== key));
        return;
      }

      store.commit([
        { ...context, key, ad, savedAt: new Date().toISOString(), note: '' },
        ...current,
      ]);
    },

    remove: (key: string) =>
      store.commit(store.getState().value.filter((entry) => entry.key !== key)),

    updateNote: (key: string, note: string) =>
      store.commit(
        store.getState().value.map((entry) => (entry.key === key ? { ...entry, note } : entry)),
      ),

    clear: () => store.commit([]),
  };
}
