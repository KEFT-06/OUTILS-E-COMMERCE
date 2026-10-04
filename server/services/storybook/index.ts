import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response as ExpressResponse } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { storybooks } from '@server/db/schema';
import { env } from '@server/env';
import { AppError, marketSchema, providerUnavailable } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { generateJson } from '@server/services/ai/gemini';
import { OWN_ENGINE, resumeStalled, sendOwnStorybookPdf, sendOwnStorybookPicture } from '@server/services/storybook/illustrate';
import { countryName } from '@server/shared/countries';

/**
 * Storybook africain.
 *
 *  1. Gemini rédige le conte : titre, texte de chaque page adapté à l'âge, scène de chaque
 *     illustration, fiche du personnage principal et des personnages secondaires récurrents.
 *  2. L'illustration passe par le circuit « maison » (services/storybook/illustrate.ts) : une
 *     planche de référence des personnages, donnée en modèle à chaque page — le même visage et
 *     les mêmes vêtements d'un bout à l'autre du livre. Le serveur assemble lui-même le PDF.
 *  3. EN SECOURS, quand ce circuit n'est pas disponible (moteur d'images fermé, stockage absent),
 *     Gamma met en page et illustre : il ne reçoit qu'une fiche écrite, recopiée à chaque image,
 *     sans pouvoir garantir l'identique. Mieux vaut un conte ainsi qu'aucun conte.
 *
 * Aucun fait culturel n'est inventé : seuls les éléments fournis par l'auteur servent de
 * références culturelles précises.
 *
 * Le lien d'export PDF de Gamma est un secret qui expire (une semaine) : il ne quitte jamais ce
 * serveur, qui le redemande à chaque téléchargement et relance un export gratuit s'il a expiré.
 */

const REQUEST_TIMEOUT_MS = 30_000;
const WRITING_TIMEOUT_MS = 120_000;
const EXPORT_DEADLINE_MS = 120_000;
/** Limites documentées de l'API Gamma. */
const ADDITIONAL_INSTRUCTIONS_MAX = 5_000;
const IMAGE_STYLE_MAX = 500;

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

export const generationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, 'Identifiant de génération invalide.');

const AGE_LABELS: Record<StorybookBrief['ageRange'], { fr: string; en: string; words: string }> = {
  '3-5': { fr: '3 à 5 ans', en: '3 to 5', words: '25 à 45' },
  '6-8': { fr: '6 à 8 ans', en: '6 to 8', words: '45 à 80' },
  '9-12': { fr: '9 à 12 ans', en: '9 to 12', words: '80 à 130' },
};

/** Texte envoyé à la vérification de conformité avant tout appel. */
export function briefText(brief: StorybookBrief): string {
  return [brief.heroName, brief.heroDescription, brief.theme, brief.culturalElements, brief.visualStyle]
    .filter((part): part is string => Boolean(part))
    .join('\n');
}

/* -------------------------------------------------------------------------- */
/*  1. Rédaction par Gemini                                                    */
/* -------------------------------------------------------------------------- */

export interface StoryPage {
  heading: string;
  text: string;
  illustration: string;
}

export interface StoryDraft {
  title: string;
  characterSheet: string;
  /** Personnages secondaires récurrents : dessinés sur la planche de référence, à côté du principal. */
  cast?: { name: string; sheet: string }[];
  coverIllustration: string;
  pages: StoryPage[];
}

const WRITER = { name: 'service de rédaction des contes', code: 'STORY', log: 'conte' };

export function buildStoryPrompt(brief: StorybookBrief): string {
  const age = AGE_LABELS[brief.ageRange];
  const country = countryName(brief.country, 'fr');
  const language = brief.language === 'fr' ? 'français' : 'anglais';
  return [
    'Tu es autrice de contes illustrés pour enfants, publiés par Smart Creator pour des familles d’Afrique francophone et de la diaspora.',
    `Écris un conte en ${language}, pour des enfants de ${age.fr}, en exactement ${brief.pages} pages.`,
    `Pays d’ancrage : ${country}.`,
    `Personnage principal : ${brief.heroName}${brief.heroDescription ? ` — ${brief.heroDescription}` : ''}.`,
    `Thème et message : ${brief.theme}.`,
    ...(brief.culturalElements ? [`Éléments culturels fournis par l’auteur, à intégrer avec justesse : ${brief.culturalElements}.`] : []),
    ...(brief.visualStyle ? [`Style visuel souhaité : ${brief.visualStyle}.`] : []),
    '',
    'RÈGLES',
    `1. Chaque page raconte une scène, avec ${age.words} mots, des phrases simples et vivantes adaptées à l’âge. Une vraie histoire : situation de départ, difficulté, tentatives, résolution, fin chaleureuse.`,
    `2. Ancre les prénoms, lieux, paysages, vêtements et gestes du quotidien dans le contexte de ce pays : ${country}, avec justesse, sans caricature ni stéréotype.`,
    '3. N’invente aucun fait historique, aucune tradition ni aucun proverbe présenté comme authentique : comme références culturelles précises, n’utilise que les éléments fournis par l’auteur.',
    '4. Aucune violence, aucune peur excessive, aucun contenu inadapté aux enfants ; le message se comprend sans morale assénée.',
    '5. characterSheet : fiche visuelle précise et constante du personnage principal, en anglais (âge, carnation, coiffure, vêtements et couleurs, signe distinctif), reprise telle quelle pour chaque illustration.',
    '6. illustration (en anglais) : la scène de la page en une ou deux phrases — lieu, action, émotion, cadrage — sans texte ni lettre dans l’image. Nomme chaque personnage présent par son nom, toujours le même. coverIllustration : l’image de couverture.',
    '6 bis. cast : au plus deux personnages secondaires RÉCURRENTS (présents dans au moins deux pages) — name : le nom employé dans les scènes ; sheet : sa fiche visuelle précise, en anglais, comme characterSheet. Liste vide s’il n’y en a pas.',
    `7. title : titre court et attrayant, en ${language}. heading : titre court de la page, en ${language}.`,
    '8. Réponds uniquement en JSON, selon le schéma.',
  ].join('\n');
}

const STRING = { type: 'STRING' };

export const STORY_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: STRING,
    characterSheet: STRING,
    cast: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: STRING, sheet: STRING }, required: ['name', 'sheet'] } },
    coverIllustration: STRING,
    pages: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { heading: STRING, text: STRING, illustration: STRING },
        required: ['heading', 'text', 'illustration'],
      },
    },
  },
  required: ['title', 'characterSheet', 'coverIllustration', 'pages'],
};

const clean = (max: number) =>
  z
    .string()
    .catch('')
    .transform((value) => value.replace(/\s+/g, ' ').trim().slice(0, max));

const storySchema = z.object({
  title: clean(120),
  characterSheet: clean(400),
  cast: z.array(z.object({ name: clean(60), sheet: clean(400) }).catch({ name: '', sheet: '' })).catch([]),
  coverIllustration: clean(400),
  pages: z
    .array(
      z.object({ heading: clean(120), text: clean(1_200), illustration: clean(400) }).catch({ heading: '', text: '', illustration: '' }),
    )
    .catch([]),
});

/** Valide le conte : titre, fiche du personnage et nombre exact de pages rédigées. */
export function parseStory(value: unknown, pages: number): StoryDraft {
  const story = storySchema.parse(value);
  const written = story.pages.filter((page) => page.text && page.illustration);
  if (!story.title || !story.characterSheet || written.length < pages) {
    throw new Error(`Conte incomplet : ${written.length} page(s) sur ${pages}.`);
  }
  const cast = story.cast.filter((member) => member.name && member.sheet).slice(0, 2);
  return { ...story, cast, pages: written.slice(0, pages) };
}

export async function writeStory(brief: StorybookBrief): Promise<StoryDraft> {
  return generateJson({
    service: WRITER,
    prompt: buildStoryPrompt(brief),
    responseSchema: STORY_RESPONSE_SCHEMA,
    parse: (value) => parseStory(value, brief.pages),
    timeoutMs: WRITING_TIMEOUT_MS,
  });
}

/* -------------------------------------------------------------------------- */
/*  2. Mise en page et illustrations par Gamma                                 */
/* -------------------------------------------------------------------------- */

/** Corps de `POST /v1.0/generations`. Fonction pure, testable sans appel réseau. */
export function buildGammaRequest(brief: StorybookBrief, story: StoryDraft) {
  const french = brief.language === 'fr';
  const cover = french ? `# ${story.title}\nUn conte illustré` : `# ${story.title}\nAn illustrated story`;
  const cards = [cover, ...story.pages.map((page) => `# ${page.heading}\n${page.text}`)];

  const header = [
    french
      ? 'Livre illustré pour enfants. Garde exactement le texte fourni, sans rien ajouter, retirer ni reformuler : une carte par page.'
      : "Illustrated children's book. Keep the provided text exactly, without adding, removing or rephrasing anything: one card per page.",
    french
      ? 'Chaque carte comporte UNE grande illustration générée, placée à côté ou au-dessus du texte, sans aucun texte ni lettre dans l’image.'
      : 'Every card has ONE large generated illustration, beside or above the text, with no text or letters in the image.',
    `Main character (identical in every illustration): ${story.characterSheet}`,
    'Illustrations, card by card:',
  ].join('\n');
  const scenes = [story.coverIllustration, ...story.pages.map((page) => page.illustration)];
  const perScene = Math.max(80, Math.floor((ADDITIONAL_INSTRUCTIONS_MAX - header.length - scenes.length * 12) / scenes.length));
  const additionalInstructions = [header, ...scenes.map((scene, index) => `Card ${index + 1}: ${scene.slice(0, perScene)}`)]
    .join('\n')
    .slice(0, ADDITIONAL_INSTRUCTIONS_MAX);

  const style = `${brief.visualStyle || (french ? 'illustration jeunesse chaleureuse, couleurs douces' : "warm children's book illustration, soft colours")}. Consistent main character: ${story.characterSheet}`;

  return {
    inputText: cards.join('\n---\n'),
    textMode: 'preserve',
    cardSplit: 'inputTextBreaks',
    format: 'presentation',
    additionalInstructions,
    textOptions: { language: brief.language },
    imageOptions: { source: 'aiGenerated', model: env.GAMMA_IMAGE_MODEL, style: style.slice(0, IMAGE_STYLE_MAX) },
    cardOptions: { dimensions: '4x3' },
    exportAs: 'pdf',
    // Sans accès externe, le lien Gamma ne s'ouvrirait que pour les membres de l'espace de travail du serveur.
    sharingOptions: { externalAccess: 'view' },
  };
}

/**
 * Traduit une erreur Gamma pour l'utilisateur de Smart Creator. Clé refusée et crédits Gamma
 * épuisés deviennent des 503 : ce sont des problèmes de configuration du serveur.
 */
function gammaFailure(status: number): AppError {
  if (status === 401 || status === 403) {
    return new AppError(
      503,
      "L'accès au service de mise en page est refusé : l'administrateur doit vérifier sa configuration.",
      'GAMMA_ACCESS_DENIED',
    );
  }
  if (status === 402) {
    return new AppError(
      503,
      "Le service de mise en page n'a plus assez de réserve pour illustrer ce conte : réessayez plus tard, vos points ont été rendus.",
      'GAMMA_INSUFFICIENT_CREDITS',
    );
  }
  if (status === 404) return new AppError(404, 'Génération introuvable.', 'GAMMA_GENERATION_NOT_FOUND');
  if (status === 429)
    return new AppError(429, 'La mise en page n’a pas pu être lancée.', 'GAMMA_RATE_LIMITED');
  if (status === 400)
    return new AppError(502, 'La mise en page a été refusée. Reformulez le conte, puis réessayez.', 'GAMMA_REJECTED_REQUEST');
  return new AppError(502, 'Le service de mise en page est momentanément indisponible.', 'GAMMA_UNAVAILABLE');
}

async function gammaFetch(path: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
  const apiKey = env.GAMMA_API_KEY;
  if (!apiKey) throw providerUnavailable('mise en page illustrée');

  let response: Response;
  try {
    response = await fetch(`${env.GAMMA_API_URL.replace(/\/+$/, '')}/v1.0${path}`, {
      method: init.method ?? 'GET',
      ...(init.body ? { body: init.body } : {}),
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError(502, 'Le service de mise en page est injoignable.', 'GAMMA_UNREACHABLE');
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    console.error('[gamma] le fournisseur a répondu', response.status, payload?.message ?? '');
    throw gammaFailure(response.status);
  }
  return response.json();
}

export async function submitStorybook(brief: StorybookBrief, story: StoryDraft): Promise<{ generationId: string }> {
  const payload = await gammaFetch('/generations', { method: 'POST', body: JSON.stringify(buildGammaRequest(brief, story)) });
  const parsed = z.object({ generationId: z.string().min(1) }).safeParse(payload);
  if (!parsed.success) throw new AppError(502, 'Réponse inattendue du service de mise en page.', 'GAMMA_UNEXPECTED_RESPONSE');
  return { generationId: parsed.data.generationId };
}

/**
 * Le conte tel qu'il revient de l'aperçu, avant d'être envoyé à l'illustration.
 *
 * Il repart du navigateur, donc il est validé comme n'importe quelle entrée : longueurs
 * bornées, nombre de pages contrôlé. L'auteur peut avoir corrigé son texte — c'est le but —
 * mais il ne doit pas pouvoir faire porter à Gamma un contenu arbitrairement volumineux.
 */
export const storyDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  characterSheet: z.string().trim().min(1).max(2_000),
  cast: z
    .array(z.object({ name: z.string().trim().min(1).max(80), sheet: z.string().trim().min(1).max(2_000) }))
    .max(2)
    .optional(),
  coverIllustration: z.string().trim().min(1).max(2_000),
  pages: z
    .array(
      z.object({
        heading: z.string().trim().max(200),
        text: z.string().trim().min(1).max(4_000),
        illustration: z.string().trim().min(1).max(2_000),
      }),
    )
    .min(1)
    .max(20),
});

/* -------------------------------------------------------------------------- */
/*  3. Suivi, liste et téléchargement                                          */
/* -------------------------------------------------------------------------- */

/**
 * Schéma volontairement restreint : zod écarte les champs non déclarés, dont `exportUrl`
 * (lien secret) et `credits` (solde du compte Gamma du serveur).
 */
const statusSchema = z.object({
  generationId: z.string(),
  status: z.enum(['pending', 'completed', 'failed']),
  gammaId: z.string().optional(),
  gammaUrl: z.string().url().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

export interface StorybookStatus {
  generationId: string;
  status: 'pending' | 'completed' | 'failed';
  gammaUrl?: string;
  storybookId?: string;
  errorMessage?: string;
}

/** État chez Gamma, reporté sur le conte enregistré. */
export async function getStorybookGeneration(generationId: string): Promise<StorybookStatus> {
  const payload = await gammaFetch(`/generations/${encodeURIComponent(generationId)}`);
  const parsed = statusSchema.safeParse(payload);
  if (!parsed.success || (parsed.data.status === 'completed' && !parsed.data.gammaUrl)) {
    throw new AppError(502, 'Réponse inattendue du service de mise en page.', 'GAMMA_UNEXPECTED_RESPONSE');
  }

  const { status, gammaUrl, gammaId, error } = parsed.data;
  const [row] =
    status === 'pending'
      ? await getDb().select({ id: storybooks.id }).from(storybooks).where(eq(storybooks.generationRef, generationId)).limit(1)
      : await getDb()
          .update(storybooks)
          .set(
            status === 'completed'
              ? { status, gammaUrl: gammaUrl ?? null, gammaId: gammaId ?? null, completedAt: new Date() }
              : { status, completedAt: new Date() },
          )
          .where(eq(storybooks.generationRef, generationId))
          .returning({ id: storybooks.id });

  return {
    generationId,
    status,
    ...(gammaUrl ? { gammaUrl } : {}),
    ...(row ? { storybookId: row.id } : {}),
    ...(status === 'failed' ? { errorMessage: error?.message ?? 'La génération a échoué : vos points ont été rendus.' } : {}),
  };
}

export async function recordStorybook(
  auth: RequestAuth,
  brief: StorybookBrief,
  generationId: string,
  story: StoryDraft,
  engine: string | null = null,
): Promise<string> {
  const [row] = await getDb()
    .insert(storybooks)
    .values({
      userId: auth.account.user.id,
      generationRef: generationId,
      engine,
      brief: brief as unknown as Record<string, unknown>,
      title: story.title,
      language: brief.language,
      country: brief.country,
      pages: story.pages.length,
      story: story as unknown as Record<string, unknown>,
      status: 'pending',
    })
    .returning({ id: storybooks.id });
  return row!.id;
}

export async function listStorybooks(auth: RequestAuth) {
  const rows = await getDb()
    .select()
    .from(storybooks)
    .where(eq(storybooks.userId, auth.account.user.id))
    .orderBy(desc(storybooks.createdAt))
    .limit(50);
  // Un conte laissé en cours (écran fermé pendant l'illustration) reprend à l'ouverture de la liste.
  resumeStalled(rows);
  return rows.map((row) => ({
    id: row.id,
    generationId: row.generationRef,
    title: row.title,
    language: row.language,
    country: row.country,
    pages: row.pages,
    status: row.status as 'pending' | 'completed' | 'failed',
    gammaUrl: row.gammaUrl,
    story: row.story as unknown as StoryDraft,
    /** Rangs dont l'illustration peut être affichée (0 : couverture). Vide pour un conte du circuit de secours. */
    pictures: row.engine === OWN_ENGINE ? [...row.illustrated].sort((a, b) => a - b) : [],
    createdAt: row.createdAt.toISOString(),
  }));
}

async function ownedStorybook(auth: RequestAuth, storybookId: string | undefined) {
  const parsed = z.string().uuid().safeParse(storybookId);
  const notFound = new AppError(404, 'Conte introuvable sur votre compte.', 'STORYBOOK_NOT_FOUND');
  if (!parsed.success) throw notFound;
  const [row] = await getDb()
    .select()
    .from(storybooks)
    .where(and(eq(storybooks.id, parsed.data), eq(storybooks.userId, auth.account.user.id)))
    .limit(1);
  if (!row) throw notFound;
  return row;
}

const exportSchema = z.object({ status: z.enum(['pending', 'completed', 'failed']), exportUrl: z.string().url().optional() });

/** Lien d'export frais : celui de la génération s'il répond encore, sinon un nouvel export (gratuit chez Gamma). */
async function freshPdf(generationRef: string, gammaId: string | null): Promise<Response> {
  const generation = z
    .object({ exportUrl: z.string().url().optional(), gammaId: z.string().optional() })
    .safeParse(await gammaFetch(`/generations/${encodeURIComponent(generationRef)}`));
  const existing = generation.success ? generation.data.exportUrl : undefined;
  if (existing?.startsWith('https://')) {
    const response = await fetch(existing, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (response?.ok) return response;
  }

  const fileId = gammaId ?? (generation.success ? generation.data.gammaId : undefined);
  if (!fileId)
    throw new AppError(
      409,
      'Le PDF de ce conte est en cours de préparation.',
      'STORYBOOK_PDF_UNAVAILABLE',
    );

  const started = z
    .object({ exportId: z.string().min(1) })
    .safeParse(
      await gammaFetch(`/gammas/${encodeURIComponent(fileId)}/export`, { method: 'POST', body: JSON.stringify({ exportAs: 'pdf' }) }),
    );
  if (!started.success) throw new AppError(502, 'Réponse inattendue du service de mise en page.', 'GAMMA_UNEXPECTED_RESPONSE');

  const deadline = Date.now() + EXPORT_DEADLINE_MS;
  while (Date.now() < deadline) {
    const polled = exportSchema.safeParse(await gammaFetch(`/exports/${encodeURIComponent(started.data.exportId)}`));
    if (polled.success && polled.data.status === 'completed' && polled.data.exportUrl?.startsWith('https://')) {
      const response = await fetch(polled.data.exportUrl, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (response?.ok) return response;
      break;
    }
    if (polled.success && polled.data.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new AppError(502, 'Le PDF de ce conte n’a pas pu être produit.', 'STORYBOOK_PDF_FAILED');
}

const fileNameOf = (title: string) =>
  title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'conte';

/** Télécharge le PDF d'un conte terminé, sans jamais révéler le lien d'export de Gamma. */
export async function sendStorybookPdf(auth: RequestAuth, storybookId: string | undefined, res: ExpressResponse): Promise<void> {
  const row = await ownedStorybook(auth, storybookId);
  if (row.status !== 'completed') throw new AppError(409, 'Le conte n’est pas encore prêt.', 'STORYBOOK_NOT_READY');
  if (row.engine === OWN_ENGINE) return sendOwnStorybookPdf(row, fileNameOf(row.title), res);
  if (!env.GAMMA_API_KEY) throw providerUnavailable('mise en page illustrée');

  const pdf = await freshPdf(row.generationRef, row.gammaId);
  const invalid = () => new AppError(502, 'Le fichier reçu n’est pas un PDF valide.', 'STORYBOOK_PDF_INVALID');
  if (!pdf.body) throw invalid();

  /*
    Le PDF est RELAYÉ au fil de l'eau, pas chargé en entier puis renvoyé d'un bloc.

    Un conte illustré pèse facilement plus de 4,5 Mo — une grande illustration par page —
    et l'hébergeur refuse toute réponse d'un seul bloc au-delà de ce poids (413). En local,
    rien ne le montrait. Seul le début est lu d'avance, pour vérifier que c'est bien un PDF.
  */
  const reader = pdf.body.getReader();
  let head = Buffer.alloc(0);
  while (head.length < 4) {
    const chunk = await reader.read();
    if (chunk.done) break;
    head = Buffer.concat([head, Buffer.from(chunk.value)]);
  }
  if (head.subarray(0, 4).toString('latin1') !== '%PDF') {
    await reader.cancel().catch(() => undefined);
    throw invalid();
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileNameOf(row.title)}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  async function* body() {
    yield head;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      yield Buffer.from(chunk.value);
    }
  }
  await pipeline(Readable.from(body()), res);
}

/** Illustration d’une page d’un conte du compte (0 : la couverture), pour l’aperçu à l’écran. */
export async function sendStorybookPicture(
  auth: RequestAuth,
  storybookId: string | undefined,
  position: string | undefined,
  res: ExpressResponse,
): Promise<void> {
  const row = await ownedStorybook(auth, storybookId);
  const rank = z.coerce.number().int().min(0).max(20).safeParse(position);
  if (!rank.success || row.engine !== OWN_ENGINE) throw new AppError(404, 'Illustration introuvable.', 'STORYBOOK_PICTURE_NOT_FOUND');
  await sendOwnStorybookPicture(row, rank.data, res);
}
