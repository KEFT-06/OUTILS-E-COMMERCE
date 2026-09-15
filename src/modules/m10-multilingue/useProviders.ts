import { useEffect, useState } from 'react';

/** Fournisseurs configurés sur le serveur, lus sur /api/health : traduction (Gemini) et images (Higgsfield). */
export function useProviders(): { text: boolean; images: boolean } | null {
  const [providers, setProviders] = useState<{ text: boolean; images: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { providers?: Record<string, boolean> } | null) => {
        if (!cancelled && data?.providers) setProviders({ text: Boolean(data.providers.text), images: Boolean(data.providers.video) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return providers;
}
