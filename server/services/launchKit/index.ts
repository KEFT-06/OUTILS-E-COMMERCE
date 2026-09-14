import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { env } from '@server/env';

/**
 * Kit de lancement — feuille de route 5.1.
 *
 * Table de configuration contrôlée au chargement :
 *  - chaque script couvre sa durée sans trou ni chevauchement (le premier temps
 *    fort commence à 0, chacun commence où le précédent s'arrête, le dernier
 *    finit à la durée annoncée) ;
 *  - les recommandations de boutons ne visent que des objectifs connus.
 * Une table incohérente est refusée plutôt que d'afficher un script faux.
 */

const OBJECTIVES = ['sales', 'leads', 'traffic'] as const;

const buttonSchema = z.object({
  id: z.string().min(1),
  officialName: z.string().min(1),
  recommendedFor: z.array(z.enum(OBJECTIVES)),
});

const ctaPlatformSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  source: z.string().url(),
  checkedAt: z.string().min(1),
  buttons: z.array(buttonSchema).min(1),
});

const beatSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  startSecond: z.number().int().min(0),
  endSecond: z.number().int().positive(),
  purpose: z.string().min(1),
});

const scriptFormatSchema = z
  .object({
    durationSeconds: z.number().int().positive(),
    label: z.string().min(1),
    beats: z.array(beatSchema).min(1),
  })
  .superRefine((format, ctx) => {
    let expectedStart = 0;
    format.beats.forEach((beat, index) => {
      if (beat.startSecond !== expectedStart || beat.endSecond <= beat.startSecond) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['beats', index],
          message: `script de ${format.durationSeconds} s : « ${beat.label} » devrait commencer à ${expectedStart} s et finir après son début`,
        });
      }
      expectedStart = beat.endSecond;
    });
    if (expectedStart !== format.durationSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beats'],
        message: `script de ${format.durationSeconds} s : le découpage s'arrête à ${expectedStart} s`,
      });
    }
  });

const configSchema = z.object({
  version: z.string(),
  updatedAt: z.string(),
  note: z.string().optional(),
  valuesStatus: z.string().optional(),
  voiceOverWordsPerSecond: z.number().positive(),
  ctaPlatforms: z.array(ctaPlatformSchema).min(1),
  scriptFormats: z.array(scriptFormatSchema).min(1),
});

export type LaunchKitConfig = z.infer<typeof configSchema>;

export class LaunchKitUnavailableError extends Error {
  constructor(
    readonly configPath: string,
    override readonly cause: unknown,
  ) {
    super('La table du kit de lancement est introuvable ou invalide.');
    this.name = 'LaunchKitUnavailableError';
  }
}

const CONFIG_PATH = env.LAUNCH_KIT_PATH
  ? isAbsolute(env.LAUNCH_KIT_PATH)
    ? env.LAUNCH_KIT_PATH
    : resolve(process.cwd(), env.LAUNCH_KIT_PATH)
  : join(process.cwd(), 'server', 'config', 'launch-kit.json');

let cache: LaunchKitConfig | null = null;

export function reloadLaunchKit(): void {
  cache = null;
}

export async function getLaunchKitConfig(): Promise<LaunchKitConfig> {
  if (cache) return cache;

  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    cache = configSchema.parse(JSON.parse(raw));
    return cache;
  } catch (cause) {
    throw new LaunchKitUnavailableError(CONFIG_PATH, cause);
  }
}
