import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { env } from '@server/env';
import { formatMoney, roundPrice } from '@server/shared/currency';

/**
 * Fourchettes de prix — CdC §2, feuille de route 2.5.
 *
 * Le cahier des charges est explicite : les fourchettes doivent être
 * « dynamiques en base, jamais figées dans le code ». Elles vivaient jusqu'ici
 * dans les attributs `min`/`max` de deux curseurs React, ce qui revenait à
 * exiger un redéploiement pour corriger un prix de marché.
 */

const markSchema = z.object({
  value: z.number(),
  label: z.string().min(1),
});

const rangeSchema = z.object({
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  default: z.number(),
  marks: z.array(markSchema).min(2),
});

const configSchema = z
  .object({
    version: z.string(),
    updatedAt: z.string(),
    note: z.string().optional(),
    currency: z.string().min(1),
    currencySymbol: z.string().min(1),
    valuesStatus: z.string().optional(),
    sellingPrice: rangeSchema,
    adCostPerAcquisition: rangeSchema,
    productTypeRanges: z
      .array(
        z.object({
          type: z.string().min(1),
          label: z.string().min(1),
          min: z.number(),
          typical: z.number(),
          max: z.number(),
        }),
      )
      .min(1),
  })
  .superRefine((config, ctx) => {
    // Une fourchette incohérente produit un curseur inutilisable côté client.
    // Mieux vaut refuser la table au chargement que livrer un écran cassé.
    for (const key of ['sellingPrice', 'adCostPerAcquisition'] as const) {
      const range = config[key];
      if (range.min >= range.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `min (${range.min}) doit être strictement inférieur à max (${range.max}).`,
        });
      }
      if (range.default < range.min || range.default > range.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key, 'default'],
          message: `la valeur par défaut (${range.default}) doit être comprise entre min et max.`,
        });
      }
    }
  });

export type PricingConfig = z.infer<typeof configSchema>;

export class PricingUnavailableError extends Error {
  constructor(
    readonly configPath: string,
    override readonly cause: unknown,
  ) {
    super('La table des fourchettes de prix est introuvable ou invalide.');
    this.name = 'PricingUnavailableError';
  }
}

const CONFIG_PATH = env.PRICING_PATH
  ? isAbsolute(env.PRICING_PATH)
    ? env.PRICING_PATH
    : resolve(process.cwd(), env.PRICING_PATH)
  : join(process.cwd(), 'server', 'config', 'pricing.json');

let cache: PricingConfig | null = null;

export function reloadPricing(): void {
  cache = null;
}

export async function getPricing(): Promise<PricingConfig> {
  if (cache) return cache;

  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    cache = configSchema.parse(JSON.parse(raw));
    return cache;
  } catch (cause) {
    throw new PricingUnavailableError(CONFIG_PATH, cause);
  }
}

/** Pas « rond » pour un curseur : 1, 2 ou 5 × une puissance de dix, près d'un quarantième de l'étendue. */
function sliderStep(span: number): number {
  const raw = span / 40;
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const unit = [1, 2, 5, 10].find((candidate) => candidate * power >= raw) ?? 10;
  return unit * power;
}

/** Symbole d'usage d'une devise en français : « FCFA », « € », « ₦ »… */
export function currencySymbol(currency: string): string {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).formatToParts(0).find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/**
 * La table dans la devise de l'utilisateur. Écrite en euros, elle s'affichait telle quelle à
 * tout le monde (« 9 € – 199 € » pour un créateur de Douala), et le simulateur mélangeait ces
 * euros avec le prix conseillé du produit, dans la devise du pays. Chaque borne est convertie
 * puis arrondie à un prix « propre » ; les repères gardent leur précision entre parenthèses.
 */
export function pricingIn(config: PricingConfig, currency: string, convert: (amount: number) => number | null): PricingConfig {
  if (currency === config.currency) return config;
  const factor = convert(1);
  if (!factor) return config;
  const price = (value: number) => roundPrice(value * factor, currency);
  const range = (source: PricingConfig['sellingPrice']) => {
    const min = price(source.min);
    const max = Math.max(price(source.max), min + 1);
    const step = sliderStep(max - min);
    const snap = (value: number) => Math.min(max, Math.max(min, Math.round(value / step) * step));
    return {
      min,
      max,
      step,
      default: snap(price(source.default)),
      marks: source.marks.map((mark) => {
        const value = snap(price(mark.value));
        const suffix = /\(.*\)\s*$/.exec(mark.label)?.[0] ?? '';
        return { value, label: `${formatMoney(value, currency)}${suffix ? ` ${suffix}` : ''}` };
      }),
    };
  };
  return {
    ...config,
    currency,
    currencySymbol: currencySymbol(currency),
    sellingPrice: range(config.sellingPrice),
    adCostPerAcquisition: range(config.adCostPerAcquisition),
    productTypeRanges: config.productTypeRanges.map((type) => ({ ...type, min: price(type.min), typical: price(type.typical), max: price(type.max) })),
  };
}
