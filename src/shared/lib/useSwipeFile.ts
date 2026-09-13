import { useSyncExternalStore } from 'react';
import { GalleryAd } from '@/shared/types/ingestion';

/**
 * Swipe file personnel — feuille de route 2.3.
 *
 * Stocké dans le navigateur en attendant la base de données. Deux leçons de
 * l'audit (D4 : `JSON.parse` sans garde qui faisait planter l'application au
 * montage) s'appliquent directement ici : la lecture du stockage ne peut jamais
 * lever, et chaque entrée relue est validée. Un octet corrompu doit coûter une
 * entrée, pas l'écran entier.
 *
 * Magasin partagé via `useSyncExternalStore` : la galerie et la vue swipe file
 * affichent le même état sans se le passer en props.
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

interface SwipeState {
  entries: SwipeEntry[];
  /** true ⇒ la dernière écriture a échoué : le swipe file ne survivra pas à l'onglet. */
  writeFailed: boolean;
}

const STORAGE_KEY = 'smartcreator_swipe_file_v1';

export function swipeKey(source: string, externalId: string): string {
  return `${source}::${externalId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

function readStorage(): SwipeEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSwipeEntry) : [];
  } catch {
    return [];
  }
}

let state: SwipeState = { entries: readStorage(), writeFailed: false };
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function commit(entries: SwipeEntry[]): void {
  let writeFailed = false;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Stockage plein ou bloqué (navigation privée) : on garde en mémoire et on
    // le signale. Perdre silencieusement un swipe file à la fermeture de
    // l'onglet serait la pire issue possible.
    writeFailed = true;
  }

  state = { entries, writeFailed };
  notify();
}

// Synchronisation entre onglets : sans elle, deux onglets ouverts s'écrasent
// mutuellement leurs sauvegardes.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = { entries: readStorage(), writeFailed: state.writeFailed };
    notify();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SwipeState {
  return state;
}

export function useSwipeFile() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  return {
    entries: snapshot.entries,
    writeFailed: snapshot.writeFailed,

    isSaved: (key: string) => snapshot.entries.some((entry) => entry.key === key),

    toggle: (ad: GalleryAd, context: SwipeContext) => {
      const key = swipeKey(context.source, ad.externalId);

      if (state.entries.some((entry) => entry.key === key)) {
        commit(state.entries.filter((entry) => entry.key !== key));
        return;
      }

      commit([
        { ...context, key, ad, savedAt: new Date().toISOString(), note: '' },
        ...state.entries,
      ]);
    },

    remove: (key: string) => commit(state.entries.filter((entry) => entry.key !== key)),

    updateNote: (key: string, note: string) =>
      commit(state.entries.map((entry) => (entry.key === key ? { ...entry, note } : entry))),

    clear: () => commit([]),
  };
}
