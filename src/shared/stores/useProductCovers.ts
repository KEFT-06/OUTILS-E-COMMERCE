import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { type CoverView, coversApi } from '@/shared/lib/covers';

/**
 * Illustrations de couverture des produits du compte, lues une fois pour tous les écrans.
 *
 * Chaque carte de produit montre sa couverture : une demande par carte aurait fait dix allers-
 * retours pour afficher une liste. Les illustrations sont lues d'un coup, gardées le temps de la
 * session, et mises à jour dès qu'une couverture est générée ou retirée.
 *
 * Un produit sans illustration n'est pas « sans couverture » : il porte une couverture
 * typographique (shared/components/BookCover). Cette liste ne dit que lesquels ont une image.
 */

let owner: string | null = null;
let covers: Record<string, CoverView> = {};
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => covers;

function load(accountId: string): void {
  if (owner === accountId && (loading || Object.keys(covers).length > 0)) return;
  if (owner !== accountId) {
    owner = accountId;
    covers = {};
    emit();
  }
  loading = coversApi
    .mine('product')
    .then((list) => {
      if (owner !== accountId) return;
      covers = Object.fromEntries(list.map((cover) => [cover.subjectId, cover]));
      emit();
    })
    .catch(() => {
      // Illisible pour l'instant : les couvertures typographiques tiennent lieu de tout, et la prochaine visite relira.
    })
    .finally(() => {
      loading = null;
    });
}

/** Une couverture vient d'être générée, remplacée ou retirée : toutes les cartes le voient. */
export function rememberProductCover(subjectId: string, cover: CoverView | null): void {
  const next = { ...covers };
  if (cover && cover.status === 'ready') next[subjectId] = cover;
  else if (!cover) delete next[subjectId];
  else return;
  covers = next;
  emit();
}

/** Adresse de l'illustration de chaque produit qui en a une, par identifiant de produit. */
export function useProductCovers(): Record<string, string> {
  const { account } = useAuth();
  const accountId = account?.id ?? null;
  const current = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (accountId) load(accountId);
  }, [accountId]);
  return Object.fromEntries(Object.entries(current).map(([subjectId, cover]) => [subjectId, coversApi.imageUrl(cover)]));
}
