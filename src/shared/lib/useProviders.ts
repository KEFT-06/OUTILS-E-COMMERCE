import { useEffect, useState } from 'react';

export interface ServerProviders {
  /** Gemini : analyse, rédaction et traduction. */
  text: boolean;
  /** Higgsfield : visuels, vidéos et couvertures. */
  images: boolean;
  /** Recherche web des analyses de niche. */
  webSearch: boolean;
}

/** Fournisseurs configurés sur le serveur, lus sur /api/health, sans jamais voir de clé. null : pas encore connu. */
export function useProviders(): ServerProviders | null {
  const [providers, setProviders] = useState<ServerProviders | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { providers?: Record<string, boolean> } | null) => {
        if (!cancelled && data?.providers) {
          setProviders({
            text: Boolean(data.providers.text),
            images: Boolean(data.providers.video),
            webSearch: Boolean(data.providers.webSearch),
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return providers;
}
