import { useEffect } from 'react';

/**
 * Mesure d'audience sans cookie : une visite par affichage d'une page publique.
 * Le refus de suivi du navigateur (Do Not Track, Global Privacy Control) est
 * respecté ici et par le serveur ; aucun identifiant n'est gardé dans le navigateur.
 */
export function useTrackVisit(path: string) {
  useEffect(() => {
    try {
      const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
      if (privacy.doNotTrack === '1' || privacy.globalPrivacyControl) return;
      void fetch('/api/audience/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, ...(document.referrer ? { referrer: document.referrer } : {}) }),
        credentials: 'omit',
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // Mesure facultative : un échec ne doit jamais gêner la page.
    }
  }, [path]);
}
