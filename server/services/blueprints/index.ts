import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { env } from '@server/env';

/**
 * Structures de campagnes Meta et TikTok — feuille de route 5.4.
 *
 * Le cahier des charges exige que les valeurs vivent dans une table de
 * configuration. Deux contrôles au chargement protègent ce que la table affirme :
 *  - chaque objectif cité doit exister dans la nomenclature officielle de sa
 *    plateforme, telle que recopiée dans la table avec sa source ;
 *  - la répartition du budget d'une structure doit totaliser 100 %.
 * Une table qui échoue est refusée plutôt que d'afficher un plan incohérent.
 */

const objectiveSchema = z.object({
  id: z.string().min(1),
  officialName: z.string().min(1),
  category: z.string().min(1).optional(),
  purpose: z.string().min(1),
});

const platformSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  objectivesSource: z.string().url(),
  objectivesCheckedAt: z.string().min(1),
  objectives: z.array(objectiveSchema).min(1),
});

const ruleSchema = z.object({
  kind: z.enum(['cut', 'scale', 'watch']),
  description: z.string().min(1),
  /** Seuil exprimé en multiple du coût d'acquisition cible saisi par l'utilisateur. */
  cpaMultiplier: z.number().positive().optional(),
});

const phaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  objectiveId: z.string().min(1),
  fallbackObjectiveId: z.string().min(1).optional(),
  fallbackCondition: z.string().min(1).optional(),
  durationDays: z.number().int().positive(),
  budgetSharePercent: z.number().positive().max(100),
  structure: z.object({
    campaigns: z.number().int().positive(),
    adSets: z.number().int().positive(),
    adsPerAdSet: z.number().int().positive(),
  }),
  guidance: z.string().min(1),
  rules: z.array(ruleSchema),
});

const blueprintSchema = z.object({
  id: z.string().min(1),
  platform: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  prerequisites: z.array(z.string().min(1)),
  phases: z.array(phaseSchema).min(1),
});

const configSchema = z
  .object({
    version: z.string(),
    updatedAt: z.string(),
    note: z.string().optional(),
    valuesStatus: z.string().optional(),
    platforms: z.array(platformSchema).min(1),
    blueprints: z.array(blueprintSchema).min(1),
  })
  .superRefine((config, ctx) => {
    config.blueprints.forEach((blueprint, blueprintIndex) => {
      const platform = config.platforms.find((candidate) => candidate.id === blueprint.platform);
      if (!platform) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['blueprints', blueprintIndex, 'platform'],
          message: `plateforme inconnue « ${blueprint.platform} »`,
        });
        return;
      }

      const total = blueprint.phases.reduce((sum, phase) => sum + phase.budgetSharePercent, 0);
      if (Math.abs(total - 100) > 0.01) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['blueprints', blueprintIndex, 'phases'],
          message: `la répartition du budget totalise ${total} %, pas 100 %`,
        });
      }

      const objectiveIds = new Set(platform.objectives.map((objective) => objective.id));
      blueprint.phases.forEach((phase, phaseIndex) => {
        for (const key of ['objectiveId', 'fallbackObjectiveId'] as const) {
          const objectiveId = phase[key];
          if (objectiveId && !objectiveIds.has(objectiveId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['blueprints', blueprintIndex, 'phases', phaseIndex, key],
              message: `objectif « ${objectiveId} » absent de la nomenclature ${platform.label}`,
            });
          }
        }
      });
    });
  });

export type CampaignBlueprintConfig = z.infer<typeof configSchema>;

export class BlueprintsUnavailableError extends Error {
  constructor(
    readonly configPath: string,
    override readonly cause: unknown,
  ) {
    super('La table des structures de campagnes est introuvable ou invalide.');
    this.name = 'BlueprintsUnavailableError';
  }
}

const CONFIG_PATH = env.CAMPAIGN_BLUEPRINTS_PATH
  ? isAbsolute(env.CAMPAIGN_BLUEPRINTS_PATH)
    ? env.CAMPAIGN_BLUEPRINTS_PATH
    : resolve(process.cwd(), env.CAMPAIGN_BLUEPRINTS_PATH)
  : join(process.cwd(), 'server', 'config', 'campaign-blueprints.json');

let cache: CampaignBlueprintConfig | null = null;

export function reloadCampaignBlueprints(): void {
  cache = null;
}

export async function getCampaignBlueprints(): Promise<CampaignBlueprintConfig> {
  if (cache) return cache;

  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    cache = configSchema.parse(JSON.parse(raw));
    return cache;
  } catch (cause) {
    throw new BlueprintsUnavailableError(CONFIG_PATH, cause);
  }
}
