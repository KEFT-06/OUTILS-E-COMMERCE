import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { PLAN_IDS, type PlanId } from '@server/db/schema';
import { env } from '@server/env';

/**
 * Paliers d'abonnement : quota mensuel de points, prix et fonctions ouvertes.
 *
 * Même règle que la grille tarifaire et la table de conformité : un fichier de
 * configuration externe, éditable sans redéployer. Le code ne fige aucun prix.
 */

export const FEATURES = {
  niche_analysis: 'Analyse stratégique',
  radar_scan: 'Radar marché',
  ad_gallery_scan: 'Collecte de publicités',
  image_generation: 'Visuels publicitaires',
  video_generation: 'Vidéos publicitaires',
  storybook_generation: 'Storybook illustré',
  affiliate_invitations: 'Invitations d’affiliés',
} as const;

export type FeatureId = keyof typeof FEATURES;

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

export function isFeature(value: string): value is FeatureId {
  return Object.hasOwn(FEATURES, value);
}

const planSchema = z.object({
  id: z.enum(PLAN_IDS),
  label: z.string().min(1),
  /** null : illimité. */
  monthlyCredits: z.number().int().min(0).nullable(),
  /** null : prix pas encore fixé. */
  priceMonthlyFcfa: z.number().int().min(0).nullable(),
  highlight: z.boolean().optional(),
  features: z.record(z.boolean()).default({}),
});

const configSchema = z
  .object({
    version: z.string(),
    updatedAt: z.string(),
    note: z.string().optional(),
    currency: z.string().min(1),
    plans: z.array(planSchema),
  })
  .refine((config) => PLAN_IDS.every((id) => config.plans.some((plan) => plan.id === id)), {
    message: 'Chaque palier connu de la base doit figurer dans le fichier.',
  });

export type PlanDefinition = z.infer<typeof planSchema>;
export type PlanConfig = z.infer<typeof configSchema>;

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

/** Utilisé par les tests et par un rechargement à chaud. */
export function reloadPlans(): void {
  cache = null;
}
