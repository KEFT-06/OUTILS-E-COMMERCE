import { z } from 'zod';
import { sansAccents } from '@server/db/search';
import { generateJsonWithPerplexity, type PerplexityService } from '@server/services/ai/perplexity';

/**
 * Idées de produits à angle précis.
 *
 * Un produit digital ne se vend pas sur son sujet (« Guide complet pour perdre du poids »), mais
 * sur son ANGLE : un résultat précis, obtenu par un mécanisme, pour un public ou sous une
 * contrainte donnée (« … en continuant de manger les plats de chez soi »). La consigne d'analyse
 * le demande ; ce module le VÉRIFIE, et fait préciser les titres restés génériques. Le nom de la
 * niche, lui, ne change jamais : tout se joue ici, côté serveur.
 */

export interface ProductDraft {
  title: string;
  subtitle: string;
  targetAudience: string;
  transformationPromise: string;
  targetProblem: string;
  angle: string;
}

/** Consigne ajoutée à l'analyse, à la suite de la description des produits. */
export const PRODUCT_ANGLE_RULE =
  '- TITRE DE CHAQUE PRODUIT (règle la plus importante de cette liste). La niche est large : découpe-la d’abord en angles vendables tirés de l’étude — un sous-public précis, un frein ou une objection relevés, une contrainte de terrain, une habitude locale — et donne à chaque produit un angle DIFFÉRENT. Le titre suit la forme [format] + [résultat précis] + [mécanisme, contrainte levée, public ou spécificité locale], et dit à lui seul ce qu’est le produit et ce qu’il change pour l’acheteur. Sont INTERDITS les titres génériques : « Guide complet sur… », « Comment faire… », « Tout savoir sur… », « Manuel de… », « Formation en… » sans angle. Forme attendue : « Guide pour perdre du poids en continuant de manger les plats de chez soi », « Le plan de 30 jours pour mieux équilibrer sa glycémie avec les aliments du marché », « Lancer son compte TikTok sans montrer son visage : la méthode en 14 jours ». Une durée de programme est permise ; un résultat chiffré ou garanti ne l’est pas (règle 4). targetProblem : le problème précis que vit l’acheteur, en une phrase. angle : ce qui distingue ce produit, en quelques mots (« Spécificité culturelle », « Sans budget publicitaire », « Sans contrainte extrême »…).';

/** Marques d'un angle : contrainte levée, mécanisme, durée, public ou ancrage local. */
const ANGLE =
  /\b(sans|avec|grace a|en \d+|\d+ (jours?|semaines?|mois|etapes?|minutes?|heures?)|meme si|a partir d|en continuant|au lieu d|pour (les|des|un|une|ceux|celles|ne plus|que)|depuis|quand|malgre|chez soi|a la maison|a domicile|du marche|de chez|locaux|locale|locales|local|africains?|africaines?|debutants?|debutantes?)\b/;
/** Tournures qui annoncent un sujet, pas un produit positionné. */
const SUJET_SEUL = /^(le |la |l |un |une )?(guide|manuel|formation|ebook|livre|cours|kit|pack|methode|programme)( complet| complete| pratique| ultime| essentiel| essentielle| de base)?( sur| de| du| des| d| en| pour| :)? /;

/**
 * Vrai pour un titre qui nomme un sujet sans dire à qui, comment ou sous quelle contrainte.
 * Volontairement strict : un titre repris à tort est simplement reconduit par la réécriture.
 */
export function isGenericProductTitle(title: string): boolean {
  const plat = sansAccents(title)
    .toLowerCase()
    .replace(/[’'`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const mots = plat.split(' ').filter(Boolean);
  if (mots.length < 6) return true;
  if (ANGLE.test(plat)) return false;
  return SUJET_SEUL.test(plat) || /^(comment|tout savoir|apprendre a|les bases|introduction)/.test(plat) || mots.length < 9;
}

const SHARPEN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    products: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { index: { type: 'INTEGER' }, title: { type: 'STRING' }, targetProblem: { type: 'STRING' }, angle: { type: 'STRING' } },
        required: ['index', 'title', 'targetProblem', 'angle'],
      },
    },
  },
  required: ['products'],
} as const;

const sharpenResponse = z.object({
  products: z
    .array(
      z.object({
        index: z.number().int().min(0).max(20),
        title: z.string().trim().min(1).max(160),
        targetProblem: z.string().trim().max(300).catch(''),
        angle: z.string().trim().max(120).catch(''),
      }),
    )
    .catch([]),
});

export function buildSharpenPrompt(input: { niche: string; marketName: string | null; memo: string | null; products: ProductDraft[]; indexes: number[] }): string {
  return [
    'Titres de produits à préciser.',
    `Niche : « ${input.niche} ». Marché visé : ${input.marketName ?? 'marchés francophones'}.`,
    '',
    'Les titres ci-dessous nomment un sujet, pas un produit qu’on achète. Réécris CHACUN sous la forme [format] + [résultat précis] + [mécanisme, contrainte levée, public ou spécificité locale], pour qu’il dise à lui seul ce qu’est le produit et ce qu’il change pour l’acheteur.',
    'Chaque titre prend un angle différent, tiré du public, de la promesse du produit et de l’étude : un frein relevé, une contrainte de terrain, une habitude locale, un sous-public précis.',
    'Interdits : « Guide complet sur… », « Comment faire… », « Tout savoir sur… », « Manuel de… ». Aucune promesse de gain, de guérison ni de résultat chiffré garanti ; une durée de programme est permise.',
    'targetProblem : le problème précis que vit l’acheteur, en une phrase. angle : ce qui distingue le produit, en quelques mots.',
    'Tout en français. Réponds uniquement en JSON, selon le schéma, en reprenant le numéro (index) de chaque produit.',
    '',
    ...(input.memo ? ['ÉTUDE DE MARCHÉ (extraits)', input.memo.slice(0, 3_500), ''] : []),
    'PRODUITS À PRÉCISER',
    ...input.indexes.map((index) => {
      const product = input.products[index]!;
      return `${index}. Titre actuel : « ${product.title} » — sous-titre : ${product.subtitle || '—'} — public : ${product.targetAudience || '—'} — promesse : ${product.transformationPromise || '—'}`;
    }),
  ].join('\n');
}

/**
 * Fait préciser les titres restés génériques. Ne bloque jamais l'analyse : si la réécriture
 * échoue ou rend un titre encore générique, le titre d'origine est gardé.
 */
export async function sharpenProductTitles<T extends ProductDraft>(
  products: T[],
  context: { niche: string; marketName: string | null; memo: string | null; service: PerplexityService; timeoutMs: number },
): Promise<T[]> {
  const indexes = products.flatMap((product, index) => (product.title && isGenericProductTitle(product.title) ? [index] : []));
  if (indexes.length === 0) return products;

  try {
    const response = await generateJsonWithPerplexity({
      service: context.service,
      prompt: buildSharpenPrompt({ niche: context.niche, marketName: context.marketName, memo: context.memo, products, indexes }),
      responseSchema: SHARPEN_SCHEMA as unknown as Record<string, unknown>,
      parse: (value) => sharpenResponse.parse(value),
      timeoutMs: context.timeoutMs,
      maxOutputTokens: 1_500,
    });
    const rewritten = new Map(response.products.map((entry) => [entry.index, entry]));
    return products.map((product, index) => {
      const entry = rewritten.get(index);
      if (!entry || !indexes.includes(index) || isGenericProductTitle(entry.title)) return product;
      return { ...product, title: entry.title, targetProblem: entry.targetProblem || product.targetProblem, angle: entry.angle || product.angle };
    });
  } catch (error) {
    console.warn('[analyse] titres de produits non précisés :', error instanceof Error ? error.message : error);
    return products;
  }
}
