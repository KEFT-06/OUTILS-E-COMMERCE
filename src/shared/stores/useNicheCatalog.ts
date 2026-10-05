import { useSyncExternalStore } from 'react';
import { searchKey } from '@server/shared/countries';
import { createPersistentStore, isRecord } from '@/shared/stores/persistentStore';

/**
 * Catalogue personnel des niches, conservé sur le compte.
 *
 * Le catalogue du site est une taxonomie de départ : il ne peut pas contenir toutes les niches,
 * ni tous les secteurs. L'utilisateur y ajoute donc les siennes — rangées dans le secteur qui
 * leur convient — et crée les catalogues qui manquent.
 */

export const MAX_OWN_CATALOGS = 20;
export const MAX_OWN_NICHES = 300;

export interface OwnCatalog {
  id: string;
  label: string;
}

export interface OwnNiche {
  name: string;
  /** Secteur du site, ou catalogue créé par l'utilisateur. */
  catalogId: string;
}

export interface NicheCatalogState {
  catalogs: OwnCatalog[];
  niches: OwnNiche[];
}

const EMPTY: NicheCatalogState = { catalogs: [], niches: [] };

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function parse(raw: unknown): NicheCatalogState {
  if (!isRecord(raw)) return EMPTY;
  const catalogs = (Array.isArray(raw.catalogs) ? raw.catalogs : [])
    .flatMap((entry: unknown) => {
      if (!isRecord(entry)) return [];
      const id = text(entry.id, 80);
      const label = text(entry.label, 80);
      return id && label ? [{ id, label }] : [];
    })
    .slice(0, MAX_OWN_CATALOGS);
  const niches = (Array.isArray(raw.niches) ? raw.niches : [])
    .flatMap((entry: unknown) => {
      if (!isRecord(entry)) return [];
      const name = text(entry.name, 200);
      const catalogId = text(entry.catalogId, 80);
      return name.length >= 2 && catalogId ? [{ name, catalogId }] : [];
    })
    .slice(0, MAX_OWN_NICHES);
  return { catalogs, niches };
}

const store = createPersistentStore<NicheCatalogState>({
  kind: 'niche_catalog',
  // Aucune version de ce catalogue n'a existé dans le navigateur : rien à reprendre.
  legacyKey: 'smartcreator_niche_catalog_v1',
  parse,
  empty: EMPTY,
  merge: (account) => account,
});

export const newCatalogId = () => `perso-${crypto.randomUUID()}`;

export function useNicheCatalog() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getState);
  const state = snapshot.value;
  const current = () => store.getState().value;

  return {
    ...state,
    status: snapshot.status,
    writeFailed: snapshot.writeFailed,
    canAddCatalog: state.catalogs.length < MAX_OWN_CATALOGS,
    canAddNiche: state.niches.length < MAX_OWN_NICHES,

    /** Remplace tout le catalogue personnel : sert à annuler une suppression. */
    restore: (previous: NicheCatalogState) => store.commit(previous),

    /** Crée un catalogue et rend son identifiant ; un nom déjà pris rend le catalogue existant. */
    addCatalog: (label: string): string => {
      const name = label.trim().slice(0, 80);
      const existing = current().catalogs.find((catalog) => searchKey(catalog.label) === searchKey(name));
      if (existing) return existing.id;
      const id = newCatalogId();
      store.commit({ ...current(), catalogs: [...current().catalogs, { id, label: name }] });
      return id;
    },

    /** Supprime un catalogue personnel et retire les niches qu'il contenait. */
    removeCatalog: (catalogId: string) =>
      store.commit({
        catalogs: current().catalogs.filter((catalog) => catalog.id !== catalogId),
        niches: current().niches.filter((niche) => niche.catalogId !== catalogId),
      }),

    /** Range une niche dans un catalogue ; déjà présente, elle change seulement de catalogue. */
    addNiche: (name: string, catalogId: string) => {
      const clean = name.trim().slice(0, 200);
      const others = current().niches.filter((niche) => searchKey(niche.name) !== searchKey(clean));
      store.commit({ ...current(), niches: [{ name: clean, catalogId }, ...others].slice(0, MAX_OWN_NICHES) });
    },

    removeNiche: (name: string) =>
      store.commit({ ...current(), niches: current().niches.filter((niche) => searchKey(niche.name) !== searchKey(name)) }),
  };
}
