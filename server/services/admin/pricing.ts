import { AD_FRAMEWORKS } from '@server/shared/adFrameworks';
import { getCostTable } from '@server/services/credits';
import { FEATURES, getPlanConfig, type FeatureId } from '@server/services/plans';

/**
 * Grille tarifaire complète, pour l'administration.
 *
 * Elle rassemble en un seul endroit les deux tables qui décident de ce que rapporte le produit :
 * ce qu'un palier DONNE (quota de points, limites, fonctions) et ce que chaque action COÛTE en
 * points. Elles vivaient dans deux fichiers de configuration que personne ne pouvait consulter
 * depuis le site — donc que personne ne relisait.
 *
 * Lecture seule, et c'est volontaire : ces fichiers sont modifiables sans redéploiement, mais
 * une grille éditée depuis une page web finirait par l'être sans trace ni relecture. On montre,
 * on ne modifie pas.
 */

export interface PricingOverview {
  version: string;
  updatedAt: string;
  /** Avertissement du fichier quand les valeurs ne sont pas encore validées commercialement. */
  status: string | null;
  baseCurrency: string;
  /** Mois facturés pour un an payé d'avance (10 : deux mois offerts). */
  yearlyMonthsCharged: number;
  /** Valeur d'un point, et son état de validation. */
  point: { value: number; currency: string; status: string | null };
  features: Record<string, string>;
  /** Méthodes publicitaires existantes : sert à lire la limite `adFrameworks`. */
  adFrameworksTotal: number;
  plans: {
    id: string;
    label: string;
    tagline: string | null;
    highlight: boolean;
    /** null : illimité. */
    monthlyCredits: number | null;
    /** Prix fixés dans le fichier, devise par devise. Vide : palier sans prix. */
    prices: { currency: string; monthly: number }[];
    limits: Record<string, number | null>;
    /** Fonctions fermées à ce palier, avec leur libellé lisible. */
    closedFeatures: { id: string; label: string }[];
  }[];
  actions: { id: string; label: string; cost: number; perUnit: number | null; unitLabel: string | null }[];
}

export async function pricingOverview(): Promise<PricingOverview> {
  const config = await getPlanConfig();
  const costs = await getCostTable();

  return {
    version: config.version,
    updatedAt: config.updatedAt,
    status: config.pricing.status ?? null,
    baseCurrency: config.pricing.baseCurrency,
    yearlyMonthsCharged: config.pricing.yearlyMonthsCharged,
    point: { value: costs.pointValue, currency: costs.currency, status: costs.pointValueStatus ?? null },
    features: FEATURES,
    adFrameworksTotal: AD_FRAMEWORKS.length,
    plans: config.plans.map((plan) => ({
      id: plan.id,
      label: plan.label,
      tagline: plan.tagline ?? null,
      highlight: plan.highlight ?? false,
      monthlyCredits: plan.monthlyCredits,
      prices: Object.entries(plan.prices ?? {}).map(([currency, monthly]) => ({ currency, monthly })),
      limits: plan.limits as unknown as Record<string, number | null>,
      // On liste ce qui est FERMÉ : c'est la courte liste, et c'est celle qui porte la décision.
      closedFeatures: Object.entries(plan.features)
        .filter(([, ouvert]) => ouvert === false)
        .map(([id]) => ({ id, label: FEATURES[id as FeatureId] ?? id })),
    })),
    actions: costs.actions.map((action) => ({
      id: action.id,
      label: action.label,
      cost: action.cost,
      perUnit: action.perUnit ?? null,
      unitLabel: action.unitLabel ?? null,
    })),
  };
}
