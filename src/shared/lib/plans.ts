import type { PlanId } from '@/shared/types/auth';

/**
 * Les cinq paliers d'abonnement et leur quota mensuel de points de recherche.
 *
 * Source unique : la page Compte, l'accueil et le profil de démonstration lisent
 * cette liste. Les prix ne figurent pas ici tant qu'ils ne sont pas fixés.
 */
export interface Plan {
  id: PlanId;
  /** Points de recherche par mois ; null = illimité. */
  monthlyPoints: number | null;
  includesVideo: boolean;
  note?: string;
}

export const PLANS: readonly Plan[] = [
  { id: 'Gratuit', monthlyPoints: 3, includesVideo: false, note: 'aperçu' },
  { id: 'Plus', monthlyPoints: 20, includesVideo: false },
  { id: 'Pro', monthlyPoints: 60, includesVideo: false },
  { id: 'Max', monthlyPoints: 60, includesVideo: true },
  { id: 'Elite Enterprise', monthlyPoints: null, includesVideo: true },
];

export function planOf(id: PlanId): Plan {
  return PLANS.find((plan) => plan.id === id) ?? PLANS[0];
}

export function formatPlanQuota(plan: Plan): string {
  if (plan.monthlyPoints === null) return 'Illimité';
  const base = `${plan.monthlyPoints} pts / mois`;
  if (plan.includesVideo) return `${base} + vidéo`;
  return plan.note ? `${base} (${plan.note})` : base;
}
