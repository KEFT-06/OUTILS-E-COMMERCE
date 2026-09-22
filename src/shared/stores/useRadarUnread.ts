import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '@/shared/lib/api';

/**
 * Nombre d'événements du radar pas encore lus, pour la pastille de la barre latérale.
 *
 * Le radar relève pendant que personne ne regarde : sans cette pastille, un utilisateur
 * n'a aucune raison d'ouvrir l'écran, et le travail de la nuit reste invisible.
 *
 * Deux précautions de coût : la réponse du serveur est un seul entier, et la relecture ne
 * se fait qu'à un changement d'adresse — pas sur un minuteur. Une pastille qui interroge
 * le serveur toutes les dix secondes coûterait plus cher que le balayage lui-même.
 */
export function useRadarUnread(): number {
  const [unread, setUnread] = useState(0);
  const { pathname } = useLocation();

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ unread: number }>('/api/radar/unread')
      .then((payload) => {
        if (!cancelled) setUnread(payload.unread);
      })
      // Une pastille est un ornement : si l'appel échoue, elle reste à zéro sans bruit.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return unread;
}
