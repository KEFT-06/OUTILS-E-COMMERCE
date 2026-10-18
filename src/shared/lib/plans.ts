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

export interface PointValue {
  /** Valeur d'un point, dans la devise du catalogue. */
  value: number;
  currency: string;
  /** Palier sur lequel elle est calculée : celui du compte, ou le premier palier payant. */
  planLabel: string;
  /** Vrai quand c'est le palier du compte. */
  ownPlan: boolean;
}

/**
 * Ce que vaut un point : le prix mensuel d'un palier divisé par son quota de points.
 *
 * L'écran annonçait « 60 points · équivalent 15 000 FCFA » au palier Pro, qui coûte 9 900 FCFA pour
 * ces 60 points (relevé le 18/10/2026) : la valeur venait d'un prix du point provisoire, que la
 * grille elle-même disait « pas encore validé commercialement ». La valeur se lit désormais sur le
 * prix réellement payé. Palier gratuit ou illimité : celle du premier palier payant.
 */
export function pointValueOf(catalog: PlanCatalog | null, planId: string | undefined): PointValue | null {
  if (!catalog) return null;
  const parPoint = (plan: PlanDefinition) => (plan.price && plan.price.monthly > 0 && plan.monthlyCredits ? plan.price.monthly / plan.monthlyCredits : null);
  const own = catalog.plans.find((plan) => plan.id === planId);
  const ownValue = own ? parPoint(own) : null;
  if (own?.price && ownValue !== null) return { value: ownValue, currency: own.price.currency, planLabel: own.label, ownPlan: true };
  const premier = catalog.plans.filter((plan) => parPoint(plan) !== null).sort((a, b) => a.price!.monthly - b.price!.monthly)[0];
  return premier?.price ? { value: parPoint(premier)!, currency: premier.price.currency, planLabel: premier.label, ownPlan: false } : null;
}
