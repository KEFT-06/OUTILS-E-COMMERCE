import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { PLAN_IDS, type PlanId } from '@server/db/schema';
import { env } from '@server/env';
import { convertAmount, type RatesSnapshot } from '@server/services/currency';
import { AD_FRAMEWORKS } from '@server/shared/adFrameworks';
import { roundPrice } from '@server/shared/currency';

/**
 * Paliers d'abonnement : quota mensuel de points, prix, limites et fonctions ouvertes.
 *
 * Même règle que la grille tarifaire et la table de conformité : un fichier de
 * configuration externe, éditable sans redéployer. Le code ne fige aucun prix.
 */

export const FEATURES = {
  niche_analysis: 'Analyse stratégique',
  ai_writing: 'Rédaction par IA',
  image_generation: 'Visuels publicitaires',
  video_generation: 'Vidéos publicitaires',
  storybook_generation: 'Storybook illustré',
  affiliate_invitations: 'Invitations d’affiliés',
  guide_translation: 'Guides multilingues',
  native_review: 'Relecture par un locuteur natif',
  /**
   * Déclencher une mesure de marché neuve. LIRE une mesure déjà en cache reste ouvert à tous :
   * elle est mutualisée et ne coûte rien de plus. C'est la COLLECTE qui se paie chez le
   * fournisseur — sans cette porte, un compte gratuit consommerait la réserve mensuelle du
   * serveur, au détriment des comptes qui la financent.
   */
  market_benchmark: 'Mesure de marché d’une niche',
} as const;

export type FeatureId = keyof typeof FEATURES;

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

export function isFeature(value: string): value is FeatureId {
  return Object.hasOwn(FEATURES, value);
}

const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'Code de devise ISO 4217 attendu (ex. XAF).');

/**
 * Longueur maximale d'un ebook, tous paliers confondus. Au-delà, la cohérence d'ensemble
 * se dégrade (répétitions, plan qui se délite) et le temps de rédaction devient tel que
 * l'auteur abandonne avant la fin.
 */
export const EBOOK_PAGES_CEILING = 250;

/** Mots par page d'ebook au format A4, corps de texte aéré : sert à convertir pages ⇄ mots. */
export const WORDS_PER_PAGE = 300;

const limitsSchema = z.object({
  /** Niches qu'un compte peut enregistrer ; null : illimité. */
  savedNiches: z.number().int().min(0).nullable(),
  /**
   * Annonces visibles sur le mur d'espionnage ; null : tout le mur.
   *
   * Bridé et non fermé, délibérément. Le mur est la donnée la plus chère du produit, mais un
   * écran vide ne convainc personne de payer : un compte gratuit doit VOIR que les annonces
   * existent, leur ancienneté et leurs accroches, et buter sur la quantité. La collecte, elle,
   * est mutualisée : montrer six annonces de plus à un visiteur ne coûte rien de plus.
   */
  spiedAdsVisible: z.number().int().min(0).nullable(),
  /**
   * Boutiques suivies par le radar ; 0 : pas d'accès au radar, null : illimité.
   *
   * Borne le nombre de cibles, jamais le nombre de relevés : un radar facturé au passage
   * serait coupé par son propriétaire, et une surveillance coupée perd son historique —
   * c'est-à-dire tout ce qui fait sa valeur.
   */
  watchedStores: z.number().int().min(0).nullable(),
  /** Méthodes publicitaires ouvertes, dans l'ordre de server/shared/adFrameworks.ts ; null : toutes. */
  adFrameworks: z.number().int().min(0).max(AD_FRAMEWORKS.length).nullable(),
  /** Langues de traduction par guide ; null : illimité. */
  guideLanguages: z.number().int().min(0).nullable(),
  /**
   * Pages au plus pour un ebook rédigé par l'IA. Le plafond absolu de 250 vaut pour tous
   * les paliers : au-delà, la rédaction perd le fil et le lecteur aussi. Jamais null —
   * un ebook « illimité » n'aurait aucun sens et coûterait sans borne.
   */
  ebookPages: z.number().int().min(1).max(EBOOK_PAGES_CEILING),
});

const planSchema = z.object({
  id: z.enum(PLAN_IDS),
  label: z.string().min(1),
  tagline: z.string().optional(),
  /** null : illimité. */
  monthlyCredits: z.number().int().min(0).nullable(),
  /** Prix mensuel par devise ; null : prix pas encore fixé. */
  prices: z.record(currencyCode, z.number().min(0)).nullable(),
  highlight: z.boolean().optional(),
  limits: limitsSchema,
  features: z.record(z.boolean()).default({}),
});

const configSchema = z
  .object({
    version: z.string(),
    updatedAt: z.string(),
    note: z.string().optional(),
    pricing: z.object({
      baseCurrency: currencyCode,
      /** Mois facturés pour un an payé d'avance (10 : deux mois offerts). */
      yearlyMonthsCharged: z.number().int().min(1).max(12),
      status: z.string().optional(),
    }),
    plans: z.array(planSchema),
  })
  .refine((config) => PLAN_IDS.every((id) => config.plans.some((plan) => plan.id === id)), {
    message: 'Chaque palier connu de la base doit figurer dans le fichier.',
  })
  .refine((config) => config.plans.every((plan) => !plan.prices || config.pricing.baseCurrency in plan.prices), {
    message: 'Un palier dont le prix est fixé doit indiquer ce prix dans la devise de base.',
  });

export type PlanDefinition = z.infer<typeof planSchema>;
export type PlanLimits = z.infer<typeof limitsSchema>;
export type PlanConfig = z.infer<typeof configSchema>;

export const UNLIMITED: PlanLimits = {
  savedNiches: null,
  watchedStores: null,
  spiedAdsVisible: null,
  adFrameworks: null,
  guideLanguages: null,
  ebookPages: EBOOK_PAGES_CEILING,
};

export class PlansUnavailableError extends Error {
  constructor(
    readonly configPath: string,
    override readonly cause: unknown,
  ) {
    super('La table des paliers est introuvable ou invalide.');
    this.name = 'PlansUnavailableError';
  }
}

const CONFIG_PATH = env.PLANS_PATH
  ? isAbsolute(env.PLANS_PATH)
    ? env.PLANS_PATH
    : resolve(process.cwd(), env.PLANS_PATH)
  : join(process.cwd(), 'server', 'config', 'plans.json');

let cache: PlanConfig | null = null;

export async function getPlanConfig(): Promise<PlanConfig> {
  if (cache) return cache;
  try {
    cache = configSchema.parse(JSON.parse(await readFile(CONFIG_PATH, 'utf8')));
    return cache;
  } catch (cause) {
    throw new PlansUnavailableError(CONFIG_PATH, cause);
  }
}

export async function getPlan(id: PlanId): Promise<PlanDefinition> {
  const config = await getPlanConfig();
  return config.plans.find((plan) => plan.id === id) ?? config.plans[0]!;
}

/** Fonctions ouvertes par le palier, corrigées par les accès accordés ou retirés au compte. */
export function resolveFeatures(
  plan: PlanDefinition,
  overrides: readonly { feature: string; access: 'granted' | 'revoked' }[],
): Record<FeatureId, boolean> {
  const resolved = Object.fromEntries(FEATURE_IDS.map((id) => [id, plan.features[id] ?? true])) as Record<FeatureId, boolean>;
  for (const override of overrides) {
    if (isFeature(override.feature)) resolved[override.feature] = override.access === 'granted';
  }
  return resolved;
}

export interface PlanPrice {
  currency: string;
  monthly: number;
  /** Un an payé d'avance. */
  yearly: number;
  /** Converti depuis la devise de base (sinon : prix fixé dans cette devise). */
  converted: boolean;
}

/** Prix d'un palier dans une devise ; null si le prix n'est pas fixé ou si la devise n'a pas de taux. */
export function planPrice(plan: PlanDefinition, config: PlanConfig, currency: string, rates: RatesSnapshot): PlanPrice | null {
  if (!plan.prices) return null;
  const { baseCurrency, yearlyMonthsCharged } = config.pricing;
  const explicit = plan.prices[currency];
  const base = plan.prices[baseCurrency] ?? 0;

  let monthly: number;
  let converted = false;
  if (explicit !== undefined) {
    monthly = explicit;
  } else if (base === 0) {
    monthly = 0;
  } else {
    const value = convertAmount(base, baseCurrency, currency, rates);
    if (value === null) return null;
    monthly = roundPrice(value, currency);
    converted = true;
  }

  const yearly = monthly === 0 ? 0 : roundPrice(monthly * yearlyMonthsCharged, currency);
  return { currency, monthly, yearly, converted };
}

/** Utilisé par les tests et par un rechargement à chaud. */
export function reloadPlans(): void {
  cache = null;
}
