import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '@/shared/lib/api';

/**
 * Nombre d'alertes arrivées depuis la dernière ouverture du fil : le chiffre de la cloche.
 * Même économie que la pastille du radar : un entier, relu au plus toutes les trois minutes,
 * et un seul appel partagé par la barre du haut et la barre latérale.
 */

const PARTAGE_MS = 3 * 60_000;

let cache: { at: number; value: number } | null = null;
let enCours: Promise<number> | null = null;
const abonnes = new Set<(value: number) => void>();

async function lireCompteur(): Promise<number> {
  if (cache && Date.now() - cache.at < PARTAGE_MS) return cache.value;
  enCours ??= apiRequest<{ unread: number }>('/api/alerts/unread')
    .then((payload) => {
      cache = { at: Date.now(), value: payload.unread };
      for (const notifier of abonnes) notifier(payload.unread);
      return payload.unread;
    })
    // La cloche est un repère : si l'appel échoue, elle garde sa valeur sans bruit.
    .catch(() => cache?.value ?? 0)
    .finally(() => {
      enCours = null;
    });
  return enCours;
}

/** Le fil vient d'être ouvert : la cloche s'éteint tout de suite. */
export function resetAlertsUnread(): void {
  cache = { at: Date.now(), value: 0 };
  for (const notifier of abonnes) notifier(0);
}

export function useAlertsUnread(): number {
  const [unread, setUnread] = useState(() => cache?.value ?? 0);
  const { pathname } = useLocation();

  useEffect(() => {
    abonnes.add(setUnread);
    void lireCompteur().then(setUnread);
    return () => {
      abonnes.delete(setUnread);
    };
  }, [pathname]);

  return unread;
}
