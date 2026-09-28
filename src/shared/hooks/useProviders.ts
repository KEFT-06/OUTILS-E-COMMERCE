import { useEffect, useState } from 'react';

export interface ServerProviders {
  /** Analyse, rédaction et traduction. */
  text: boolean;
  /** Visuels et couvertures (Cloudflare ou Gemini). */
  images: boolean;
  /** Vidéos (Veo). */
  video: boolean;
  /** Recherche web des analyses de niche. */
  webSearch: boolean;
  /** Envoi des e-mails (mot de passe oublié, confirmation d'adresse). */
  email: boolean;
  /** Paiement en ligne des paliers. */
  payments: boolean;
  /** test : aucune carte réelle débitée ; null : paiement non configuré. */
  paymentMode: 'test' | 'live' | null;
}

/** Fournisseurs configurés sur le serveur, lus sur /api/health, sans jamais voir de clé. null : pas encore connu. */
export function useProviders(): ServerProviders | null {
  const [providers, setProviders] = useState<ServerProviders | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { providers?: Record<string, boolean>; paymentMode?: 'test' | 'live' | null } | null) => {
        if (!cancelled && data?.providers) {
          setProviders({
            text: Boolean(data.providers.text),
            // « images » est lu à part : il suivait l'indicateur vidéo du temps où un seul
            // fournisseur faisait les deux, et une couverture était refusée quand la vidéo l'était.
            images: Boolean(data.providers.image ?? data.providers.video),
            video: Boolean(data.providers.video),
            webSearch: Boolean(data.providers.webSearch),
            email: Boolean(data.providers.email),
            payments: Boolean(data.providers.payments),
            paymentMode: data.paymentMode ?? null,
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
