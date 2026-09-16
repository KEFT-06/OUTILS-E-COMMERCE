import { useEffect, useState } from 'react';
import { PricingConfig } from '@/shared/types/pricing';

/**
 * Charge les fourchettes de prix servies par l'API (CdC §2).
 *
 * Volontairement sans valeurs de repli : un repli codé en dur reproduirait
 * exactement ce que le cahier des charges interdit — des bornes figées dans le
 * bundle, impossibles à corriger sans redéploiement, et qui divergeraient
 * silencieusement de la table de référence. Tant que la table n'est pas
 * chargée, l'écran doit le dire au lieu d'inventer une échelle.
 */

let pricingCache: PricingConfig | null = null;

interface PricingState {
  pricing: PricingConfig | null;
  isLoading: boolean;
  error: string | null;
}

export function usePricing(): PricingState {
  const [pricing, setPricing] = useState<PricingConfig | null>(pricingCache);
  const [isLoading, setIsLoading] = useState<boolean>(!pricingCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pricingCache) return;

    let cancelled = false;

    fetch('/api/pricing/ranges')
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(
            payload?.error?.message ?? `La table des prix a répondu ${response.status}.`,
          );
        }
        return (await response.json()) as PricingConfig;
      })
      .then((config) => {
        if (cancelled) return;
        pricingCache = config;
        setPricing(config);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Fourchettes de prix indisponibles.');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { pricing, isLoading, error };
}
