import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { env } from '@server/env';

/**
 * Vérificateur d'originalité — feuille de route 3.2.
 *
 * Exigence : avertissement bloquant sous 70 % d'originalité.
 *
 * Ce que ce service mesure, et ce qu'il ne mesure pas — la distinction est
 * affichée à l'utilisateur à chaque verdict :
 *  - Il mesure la part du texte qui reprend mot pour mot des passages d'un
 *    corpus de référence CONNU (table de configuration + textes soumis).
 *  - Il ne fait pas de recherche sur le web. Un texte recopié d'une source
 *    absente du corpus ne sera pas détecté. Prétendre le contraire donnerait
 *    une garantie que l'outil ne peut pas tenir.
 *
 * Méthode : n-grammes de mots (« shingles »). Chaque mot du texte couvert par
 * au moins une suite de N mots identique dans une référence est compté comme
 * repris. Originalité = part des mots non couverts. Déterministe et explicable :
 * chaque verdict montre les passages qui l'ont produit.
 */

const referenceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  text: z.string().min(1),
});

const configSchema = z.object({
  version: z.string(),
  updatedAt: z.string(),
  note: z.string().optional(),
  blockingThreshold: z.number().min(0).max(100),
  /**
   * Longueur des suites comparées. Trop courte, les tournures banales (« cliquez
   * sur le lien ») passent pour du plagiat ; trop longue, une reprise légèrement
   * retouchée échappe à la mesure.
   */
  shingleSize: z.number().int().min(3).max(12),
  /** En deçà, un pourcentage ne veut rien dire : 3 mots repris sur 10 feraient 30 %. */
  minimumWords: z.number().int().min(1),
  referenceCorpus: z.array(referenceSchema),
});

export type OriginalityConfig = z.infer<typeof configSchema>;

export interface OriginalityReference {
  label: string;
  text: string;
}

export interface OriginalityMatch {
  label: string;
  /** Part des mots du texte repris de cette référence. */
  overlapPercent: number;
  /** Passages repris les plus longs (ponctuation non restituée). */
  passages: string[];
}

export interface OriginalityVerdict {
  /** false ⇒ aucune mesure fiable possible ; `unmeasurableReason` dit pourquoi. */
  measurable: boolean;
  unmeasurableReason?: string;
  originalityPercent: number | null;
  threshold: number;
  /** true ⇒ originalité sous le seuil : l'export doit être refusé. */
  blocking: boolean;
  wordCount: number;
  referencesCompared: number;
  matches: OriginalityMatch[];
  /** Portée de la mesure, à afficher avec le verdict. */
  scopeNotice: string;
  configVersion: string;
  checkedAt: string;
}

export class OriginalityConfigUnavailableError extends Error {
  constructor(
    readonly configPath: string,
    override readonly cause: unknown,
  ) {
    super(
      "Les paramètres du vérificateur d'originalité sont introuvables ou invalides. " +
        "Par sécurité, aucun export n'est autorisé tant qu'ils ne sont pas rétablis.",
    );
    this.name = 'OriginalityConfigUnavailableError';
  }
}

const CONFIG_PATH = env.ORIGINALITY_PATH
  ? isAbsolute(env.ORIGINALITY_PATH)
    ? env.ORIGINALITY_PATH
    : resolve(process.cwd(), env.ORIGINALITY_PATH)
  : join(process.cwd(), 'server', 'config', 'originality.json');

let cache: OriginalityConfig | null = null;

export function reloadOriginalityConfig(): void {
  cache = null;
}

async function getConfig(): Promise<OriginalityConfig> {
  if (cache) return cache;

  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    cache = configSchema.parse(JSON.parse(raw));
    return cache;
  } catch (cause) {
    throw new OriginalityConfigUnavailableError(CONFIG_PATH, cause);
  }
}

interface Token {
  original: string;
  /** Minuscules, sans accents : « Résultat » et « resultat » sont le même mot repris. */
  normalized: string;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];

  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const original = match[0];
    tokens.push({
      original,
      normalized: original.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-FR'),
    });
  }

  return tokens;
}

/** Suites de `size` mots normalisés, dans l'ordre du texte. */
function shingles(tokens: Token[], size: number): string[] {
  const result: string[] = [];
  for (let i = 0; i + size <= tokens.length; i += 1) {
    result.push(
      tokens
        .slice(i, i + size)
        .map((token) => token.normalized)
        .join(' '),
    );
  }
  return result;
}

const MAX_PASSAGE_WORDS = 40;

function longestPassages(tokens: Token[], covered: boolean[], size: number, limit = 3): string[] {
  const runs: { start: number; end: number }[] = [];
  let start = -1;

  covered.forEach((isCovered, index) => {
    if (isCovered && start === -1) start = index;
    if (!isCovered && start !== -1) {
      runs.push({ start, end: index });
      start = -1;
    }
  });
  if (start !== -1) runs.push({ start, end: covered.length });

  return runs
    .filter((run) => run.end - run.start >= size)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, limit)
    .map((run) => {
      const words = tokens.slice(run.start, run.end).map((token) => token.original);
      return words.length > MAX_PASSAGE_WORDS
        ? `${words.slice(0, MAX_PASSAGE_WORDS).join(' ')}…`
        : words.join(' ');
    });
}

export async function checkOriginality(
  text: string,
  submittedReferences: OriginalityReference[],
): Promise<OriginalityVerdict> {
  const config = await getConfig();
  const size = config.shingleSize;
  const tokens = tokenize(text);

  const references: OriginalityReference[] = [
    ...config.referenceCorpus.map(({ label, text: referenceText }) => ({ label, text: referenceText })),
    ...submittedReferences,
  ];

  const base = {
    threshold: config.blockingThreshold,
    wordCount: tokens.length,
    referencesCompared: references.length,
    scopeNotice:
      `Originalité mesurée contre ${references.length} texte(s) de référence connus de Smart Creator. ` +
      "Ce n'est pas une recherche sur le web : un passage recopié d'une source absente de ce corpus " +
      "ne sera pas détecté.",
    configVersion: config.version,
    checkedAt: new Date().toISOString(),
  };

  const minimumWords = Math.max(config.minimumWords, size);

  if (tokens.length < minimumWords) {
    return {
      ...base,
      measurable: false,
      unmeasurableReason: `Texte trop court pour une mesure fiable : ${tokens.length} mot(s), ${minimumWords} requis.`,
      originalityPercent: null,
      blocking: false,
      matches: [],
    };
  }

  // Sans référence, un « 100 % original » serait un chiffre sans objet.
  if (references.length === 0) {
    return {
      ...base,
      measurable: false,
      unmeasurableReason:
        "Aucun texte de référence disponible : l'originalité ne peut pas être mesurée contre rien.",
      originalityPercent: null,
      blocking: false,
      matches: [],
    };
  }

  const textShingles = shingles(tokens, size);
  const coveredOverall = new Array<boolean>(tokens.length).fill(false);
  const matches: OriginalityMatch[] = [];

  for (const reference of references) {
    const referenceSet = new Set(shingles(tokenize(reference.text), size));
    if (referenceSet.size === 0) continue;

    const covered = new Array<boolean>(tokens.length).fill(false);

    textShingles.forEach((shingle, index) => {
      if (!referenceSet.has(shingle)) return;
      for (let j = index; j < index + size; j += 1) {
        covered[j] = true;
        coveredOverall[j] = true;
      }
    });

    const coveredCount = covered.filter(Boolean).length;
    if (coveredCount === 0) continue;

    matches.push({
      label: reference.label,
      overlapPercent: Math.round((coveredCount / tokens.length) * 1000) / 10,
      passages: longestPassages(tokens, covered, size),
    });
  }

  const copiedCount = coveredOverall.filter(Boolean).length;
  const originalityPercent = Math.round((1 - copiedCount / tokens.length) * 1000) / 10;

  return {
    ...base,
    measurable: true,
    originalityPercent,
    blocking: originalityPercent < config.blockingThreshold,
    matches: matches.sort((a, b) => b.overlapPercent - a.overlapPercent).slice(0, 5),
  };
}
