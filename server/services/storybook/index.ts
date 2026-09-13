import { z } from 'zod';
import { env } from '@server/env';
import { AppError, marketSchema, providerUnavailable } from '@server/middleware';

/**
 * Storybook Africain via Gamma — feuille de route 3.4.
 *
 * ⚠️ Écrit d'après la documentation de l'API publique Gamma v1.0, consultée le
 * 14 septembre 2026, et NON vérifié contre l'API réelle faute de clé. À confronter
 * à une vraie réponse avant toute mise en production.
 *
 * Trois choix découlent de cette documentation et de la validation 3.5 :
 *  - Gamma n'expose ni seed ni référence de personnage pour les documents. La
 *    cohérence du personnage d'une page à l'autre n'est donc PAS garantie : la
 *    consigne envoyée la demande, elle ne l'impose pas.
 *  - L'URL d'export PDF de Gamma est un secret — téléchargeable par quiconque la
 *    détient, sans clé. Elle ne quitte jamais ce serveur : le schéma de statut
 *    ci-dessous l'écarte, avec les crédits restants du compte Gamma.
 *  - Aucun fait culturel n'est inventé par Smart Creator. La consigne demande à
 *    Gamma de n'utiliser comme références culturelles que les éléments fournis
 *    par l'auteur, et d'éviter caricatures et stéréotypes.
 */

const GAMMA_API_BASE = 'https://public-api.gamma.app/v1.0';

/** Délai d'un appel unitaire à Gamma ; la génération elle-même se suit par sondage. */
const REQUEST_TIMEOUT_MS = 30_000;

export const storybookBriefSchema = z.object({
  country: marketSchema,
  language: z.enum(['fr', 'en']),
  ageRange: z.enum(['3-5', '6-8', '9-12']),
  pages: z.number().int().min(4).max(20),
  heroName: z.string().trim().min(1).max(60),
  heroDescription: z.string().trim().max(300).optional(),
  theme: z.string().trim().min(3).max(300),
  culturalElements: z.string().trim().max(1000).optional(),
  visualStyle: z.string().trim().max(300).optional(),
});

export type StorybookBrief = z.infer<typeof storybookBriefSchema>;

export const generationIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,100}$/, 'Identifiant de génération invalide.');

/**
 * Noms des pays dans la langue du conte. `frOf` porte la forme contractée : le
 * texte part tel quel chez Gamma, qui le reprend dans le conte — « le contexte
 * de le Sénégal » y serait imprimé mot pour mot.
 */
const COUNTRY_NAMES: Record<StorybookBrief['country'], { fr: string; frOf: string; en: string }> = {
  CI: { fr: "la Côte d'Ivoire", frOf: "de la Côte d'Ivoire", en: "Côte d'Ivoire" },
  SN: { fr: 'le Sénégal', frOf: 'du Sénégal', en: 'Senegal' },
  CM: { fr: 'le Cameroun', frOf: 'du Cameroun', en: 'Cameroon' },
  BJ: { fr: 'le Bénin', frOf: 'du Bénin', en: 'Benin' },
  TG: { fr: 'le Togo', frOf: 'du Togo', en: 'Togo' },
  BF: { fr: 'le Burkina Faso', frOf: 'du Burkina Faso', en: 'Burkina Faso' },
  ML: { fr: 'le Mali', frOf: 'du Mali', en: 'Mali' },
  NE: { fr: 'le Niger', frOf: 'du Niger', en: 'Niger' },
  GN: { fr: 'la Guinée', frOf: 'de la Guinée', en: 'Guinea' },
  CD: {
    fr: 'la République démocratique du Congo',
    frOf: 'de la République démocratique du Congo',
    en: 'the Democratic Republic of the Congo',
  },
  CG: { fr: 'la République du Congo', frOf: 'de la République du Congo', en: 'the Republic of the Congo' },
  GA: { fr: 'le Gabon', frOf: 'du Gabon', en: 'Gabon' },
  TD: { fr: 'le Tchad', frOf: 'du Tchad', en: 'Chad' },
  MG: { fr: 'Madagascar', frOf: 'de Madagascar', en: 'Madagascar' },
  MA: { fr: 'le Maroc', frOf: 'du Maroc', en: 'Morocco' },
  TN: { fr: 'la Tunisie', frOf: 'de la Tunisie', en: 'Tunisia' },
  DZ: { fr: "l'Algérie", frOf: "de l'Algérie", en: 'Algeria' },
};

const AGE_LABELS: Record<StorybookBrief['ageRange'], { fr: string; en: string }> = {
  '3-5': { fr: '3 à 5 ans', en: '3 to 5' },
  '6-8': { fr: '6 à 8 ans', en: '6 to 8' },
  '9-12': { fr: '9 à 12 ans', en: '9 to 12' },
};

/** Texte envoyé à la vérification de conformité avant tout appel à Gamma. */
export function briefText(brief: StorybookBrief): string {
  return [brief.heroName, brief.heroDescription, brief.theme, brief.culturalElements, brief.visualStyle]
    .filter((part): part is string => Boolean(part))
    .join('\n');
}

/** Corps de `POST /v1.0/generations`. Fonction pure, testable sans appel réseau. */
export function buildGammaRequest(brief: StorybookBrief) {
  const country = COUNTRY_NAMES[brief.country];
  const age = AGE_LABELS[brief.ageRange];
  const hero = brief.heroDescription ? `${brief.heroName} — ${brief.heroDescription}` : brief.heroName;

  if (brief.language === 'fr') {
    return {
      inputText: [
        `Conte illustré pour enfants de ${age.fr}, en ${brief.pages} pages : une scène par page et un texte court adapté à cet âge.`,
        `Pays d'ancrage : ${country.fr}.`,
        `Personnage principal : ${hero}.`,
        `Thème et message du conte : ${brief.theme}.`,
        ...(brief.culturalElements
          ? [`Éléments culturels fournis par l'auteur, à respecter : ${brief.culturalElements}.`]
          : []),
      ].join('\n'),
      format: 'document',
      textMode: 'generate',
      numCards: brief.pages,
      cardSplit: 'auto',
      additionalInstructions:
        `Ancre les prénoms, les lieux, les paysages, les vêtements et la vie quotidienne dans le contexte ${country.frOf}, ` +
        'avec justesse, sans caricature ni stéréotype. ' +
        "N'invente aucun fait historique, aucune tradition ni aucun proverbe présenté comme authentique : " +
        "comme références culturelles précises, n'utilise que les éléments fournis par l'auteur. " +
        'Décris le personnage principal de façon identique à chaque page.',
      textOptions: {
        amount: 'brief',
        tone: 'chaleureux, bienveillant, adapté aux enfants',
        audience: `enfants de ${age.fr}`,
        language: 'fr',
      },
      imageOptions: {
        source: 'aiGenerated',
        style:
          `${brief.visualStyle || 'illustration jeunesse chaleureuse'}. ` +
          `Personnage principal : ${hero}, à représenter de la même manière sur chaque illustration.`,
      },
      cardOptions: { dimensions: '4x3' },
      // Sans accès externe, le lien Gamma ne s'ouvrirait que pour les membres de
      // l'espace de travail du serveur : l'auteur ne pourrait pas voir son conte.
      sharingOptions: { externalAccess: 'view' },
    };
  }

  return {
    inputText: [
      `Illustrated story for children aged ${age.en}, in ${brief.pages} pages: one scene per page with a short, age-appropriate text.`,
      `Setting: ${country.en}.`,
      `Main character: ${hero}.`,
      `Theme and message: ${brief.theme}.`,
      ...(brief.culturalElements
        ? [`Cultural elements provided by the author, to be respected: ${brief.culturalElements}.`]
        : []),
    ].join('\n'),
    format: 'document',
    textMode: 'generate',
    numCards: brief.pages,
    cardSplit: 'auto',
    additionalInstructions:
      `Ground first names, places, landscapes, clothing and daily life in the context of ${country.en}, ` +
      'accurately and without caricature or stereotypes. ' +
      'Do not invent any historical fact, tradition or proverb presented as authentic: ' +
      'use only the cultural elements provided by the author as specific cultural references. ' +
      'Describe the main character identically on every page.',
    textOptions: {
      amount: 'brief',
      tone: 'warm, kind, child-friendly',
      audience: `children aged ${age.en}`,
      language: 'en',
    },
    imageOptions: {
      source: 'aiGenerated',
      style:
        `${brief.visualStyle || "warm children's book illustration"}. ` +
        `Main character: ${hero}, to be depicted the same way in every illustration.`,
    },
    cardOptions: { dimensions: '4x3' },
    sharingOptions: { externalAccess: 'view' },
  };
}

/**
 * Traduit une erreur Gamma pour l'utilisateur de Smart Creator.
 *
 * Clé refusée et crédits Gamma épuisés deviennent des 503 : ce sont des
 * problèmes de configuration du serveur, pas des erreurs de l'utilisateur.
 */
function gammaFailure(status: number, gammaMessage: string | undefined): AppError {
  if (status === 401 || status === 403) {
    return new AppError(
      503,
      "L'accès à Gamma est refusé : clé API invalide, ou fonctionnalité absente de l'offre Gamma du serveur.",
      'GAMMA_ACCESS_DENIED',
    );
  }
  if (status === 402) {
    return new AppError(
      503,
      "Le compte Gamma du serveur n'a plus assez de crédits pour générer ce conte.",
      'GAMMA_INSUFFICIENT_CREDITS',
    );
  }
  if (status === 404) {
    return new AppError(404, 'Génération introuvable chez Gamma.', 'GAMMA_GENERATION_NOT_FOUND');
  }
  if (status === 429) {
    return new AppError(
      429,
      'Gamma limite temporairement le nombre de demandes. Réessayez dans quelques instants.',
      'GAMMA_RATE_LIMITED',
    );
  }
  if (status === 400) {
    return new AppError(
      502,
      `Gamma a refusé la demande${gammaMessage ? ` : ${gammaMessage}` : '.'}`,
      'GAMMA_REJECTED_REQUEST',
    );
  }
  return new AppError(502, 'Gamma est momentanément indisponible.', 'GAMMA_UNAVAILABLE');
}

async function gammaFetch(path: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
  const apiKey = env.GAMMA_API_KEY;
  if (!apiKey) throw providerUnavailable('Gamma');

  let response: Response;
  try {
    response = await fetch(`${GAMMA_API_BASE}${path}`, {
      method: init.method ?? 'GET',
      ...(init.body ? { body: init.body } : {}),
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError(502, 'Gamma est injoignable.', 'GAMMA_UNREACHABLE');
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw gammaFailure(response.status, payload?.message);
  }

  return response.json();
}

export async function createStorybookGeneration(brief: StorybookBrief): Promise<{ generationId: string }> {
  const payload = await gammaFetch('/generations', {
    method: 'POST',
    body: JSON.stringify(buildGammaRequest(brief)),
  });

  const parsed = z.object({ generationId: z.string().min(1) }).safeParse(payload);
  if (!parsed.success) {
    throw new AppError(502, 'Réponse inattendue de Gamma à la création.', 'GAMMA_UNEXPECTED_RESPONSE');
  }

  return { generationId: parsed.data.generationId };
}

/**
 * Schéma volontairement restreint : zod écarte les champs non déclarés, dont
 * `exportUrl` (lien secret) et `credits` (solde du compte Gamma du serveur).
 */
const statusSchema = z.object({
  generationId: z.string(),
  status: z.enum(['pending', 'completed', 'failed']),
  gammaUrl: z.string().url().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

export interface StorybookStatus {
  generationId: string;
  status: 'pending' | 'completed' | 'failed';
  gammaUrl?: string;
  errorMessage?: string;
}

export async function getStorybookGeneration(generationId: string): Promise<StorybookStatus> {
  const payload = await gammaFetch(`/generations/${encodeURIComponent(generationId)}`);
  const parsed = statusSchema.safeParse(payload);

  if (!parsed.success || (parsed.data.status === 'completed' && !parsed.data.gammaUrl)) {
    throw new AppError(502, 'Réponse inattendue de Gamma au suivi de génération.', 'GAMMA_UNEXPECTED_RESPONSE');
  }

  const { status, gammaUrl, error } = parsed.data;

  return {
    generationId,
    status,
    ...(gammaUrl ? { gammaUrl } : {}),
    ...(status === 'failed'
      ? { errorMessage: error?.message ?? 'La génération a échoué chez Gamma.' }
      : {}),
  };
}
