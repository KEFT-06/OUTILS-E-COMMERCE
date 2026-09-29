import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '@/shared/lib/api';

/**
 * Nombre d'événements du radar pas encore lus, pour les pastilles de navigation.
 *
 * Le radar relève pendant que personne ne regarde : sans pastille, un utilisateur n'a aucune
 * raison d'ouvrir l'écran, et le travail de la nuit reste invisible.
 *
 * Trois précautions de coût, parce que ce compteur est lu par la barre latérale ET par la barre
 * mobile, à chaque changement d'adresse :
 *   · la réponse du serveur est un seul entier ;
 *   · la relecture suit la navigation, jamais un minuteur — une pastille qui interroge le serveur
 *     toutes les dix secondes coûterait plus cher que le balayage lui-même ;
 *   · une réponse sert trois minutes : le radar relève une fois par nuit, et relire à chaque
 *     changement d'écran ajoutait un aller-retour au serveur pour une valeur qui ne bouge pas.
 *     L'ouverture du radar remet la pastille à zéro sans attendre (resetRadarUnread) ;
 *   · l'appel est mutualisé entre les deux barres. Sans cela, chaque navigation en déclencherait
 *     deux, pour la même réponse.
 */

/** Durée pendant laquelle une réponse sert à toutes les navigations. */
const PARTAGE_MS = 3 * 60_000;

let cache: { at: number; value: number } | null = null;
let enCours: Promise<number> | null = null;
const abonnes = new Set<(value: number) => void>();

async function lireCompteur(): Promise<number> {
  if (cache && Date.now() - cache.at < PARTAGE_MS) return cache.value;
  // Un appel déjà parti sert aux deux barres : la seconde attend la même promesse.
  enCours ??= apiRequest<{ unread: number }>('/api/radar/unread')
    .then((payload) => {
      cache = { at: Date.now(), value: payload.unread };
      for (const notifier of abonnes) notifier(payload.unread);
      return payload.unread;
    })
    // Une pastille est un ornement : si l'appel échoue, elle reste à sa valeur sans bruit.
    .catch(() => cache?.value ?? 0)
    .finally(() => {
      enCours = null;
    });
  return enCours;
}

/** Les événements viennent d'être marqués lus : la pastille s'éteint tout de suite. */
export function resetRadarUnread(): void {
  cache = { at: Date.now(), value: 0 };
  for (const notifier of abonnes) notifier(0);
}

export function useRadarUnread(): number {
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
