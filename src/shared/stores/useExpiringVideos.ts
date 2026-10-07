import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '@/shared/lib/api';

/**
 * Vidéos du compte qui seront supprimées dans les 48 heures : la pastille de « Mes créations ».
 * Même économie que la cloche des alertes : un entier, relu au plus toutes les dix minutes, et un
 * seul appel partagé par tout ce qui l'affiche.
 */

const PARTAGE_MS = 10 * 60_000;

let cache: { at: number; value: number } | null = null;
let enCours: Promise<number> | null = null;
const abonnes = new Set<(value: number) => void>();

async function lireCompteur(): Promise<number> {
  if (cache && Date.now() - cache.at < PARTAGE_MS) return cache.value;
  enCours ??= apiRequest<{ expiring: number }>('/api/creatives/expiring')
    .then((payload) => {
      cache = { at: Date.now(), value: payload.expiring };
      for (const notifier of abonnes) notifier(payload.expiring);
      return payload.expiring;
    })
    // Un repère : si l'appel échoue, la pastille garde sa valeur sans bruit.
    .catch(() => cache?.value ?? 0)
    .finally(() => {
      enCours = null;
    });
  return enCours;
}

/** L'écran vient de lire les vidéos : la pastille est relue sans attendre. */
export function refreshExpiringVideos(): void {
  cache = null;
  void lireCompteur();
}

export function useExpiringVideos(): number {
  const [expiring, setExpiring] = useState(() => cache?.value ?? 0);
  const { pathname } = useLocation();

  useEffect(() => {
    abonnes.add(setExpiring);
    void lireCompteur().then(setExpiring);
    return () => {
      abonnes.delete(setExpiring);
    };
  }, [pathname]);

  return expiring;
}
