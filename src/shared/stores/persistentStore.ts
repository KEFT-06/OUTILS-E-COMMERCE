/**
 * Brouillons de l'espace de travail, conservés sur le compte.
 *
 * Chaque magasin suit le compte connecté : il se charge depuis le serveur à la
 * connexion, enregistre chaque modification quelques instants plus tard, et se vide
 * à la déconnexion, pour que les brouillons d'un compte ne restent pas à l'écran du
 * suivant. Règles héritées de l'audit (D4) :
 *  - la lecture ne lève jamais, et `parse` valide ce qui est relu ;
 *  - un échec d'enregistrement est exposé (`writeFailed`), jamais avalé en silence.
 *
 * Les brouillons gardés dans ce navigateur avant le passage sur le compte sont repris
 * une fois, puis effacés du navigateur.
 *
 * S'utilise avec `useSyncExternalStore(store.subscribe, store.getState)`.
 */

export type WorkspaceKind = 'product_drafts' | 'launch_kits' | 'product_pages' | 'custom_products';

export interface PersistentState<T> {
  value: T;
  /** true ⇒ la dernière modification n'a pas pu être enregistrée sur le compte. */
  writeFailed: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
}

export interface PersistentStore<T> {
  getState: () => PersistentState<T>;
  subscribe: (listener: () => void) => () => void;
  commit: (value: T) => void;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Fusion d'anciens brouillons du navigateur avec ceux du compte : ceux du compte l'emportent. */
export function mergeRecords<T extends Record<string, unknown>>(account: T, legacy: T): T {
  return { ...legacy, ...account };
}

const SAVE_DELAY_MS = 800;

interface RegisteredStore {
  bind: (accountId: string | null) => void;
  flush: (keepalive: boolean) => Promise<void>;
  refresh: () => void;
}

const stores = new Set<RegisteredStore>();
let boundAccount: string | null = null;

/** Relie tous les brouillons au compte connecté (null : déconnexion). */
export function bindAccountStores(accountId: string | null): void {
  if (accountId === boundAccount) return;
  boundAccount = accountId;
  stores.forEach((store) => store.bind(accountId));
}

/** Envoie tout de suite les modifications en attente (avant une déconnexion). */
export async function flushAccountStores(): Promise<void> {
  await Promise.all([...stores].map((store) => store.flush(false)));
}

if (typeof window !== 'undefined') {
  // Onglet fermé ou masqué : les modifications en attente partent sans attendre.
  window.addEventListener('pagehide', () => stores.forEach((store) => void store.flush(true)));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stores.forEach((store) => void store.flush(true));
    // Retour sur l'onglet : les brouillons modifiés depuis un autre appareil sont relus.
    else stores.forEach((store) => store.refresh());
  });
}

export function createPersistentStore<T>(options: {
  kind: WorkspaceKind;
  /** Reçoit la valeur relue, non fiable ; renvoie une valeur valide. */
  parse: (raw: unknown) => T;
  empty: T;
  /** Clé de l'ancien stockage du navigateur, reprise une seule fois. */
  legacyKey: string;
  merge: (account: T, legacy: T) => T;
}): PersistentStore<T> {
  const { kind, parse, empty, legacyKey, merge } = options;
  const endpoint = `/api/workspace/${kind}`;

  let state: PersistentState<T> = { value: empty, writeFailed: false, status: 'idle' };
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Change à chaque changement de compte : une réponse arrivée trop tard est ignorée. */
  let binding = 0;
  /** Les enregistrements partent l'un après l'autre : une ancienne version ne peut pas écraser la suivante. */
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const set = (next: Partial<PersistentState<T>>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };

  const readLegacy = (): T | null => {
    try {
      const raw = localStorage.getItem(legacyKey);
      return raw ? parse(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  };

  const dropLegacy = () => {
    try {
      localStorage.removeItem(legacyKey);
    } catch {
      // Stockage inaccessible : rien à effacer.
    }
  };

  const save = async (keepalive: boolean) => {
    const current = binding;
    if (!boundAccount || !dirty) return;
    // Brouillons du compte pas encore lus : enregistrer maintenant écraserait ceux du serveur.
    if (state.status !== 'ready') {
      set({ writeFailed: true });
      return;
    }
    dirty = false;
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: state.value }),
        keepalive,
      });
      if (!response.ok) throw new Error(String(response.status));
      if (current === binding && state.writeFailed) set({ writeFailed: false });
    } catch {
      if (current !== binding) return;
      dirty = true;
      set({ writeFailed: true });
    }
  };

  const enqueueSave = (keepalive = false) => {
    clearTimeout(timer);
    queue = queue.then(() => save(keepalive));
    return queue;
  };

  const load = async (current: number, quiet: boolean) => {
    if (!quiet) set({ status: 'loading' });
    try {
      const response = await fetch(endpoint, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { data?: unknown };
      if (current !== binding || (quiet && dirty)) return;

      const fromAccount = body.data === null || body.data === undefined ? null : parse(body.data);
      const legacy = readLegacy();
      const value = legacy === null ? (fromAccount ?? empty) : fromAccount === null ? legacy : merge(fromAccount, legacy);
      set({ value, status: 'ready' });

      if (legacy !== null) {
        dirty = true;
        await enqueueSave();
        if (current === binding && !state.writeFailed) dropLegacy();
      }
    } catch {
      if (current === binding && !quiet) set({ status: 'error' });
    }
  };

  const registered: RegisteredStore = {
    bind: (accountId) => {
      binding += 1;
      clearTimeout(timer);
      dirty = false;
      set({ value: empty, writeFailed: false, status: accountId ? 'loading' : 'idle' });
      if (accountId) void load(binding, false);
    },
    flush: (keepalive) => (dirty ? enqueueSave(keepalive) : Promise.resolve()),
    refresh: () => {
      if (boundAccount && !dirty && state.status === 'ready') void load(binding, true);
    },
  };
  stores.add(registered);
  if (boundAccount) registered.bind(boundAccount);

  return {
    getState: () => state,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    commit: (value) => {
      set({ value });
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => void enqueueSave(), SAVE_DELAY_MS);
    },
  };
}
