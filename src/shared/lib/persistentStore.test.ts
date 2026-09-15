import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

/**
 * Brouillons synchronisés avec le compte, testés sans navigateur : faux stockage
 * local et faux serveur. Vérifie la reprise des anciens brouillons, l'envoi des
 * modifications, l'isolement entre comptes et le refus d'écraser le serveur quand
 * la lecture a échoué.
 */

const storage = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
});

interface Call {
  method: string;
  url: string;
  body: unknown;
}

let calls: Call[] = [];
let serverData: unknown = null;
let failGet = false;
let failPut = false;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, url: String(input), body });
  if (method === 'GET') {
    return failGet ? new Response('{}', { status: 500 }) : Response.json({ data: serverData, updatedAt: null });
  }
  if (failPut) return new Response('{}', { status: 500 });
  serverData = (body as { data: unknown }).data;
  return Response.json({ updatedAt: new Date().toISOString() });
}) as typeof fetch;

const { bindAccountStores, createPersistentStore, flushAccountStores, mergeRecords } = await import('@/shared/lib/persistentStore');

async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(condition(), 'condition jamais atteinte');
}

type Notes = Record<string, string>;
const store = createPersistentStore<Notes>({
  kind: 'launch_kits',
  legacyKey: 'ancienne_cle',
  parse: (raw) => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Notes) : {}),
  empty: {},
  merge: mergeRecords,
});

beforeEach(() => {
  bindAccountStores(null);
  calls = [];
  serverData = null;
  failGet = false;
  failPut = false;
  storage.clear();
});

describe('Brouillons synchronisés avec le compte', () => {
  it('reprend une fois les brouillons du navigateur, puis enregistre chaque modification', async () => {
    storage.set('ancienne_cle', JSON.stringify({ p1: 'brouillon local' }));
    serverData = { p2: 'brouillon du compte', p1: 'version du compte' };

    bindAccountStores('compte-a');
    await until(() => store.getState().status === 'ready' && !storage.has('ancienne_cle'));

    assert.deepEqual(store.getState().value, { p1: 'version du compte', p2: 'brouillon du compte' }, 'le compte l’emporte');
    assert.equal(calls[0]!.url, '/api/workspace/launch_kits');
    assert.deepEqual(serverData, { p1: 'version du compte', p2: 'brouillon du compte' }, 'fusion envoyée au serveur');

    store.commit({ p1: 'modifié' });
    await flushAccountStores();
    assert.deepEqual(serverData, { p1: 'modifié' });
    assert.equal(store.getState().writeFailed, false);
  });

  it('vide les brouillons à la déconnexion et signale un enregistrement échoué', async () => {
    serverData = { p1: 'du compte A' };
    bindAccountStores('compte-a');
    await until(() => store.getState().status === 'ready');
    assert.deepEqual(store.getState().value, { p1: 'du compte A' });

    bindAccountStores(null);
    assert.deepEqual(store.getState().value, {}, 'rien ne reste à l’écran du compte suivant');

    bindAccountStores('compte-b');
    await until(() => store.getState().status === 'ready');
    failPut = true;
    store.commit({ p9: 'ne passera pas' });
    await flushAccountStores();
    assert.equal(store.getState().writeFailed, true);

    failPut = false;
    await flushAccountStores();
    assert.equal(store.getState().writeFailed, false, 'nouvel essai réussi');
    assert.deepEqual(serverData, { p9: 'ne passera pas' });
  });

  it('n’écrase jamais les brouillons du serveur quand leur lecture a échoué', async () => {
    failGet = true;
    serverData = { p1: 'précieux' };
    bindAccountStores('compte-c');
    await until(() => store.getState().status === 'error');

    store.commit({ p1: 'écran vide modifié' });
    await flushAccountStores();

    assert.equal(calls.filter((call) => call.method === 'PUT').length, 0);
    assert.deepEqual(serverData, { p1: 'précieux' });
    assert.equal(store.getState().writeFailed, true);
  });
});
