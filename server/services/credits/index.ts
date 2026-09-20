import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { env } from '@server/env';
import { AppError } from '@server/middleware';

/**
 * Grille tarifaire des research points — module 8 du cahier des charges.
 *
 * Différenciateur n°3 : l'utilisateur doit voir ce qu'une action va lui coûter
 * **avant** de la déclencher, en points et en monnaie. Un solde qui baisse sans
 * que l'on sache pourquoi est la première cause de défiance sur ce type d'outil.
 *
 * Comme la table de conformité, la grille vit dans un fichier de configuration
 * externe : les prix changent sans que le code change.
 */

const actionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  cost: z.number().int().min(0),
  /**
   * Quantité couverte par `cost`, pour une action dont le prix suit la taille demandée
   * (un ebook de 200 pages coûte plus qu'un de 20). Absent : prix unique par action.
   * Toute tranche entamée est due : c'est ce que le simulateur annonce avant le lancement.
   */
  perUnit: z.number().int().positive().optional(),
  /** Ce que compte `perUnit`, tel qu'affiché : « pages »… */
  unitLabel: z.string().min(1).optional(),
  description: z.string().min(1),
});

const configSchema = z.object({
  version: z.string(),
  updatedAt: z.string(),
  note: z.string().optional(),
  currency: z.string().min(1),
  pointValueFcfa: z.number().positive(),
  pointValueStatus: z.string().optional(),
  actions: z.array(actionSchema).min(1),
});

export type CreditAction = z.infer<typeof actionSchema>;
export type CreditConfig = z.infer<typeof configSchema>;

/**
 * Levée quand la grille est introuvable ou invalide.
 * Traduite en 503 : sans grille, on ne peut pas annoncer de coût, et une action
 * facturée dont on n'a pas pu annoncer le prix n'est pas acceptable.
 */
export class CreditConfigUnavailableError extends Error {
  constructor(
    readonly configPath: string,
    override readonly cause: unknown,
  ) {
    super(
      "La grille tarifaire est introuvable ou invalide. Aucune action consommant des points n'est autorisée tant qu'elle n'est pas rétablie.",
    );
    this.name = 'CreditConfigUnavailableError';
  }
}

/** Même logique de résolution que la table de conformité : jamais `import.meta.url`. */
const CONFIG_PATH = env.CREDIT_COSTS_PATH
  ? isAbsolute(env.CREDIT_COSTS_PATH)
    ? env.CREDIT_COSTS_PATH
    : resolve(process.cwd(), env.CREDIT_COSTS_PATH)
  : join(process.cwd(), 'server', 'config', 'credit-costs.json');

let cache: CreditConfig | null = null;

async function getConfig(): Promise<CreditConfig> {
  if (cache) return cache;

  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    cache = configSchema.parse(JSON.parse(raw));
    return cache;
  } catch (cause) {
    throw new CreditConfigUnavailableError(CONFIG_PATH, cause);
  }
}

export function reloadCreditCosts(): void {
  cache = null;
}

/**
 * Coût d'une action pour un débit réel. Grille illisible : 503, et aucune action
 * facturée ne part — même règle d'échec fermé que pour la conformité.
 */
export async function getActionCost(actionId: string, quantity = 1): Promise<number> {
  let config: CreditConfig;
  try {
    config = await getConfig();
  } catch (error) {
    if (error instanceof CreditConfigUnavailableError) {
      console.error('[crédits] grille illisible :', error.configPath, error.cause);
      throw new AppError(503, error.message, 'CREDIT_CONFIG_UNAVAILABLE');
    }
    throw error;
  }

  const action = config.actions.find((candidate) => candidate.id === actionId);
  if (!action) {
    throw new AppError(500, `L'action « ${actionId} » ne figure pas dans la grille tarifaire.`, 'CREDIT_ACTION_UNKNOWN');
  }
  // Action à prix unique : la quantité demandée ne change rien.
  if (!action.perUnit) return action.cost;
  // Toute tranche entamée est due, et une action en coûte toujours au moins une.
  return action.cost * Math.max(1, Math.ceil(quantity / action.perUnit));
}

/** Grille complète, servie au client pour qu'il puisse simuler sans aller-retour. */
export async function getCostTable() {
  const config = await getConfig();
  return {
    version: config.version,
    updatedAt: config.updatedAt,
    currency: config.currency,
    pointValue: config.pointValueFcfa,
    pointValueStatus: config.pointValueStatus,
    actions: config.actions,
  };
}
