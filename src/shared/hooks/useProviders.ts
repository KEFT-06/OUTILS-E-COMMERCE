import { useEffect, useState } from 'react';
import { apiRequest } from '@/shared/lib/api';
import { lastKnown, remember } from '@/shared/lib/apiCache';

export interface ServerProviders {
  /** Analyse et rédaction. */
  text: boolean;
  /** Recherche web des analyses de niche. */
  webSearch: boolean;
  /** Envoi des e-mails (mot de passe oublié, confirmation d'adresse). */
  email: boolean;
  /** Paiement en ligne des paliers. */
  payments: boolean;
  /** « Continuer avec Google » à la connexion et à l'inscription. */
  googleAuth: boolean;
  /** Lecture à voix haute du parcours audio. */
  speech: boolean;
  /** Plusieurs voix proposées (Gemini) ; sinon une seule voix française (Cloudflare). */
  voiceChoice: boolean;
  /** test : aucune carte réelle débitée ; null : paiement non configuré. */
  paymentMode: 'test' | 'live' | null;
  /** Mobile Money : test (bac à sable), live, ou null quand il n'est pas configuré. */
  mobileMoneyMode: 'test' | 'live' | null;
}

const KNOWN = 'fournisseurs';

/** Fournisseurs configurés sur le serveur, lus sur /api/health, sans jamais voir de clé. null : pas encore connu. */
export function useProviders(): ServerProviders | null {
  // Dernier état connu pendant la visite : les boutons ne repassent pas par « inconnu » à chaque écran.
  const [providers, setProviders] = useState<ServerProviders | null>(() => lastKnown<ServerProviders>(KNOWN));

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ providers?: Record<string, boolean>; paymentMode?: 'test' | 'live' | null; mobileMoneyMode?: 'test' | 'live' | null }>('/api/health')
      .catch(() => null)
      .then((data) => {
        if (!cancelled && data?.providers) {
          const next: ServerProviders = {
            text: Boolean(data.providers.text),
            webSearch: Boolean(data.providers.webSearch),
            email: Boolean(data.providers.email),
            payments: Boolean(data.providers.payments),
            googleAuth: Boolean(data.providers.googleAuth),
            // Ancien serveur, sans l'indicateur : la voix suivait la rédaction, avec son choix de voix.
            speech: Boolean(data.providers.speech ?? data.providers.text),
            voiceChoice: Boolean(data.providers.voiceChoice ?? true),
            paymentMode: data.paymentMode ?? null,
            mobileMoneyMode: data.mobileMoneyMode ?? null,
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
