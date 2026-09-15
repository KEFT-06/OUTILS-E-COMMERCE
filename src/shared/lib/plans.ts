import { useEffect, useState } from 'react';
import { formatMoney } from '@server/shared/currency';
import { apiRequest } from '@/shared/lib/api';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import type { FeatureId, PlanCatalog, PlanDefinition } from '@/shared/types/auth';

/**
 * Paliers d'abonnement, servis par l'API (server/config/plans.json), avec leurs
 * prix dans la devise du pays demandé.
 *
 * Source unique : l'accueil, la page Compte et l'administration lisent la même
 * table, éditable sans redéployer. Aucun prix n'est écrit dans le code du site.
 */

const cache = new Map<string, PlanCatalog>();
const pending = new Map<string, Promise<PlanCatalog>>();

/** `country` : pays dont on veut la devise ; absent, la devise du compte connecté (ou le dollar). */
export function loadPlans(country?: string | null): Promise<PlanCatalog> {
  const key = country ?? '';
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  let request = pending.get(key);
  if (!request) {
    request = apiRequest<PlanCatalog>(`/api/plans${country ? `?country=${encodeURIComponent(country)}` : ''}`)
      .then((catalog) => {
        // Sans pays, la devise dépend de la session : pas de cache.
        if (country) cache.set(key, catalog);
        return catalog;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return request;
}

export function usePlans(country?: string | null): { catalog: PlanCatalog | null; error: ApiError | null } {
  const [catalog, setCatalog] = useState<PlanCatalog | null>(() => cache.get(country ?? '') ?? null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadPlans(country)
      .then((loaded) => {
        if (!cancelled) setCatalog(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'Les paliers n’ont pas pu être chargés.'));
      });
    return () => {
      cancelled = true;
    };
  }, [country]);

  return { catalog, error };
}

export function formatPlanQuota(plan: Pick<PlanDefinition, 'monthlyCredits'>): string {
  return plan.monthlyCredits === null ? 'Points illimités' : `${plan.monthlyCredits} points / mois`;
}

export function formatPlanPrice(plan: Pick<PlanDefinition, 'price'>): string {
  if (!plan.price) return 'Prix à venir';
  if (plan.price.monthly === 0) return 'Gratuit';
  return formatMoney(plan.price.monthly, plan.price.currency);
}

export function planIncludes(plan: Pick<PlanDefinition, 'features'>, feature: FeatureId): boolean {
  return plan.features[feature] ?? true;
}

/** Montant en francs CFA, devise des statistiques de revenus de l'administration. */
export function formatFcfa(amount: number): string {
  return formatMoney(Math.round(amount), 'XAF');
}

export { formatMoney };
