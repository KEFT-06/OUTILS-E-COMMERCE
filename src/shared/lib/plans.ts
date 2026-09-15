import { useEffect, useState } from 'react';
import { apiRequest } from '@/shared/lib/api';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import type { FeatureId, PlanCatalog, PlanDefinition } from '@/shared/types/auth';

/**
 * Paliers d'abonnement, servis par l'API (server/config/plans.json).
 *
 * Source unique : l'accueil, la page Compte et l'administration lisent la même
 * table, éditable sans redéployer. Aucun prix n'est écrit dans le code du site.
 */

let cache: PlanCatalog | null = null;
let pending: Promise<PlanCatalog> | null = null;

export function loadPlans(): Promise<PlanCatalog> {
  if (cache) return Promise.resolve(cache);
  pending ??= apiRequest<PlanCatalog>('/api/plans')
    .then((catalog) => {
      cache = catalog;
      return catalog;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function usePlans(): { catalog: PlanCatalog | null; error: ApiError | null } {
  const [catalog, setCatalog] = useState<PlanCatalog | null>(cache);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    loadPlans()
      .then((loaded) => {
        if (!cancelled) setCatalog(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'Les paliers n’ont pas pu être chargés.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { catalog, error };
}

export function formatPlanQuota(plan: Pick<PlanDefinition, 'monthlyCredits'>): string {
  return plan.monthlyCredits === null ? 'Points illimités' : `${plan.monthlyCredits} pts / mois`;
}

export function formatPlanPrice(plan: Pick<PlanDefinition, 'priceMonthlyFcfa'>): string {
  if (plan.priceMonthlyFcfa === null) return 'Prix à venir';
  if (plan.priceMonthlyFcfa === 0) return '0 FCFA';
  return `${plan.priceMonthlyFcfa.toLocaleString('fr-FR')} FCFA / mois`;
}

export function planIncludes(plan: PlanDefinition, feature: FeatureId): boolean {
  return plan.features[feature] ?? true;
}

/**
 * Montant en francs CFA. Le séparateur de milliers français est une espace fine
 * insécable (U+202F), que la police des titres n'affiche pas : on la remplace par
 * une espace insécable ordinaire, rendue par toutes les polices.
 */
export function formatFcfa(amount: number): string {
  return `${Math.round(amount).toLocaleString('fr-FR').replace(/ /g, ' ')} FCFA`;
}
