import { useEffect, useState } from 'react';
import { lastKnown, remember } from '@/shared/lib/apiCache';

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
  /** « Continuer avec Google » à la connexion et à l'inscription. */
  googleAuth: boolean;
  /** test : aucune carte réelle débitée ; null : paiement non configuré. */
  paymentMode: 'test' | 'live' | null;
}

const KNOWN = 'fournisseurs';

/** Fournisseurs configurés sur le serveur, lus sur /api/health, sans jamais voir de clé. null : pas encore connu. */
export function useProviders(): ServerProviders | null {
  // Dernier état connu pendant la visite : les boutons ne repassent pas par « inconnu » à chaque écran.
  const [providers, setProviders] = useState<ServerProviders | null>(() => lastKnown<ServerProviders>(KNOWN));

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { providers?: Record<string, boolean>; paymentMode?: 'test' | 'live' | null } | null) => {
        if (!cancelled && data?.providers) {
          const next: ServerProviders = {
            text: Boolean(data.providers.text),
            // « images » est lu à part : il suivait l'indicateur vidéo du temps où un seul
            // fournisseur faisait les deux, et une couverture était refusée quand la vidéo l'était.
            images: Boolean(data.providers.image ?? data.providers.video),
            video: Boolean(data.providers.video),
            webSearch: Boolean(data.providers.webSearch),
            email: Boolean(data.providers.email),
            payments: Boolean(data.providers.payments),
            googleAuth: Boolean(data.providers.googleAuth),
            paymentMode: data.paymentMode ?? null,
          };
          remember(KNOWN, next);
          setProviders(next);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return providers;
}
