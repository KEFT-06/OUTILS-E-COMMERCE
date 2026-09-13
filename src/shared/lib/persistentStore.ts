/**
 * Magasin persistant dans le navigateur, partagé entre composants.
 *
 * Mutualise les règles apprises avec l'audit (D4 : `JSON.parse` sans garde qui
 * faisait planter l'application au montage) pour que chaque nouvel usage en
 * hérite au lieu de les réécrire :
 *  - la lecture ne lève jamais, et `parse` valide ce qui est relu ;
 *  - un échec d'écriture est exposé (`writeFailed`), jamais avalé en silence ;
 *  - les onglets ouverts restent synchronisés.
 *
 * S'utilise avec `useSyncExternalStore(store.subscribe, store.getState)`.
 */

export interface PersistentState<T> {
  value: T;
  /** true ⇒ la dernière écriture a échoué : la donnée ne survivra pas à l'onglet. */
  writeFailed: boolean;
}

export interface PersistentStore<T> {
  getState: () => PersistentState<T>;
  subscribe: (listener: () => void) => () => void;
  commit: (value: T) => void;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createPersistentStore<T>(
  storageKey: string,
  /** Reçoit la valeur désérialisée, non fiable ; renvoie une valeur valide. */
  parse: (raw: unknown) => T,
  empty: T,
): PersistentStore<T> {
  const read = (): T => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? parse(JSON.parse(raw)) : empty;
    } catch {
      return empty;
    }
  };

  let state: PersistentState<T> = { value: read(), writeFailed: false };
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((listener) => listener());

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== storageKey) return;
      state = { value: read(), writeFailed: state.writeFailed };
      notify();
    });
  }

  return {
    getState: () => state,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    commit: (value) => {
      let writeFailed = false;
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        // Stockage plein ou bloqué (navigation privée) : on garde en mémoire et
        // on le signale plutôt que de perdre la donnée sans prévenir.
        writeFailed = true;
      }
      state = { value, writeFailed };
      notify();
    },
  };
}
