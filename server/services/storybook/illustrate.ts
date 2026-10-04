import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response as ExpressResponse } from 'express';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { generations, storybooks } from '@server/db/schema';
import { env, providers } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';
import { generateGeminiImage, type ImageReference } from '@server/services/ai/geminiImage';
import type { ImageAspectRatio } from '@server/services/ai/imageTypes';
import { settleGeneration, type GenerationState } from '@server/services/generations';
import { type BucketOptions, getObject, listObjects, putObject, removeObjects, supabaseStorage } from '@server/services/storage/supabase';
import type { StoryDraft, StorybookBrief } from '@server/services/storybook';
import { buildStorybookPdf, type PdfPictures } from '@server/services/storybook/pdf';
import { compactPicture, type StoryPicture } from '@server/services/storybook/picture';
import { runInBackground } from '@server/shared/backgroundWork';
import { countryName } from '@server/shared/countries';

/**
 * Illustration « maison » d'un conte : le même personnage à chaque page.
 *
 * Le circuit de mise en page externe ne reçoit qu'une fiche écrite du personnage, recopiée à
 * chaque image : la fillette changeait de coiffure et de robe d'une page à l'autre, et l'écran
 * devait prévenir l'auteur. Ici, le serveur dessine d'abord une PLANCHE DE RÉFÉRENCE — le
 * personnage principal et les personnages secondaires récurrents, en pied, côte à côte — puis
 * donne cette planche en modèle au moteur d'images pour chaque page.
 *
 * Mesuré le 04/10/2026 sur de vraies images : mêmes couettes, mêmes rubans, même robe, même
 * grand-père à lunettes sur toutes les scènes, de jour comme de nuit ; 9 à 13 secondes par page.
 *
 * Un conte compte jusqu'à vingt-deux images : trop pour une seule requête. L'illustration avance
 * donc PAR TRANCHES, chacune tenant dans le temps d'une fonction ; chaque page terminée est
 * déposée aussitôt, et le suivi de l'écran relance une tranche tant qu'il reste des pages. Un
 * bail empêche deux tranches de dessiner la même page.
 *
 * Les pages vont au stockage de fichiers, pas en base : une trentaine de contes rempliraient la
 * base, et une base pleine arrête tout le site.
 */

/** Valeur de `storybooks.engine` pour ce circuit. */
export const OWN_ENGINE = 'maison';
/** Valeur de `generations.provider` : sert au suivi et au remboursement. */
export const OWN_PROVIDER = 'conte';
const REF_PREFIX = 'conte_';

const BUCKET: BucketOptions = {
  id: 'contes',
  public: false,
  fileSizeLimit: 25 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
};

/** Temps pendant lequel une tranche lance de nouvelles pages ; la dernière page lancée finit après. */
const SLICE_BUDGET_MS = 200_000;
/** Tranche lancée dans la requête de création : la planche a déjà pris sa part des 300 secondes. */
const FIRST_SLICE_BUDGET_MS = 120_000;
/** Une image, tous modèles confondus. */
const IMAGE_BUDGET_MS = 75_000;
/** Bail renouvelé à chaque page : il doit couvrir une image entière et son dépôt. */
const LEASE_MS = 180_000;
/** Après une tranche qui a échoué sur une page, on souffle avant la suivante. */
const RETRY_PAUSE_MS = 15_000;
const MAX_SLICES = 6;
const CONCURRENCY = 3;

/** Le projet du moteur d'images est fermé : aucune tranche suivante n'y changera rien. */
const FATAL_CODES = new Set(['GEMINI_IMAGE_BILLING_REQUIRED', 'GEMINI_IMAGE_ACCESS_DENIED', 'PROVIDER_NOT_CONFIGURED']);
/** La scène elle-même est refusée : on l'adoucit au lieu d'abandonner le conte. */
const SOFTEN_CODES = new Set(['GEMINI_IMAGE_BLOCKED', 'GEMINI_IMAGE_MISSING']);

const DEFAULT_STYLE = "warm children's picture book illustration, soft colours, gentle light";

type StorybookRow = typeof storybooks.$inferSelect;

export function ownIllustrationAvailable(): boolean {
  return providers.gemini && supabaseStorage() !== null;
}

export const isOwnGeneration = (generationRef: string) => generationRef.startsWith(REF_PREFIX);

const objectPath = (generationRef: string, name: string) => `${generationRef}/${name}`;
const pagePath = (generationRef: string, position: number) => objectPath(generationRef, `page-${position}`);

/* -------------------------------------------------------------------------- */
/*  Consignes                                                                  */
/* -------------------------------------------------------------------------- */

interface CastMember {
  name: string;
  sheet: string;
}

/** Personnages de la planche, de gauche à droite : le principal, puis deux secondaires au plus. */
export function castOf(brief: StorybookBrief, story: StoryDraft): CastMember[] {
  return [{ name: brief.heroName, sheet: story.characterSheet }, ...(story.cast ?? []).slice(0, 2)];
}

const styleOf = (brief: StorybookBrief) => brief.visualStyle?.trim() || DEFAULT_STYLE;

export function buildSheetPrompt(brief: StorybookBrief, story: StoryDraft): string {
  const cast = castOf(brief, story);
  const alone = cast.length === 1;
  return [
    `Character reference sheet for a children's picture book. Style: ${styleOf(brief)}.`,
    ...(alone
      ? [`The character — ${cast[0]!.name}: ${cast[0]!.sheet}.`, 'Show the character ONCE, full body, standing, facing the viewer.']
      : [
          'The characters, standing side by side from left to right, each shown ONCE, full body, facing the viewer:',
          ...cast.map((member, index) => `${index + 1}. ${member.name}: ${member.sheet}.`),
        ]),
    'Plain light cream background, nothing else in the picture.',
    'No text, no letters, no labels, no numbers, no watermark.',
  ].join('\n');
}

const firstSentence = (text: string) => /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;

/**
 * Consigne d'une page (rang 0 : la couverture).
 *
 * `level` adoucit la scène quand le filtre du moteur la refuse : 1 n'en garde que la première
 * phrase, 2 la remplace par une scène calme. Un conte pour enfants ne devrait jamais en arriver
 * là, mais une scène d'orage ou de chagrin suffit parfois à déclencher un refus — et une page
 * refusée ne doit pas faire perdre les dix-neuf autres.
 */
export function buildScenePrompt(brief: StorybookBrief, story: StoryDraft, position: number, level: 0 | 1 | 2 = 0): string {
  const cast = castOf(brief, story);
  const written = position === 0 ? story.coverIllustration : (story.pages[position - 1]?.illustration ?? '');
  const scene =
    level === 2
      ? `${brief.heroName} smiling, in a calm everyday moment of the story.`
      : level === 1
        ? `${firstSentence(written)} Calm, gentle, reassuring mood.`
        : written;
  return [
    cast.length === 1
      ? `The attached image is the reference sheet of ${cast[0]!.name}, the main character of a children's picture book.`
      : `The attached image is the character reference sheet of a children's picture book. From left to right: ${cast.map((member) => member.name).join(', ')}.`,
    'Draw a NEW illustration for the book. Every character that appears must look EXACTLY like its reference: identical face, skin tone, hair, clothes and colours. Do not change any outfit or hairstyle. Only draw the characters named in the scene.',
    `Scene: ${scene}`,
    `Setting: ${countryName(brief.country, 'en')}.`,
    ...(position === 0
      ? [
          'This is the COVER of the book: a joyful, striking composition with the main character clearly visible in the upper two thirds.',
          'The illustration fills the whole frame from edge to edge: no border, no blank paper, no empty band. The lower third shows only simple ground or vegetation, with no face and no important detail.',
        ]
      : []),
    `Style: ${styleOf(brief)} — the same drawing style as the reference sheet.`,
    'Full scene with a complete background, never the plain backdrop of the reference sheet. No text, no letters, no speech bubbles, no watermark.',
  ].join('\n');
}

async function draw(prompt: string, aspectRatio: ImageAspectRatio, references: ImageReference[] = []): Promise<StoryPicture> {
  const image = await generateGeminiImage({ prompt, aspectRatio, references, models: env.STORYBOOK_IMAGE_MODELS, budgetMs: IMAGE_BUDGET_MS });
  return compactPicture(image);
}

async function drawPage(brief: StorybookBrief, story: StoryDraft, position: number, sheet: ImageReference): Promise<StoryPicture> {
  let refusal: unknown;
  for (const level of [0, 1, 2] as const) {
    try {
      return await draw(buildScenePrompt(brief, story, position, level), position === 0 ? '3:4' : '4:3', [sheet]);
    } catch (error) {
      // Une panne se réessaie à la tranche suivante ; seul un refus de la scène justifie de l'adoucir.
      if (!(error instanceof AppError) || !error.code || !SOFTEN_CODES.has(error.code)) throw error;
      refusal = error;
    }
  }
  throw refusal;
}

/* -------------------------------------------------------------------------- */
/*  Lancement                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Dessine la planche de référence et ouvre le conte. C'est aussi l'épreuve du moteur : s'il
 * refuse ici, rien n'est encore engagé et l'appelant peut passer par l'autre circuit.
 */
export async function startOwnIllustration(brief: StorybookBrief, story: StoryDraft): Promise<{ generationId: string }> {
  const target = supabaseStorage();
  if (!target) throw providerUnavailable('illustration des contes');
  const generationId = `${REF_PREFIX}${randomUUID()}`;
  const sheet = await draw(buildSheetPrompt(brief, story), castOf(brief, story).length === 1 ? '1:1' : '4:3');
  await putObject(target, BUCKET, objectPath(generationId, 'planche'), sheet.bytes, sheet.mimeType);
  return { generationId };
}

/* -------------------------------------------------------------------------- */
/*  Tranches                                                                   */
/* -------------------------------------------------------------------------- */

async function settle(generationRef: string, state: GenerationState): Promise<void> {
  const [generation] = await getDb()
    .select()
    .from(generations)
    .where(and(eq(generations.provider, OWN_PROVIDER), eq(generations.providerRef, generationRef)))
    .limit(1);
  if (generation) await settleGeneration(generation, state, state === 'completed' ? 'pdf' : null);
}

/** Efface les fichiers de contes (planche, pages, PDF). Sans effet sans stockage ; n'échoue jamais. */
export async function removeStoryFiles(generationRefs: string[]): Promise<void> {
  const target = supabaseStorage();
  if (!target) return;
  for (const generationRef of generationRefs) {
    try {
      const names = await listObjects(target, BUCKET.id, generationRef);
      if (names.length > 0) await removeObjects(target, BUCKET.id, names.map((entry) => objectPath(generationRef, entry.name)));
    } catch (error) {
      console.warn('[conte] fichiers non effacés :', generationRef, error instanceof Error ? error.message : error);
    }
  }
}

/**
 * Contes d'un compte dont des fichiers sont gardés. À relever AVANT de supprimer le compte (les
 * lignes partent avec lui), pour effacer les fichiers une fois la suppression acquise.
 */
export async function storyFilesOf(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ generationRef: storybooks.generationRef })
    .from(storybooks)
    .where(and(eq(storybooks.userId, userId), eq(storybooks.engine, OWN_ENGINE)));
  return rows.map((row) => row.generationRef);
}

/** Abandonne le conte : il passe en échec, ses points sont rendus, ses fichiers effacés. */
async function abandon(row: StorybookRow, reason: string): Promise<void> {
  console.error(`[conte] ${row.generationRef} abandonné : ${reason}`);
  await getDb()
    .update(storybooks)
    .set({ status: 'failed', completedAt: new Date(), leaseUntil: null })
    .where(and(eq(storybooks.id, row.id), eq(storybooks.status, 'pending')));
  await settle(row.generationRef, 'failed');
  await removeStoryFiles([row.generationRef]);
}

const positionsOf = (pages: number) => Array.from({ length: pages + 1 }, (_, position) => position);

/**
 * Avance l'illustration d'un conte d'une tranche. Sans effet si une autre tranche tient le bail,
 * ou si le conte n'est plus en cours : on peut donc l'appeler à chaque suivi sans précaution.
 */
export async function advanceIllustration(generationRef: string, budgetMs = SLICE_BUDGET_MS): Promise<void> {
  const db = getDb();
  const startedAt = new Date();
  const [row] = await db
    .update(storybooks)
    .set({ leaseUntil: new Date(startedAt.getTime() + LEASE_MS), slices: sql`${storybooks.slices} + 1` })
    .where(
      and(
        eq(storybooks.generationRef, generationRef),
        eq(storybooks.engine, OWN_ENGINE),
        eq(storybooks.status, 'pending'),
        or(isNull(storybooks.leaseUntil), lt(storybooks.leaseUntil, startedAt)),
      ),
    )
    .returning();
  if (!row) return;

  const target = supabaseStorage();
  if (!target || !row.brief) return abandon(row, 'stockage ou brief absent');
  if (row.slices > MAX_SLICES) return abandon(row, `${MAX_SLICES} tranches sans venir à bout des pages`);

  const brief = row.brief as unknown as StorybookBrief;
  const story = row.story as unknown as StoryDraft;
  const stored = await getObject(target, BUCKET.id, objectPath(generationRef, 'planche'));
  if (!stored) return abandon(row, 'planche de référence introuvable');
  const sheet: ImageReference = {
    mimeType: (stored.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim(),
    bytes: Buffer.from(await stored.arrayBuffer()),
  };

  const done = new Set(row.illustrated);
  const queue = positionsOf(story.pages.length).filter((position) => !done.has(position));
  const deadline = Date.now() + budgetMs;
  let fatal: string | null = null;
  let failures = 0;

  const worker = async () => {
    while (!fatal && Date.now() < deadline) {
      const position = queue.shift();
      if (position === undefined) return;
      try {
        const picture = await drawPage(brief, story, position, sheet);
        await putObject(target, BUCKET, pagePath(generationRef, position), picture.bytes, picture.mimeType);
        const entry = JSON.stringify([position]);
        await db
          .update(storybooks)
          .set({
            illustrated: sql`case when ${storybooks.illustrated} @> ${entry}::jsonb then ${storybooks.illustrated} else ${storybooks.illustrated} || ${entry}::jsonb end`,
            leaseUntil: new Date(Date.now() + LEASE_MS),
          })
          .where(eq(storybooks.id, row.id));
        done.add(position);
      } catch (error) {
        failures += 1;
        const code = error instanceof AppError ? (error.code ?? '') : '';
        console.warn(`[conte] ${generationRef}, page ${position} :`, code || (error instanceof Error ? error.message : error));
        if (FATAL_CODES.has(code)) fatal = code;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (done.size === story.pages.length + 1) {
    await db
      .update(storybooks)
      .set({ status: 'completed', completedAt: new Date(), leaseUntil: null })
      .where(and(eq(storybooks.id, row.id), eq(storybooks.status, 'pending')));
    await settle(generationRef, 'completed');
    return;
  }
  if (fatal) return abandon(row, `moteur d'images fermé (${fatal})`);

  // Il reste des pages : le bail est rendu, et le prochain suivi lancera la tranche suivante.
  await db
    .update(storybooks)
    .set({ leaseUntil: failures > 0 ? new Date(Date.now() + RETRY_PAUSE_MS) : null })
    .where(eq(storybooks.id, row.id));
}

const leaseFree = (row: Pick<StorybookRow, 'leaseUntil'>, now: Date) => !row.leaseUntil || row.leaseUntil < now;

/** Première tranche, lancée dès que le conte est enregistré. */
export function beginIllustration(generationRef: string): void {
  runInBackground(() => advanceIllustration(generationRef, FIRST_SLICE_BUDGET_MS), 'illustration du conte');
}

/** Relance les contes en cours que plus aucune tranche ne dessine (écran fermé, fonction coupée). */
export function resumeStalled(rows: Pick<StorybookRow, 'generationRef' | 'engine' | 'status' | 'leaseUntil'>[]): void {
  const now = new Date();
  for (const row of rows) {
    if (row.engine === OWN_ENGINE && row.status === 'pending' && leaseFree(row, now)) {
      runInBackground(() => advanceIllustration(row.generationRef), 'illustration du conte');
    }
  }
}

export interface OwnStorybookStatus {
  generationId: string;
  status: GenerationState;
  storybookId: string;
  /** Images déposées sur images attendues (couverture comprise). */
  progress: { done: number; total: number };
  errorMessage?: string;
}

/** État d'un conte illustré ici. Relance une tranche si plus personne n'y travaille. */
export async function getOwnStorybookStatus(generationRef: string): Promise<OwnStorybookStatus> {
  const [row] = await getDb().select().from(storybooks).where(eq(storybooks.generationRef, generationRef)).limit(1);
  if (!row) throw new AppError(404, 'Génération introuvable.', 'STORYBOOK_NOT_FOUND');
  resumeStalled([row]);
  const status = row.status as GenerationState;
  return {
    generationId: generationRef,
    status,
    storybookId: row.id,
    progress: { done: row.illustrated.length, total: row.pages + 1 },
    ...(status === 'failed' ? { errorMessage: 'L’illustration n’a pas abouti : vos points ont été rendus.' } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/*  Fichiers                                                                   */
/* -------------------------------------------------------------------------- */

async function readPicture(generationRef: string, name: string): Promise<StoryPicture | null> {
  const target = supabaseStorage();
  if (!target) return null;
  const stored = await getObject(target, BUCKET.id, objectPath(generationRef, name));
  if (!stored) return null;
  return {
    mimeType: (stored.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim(),
    bytes: Buffer.from(await stored.arrayBuffer()),
  };
}

/** Morceaux d'un quart de mégaoctet : l'hébergeur refuse une réponse de plus de 4,5 Mo d'un seul bloc. */
function* chunksOf(bytes: Buffer, size = 256 * 1024) {
  for (let start = 0; start < bytes.length; start += size) yield bytes.subarray(start, start + size);
}

/** PDF d'un conte illustré ici : assemblé à la première demande, puis gardé à côté des pages. */
export async function sendOwnStorybookPdf(row: StorybookRow, fileName: string, res: ExpressResponse): Promise<void> {
  const target = supabaseStorage();
  if (!target) throw providerUnavailable('illustration des contes');
  const story = row.story as unknown as StoryDraft;

  const kept = await getObject(target, BUCKET.id, objectPath(row.generationRef, 'conte.pdf'));
  let pdf: Buffer;
  if (kept) {
    pdf = Buffer.from(await kept.arrayBuffer());
  } else {
    const pictures: PdfPictures = new Map();
    await Promise.all(
      positionsOf(story.pages.length).map(async (position) => {
        const picture = await readPicture(row.generationRef, `page-${position}`);
        if (picture) pictures.set(position, picture);
      }),
    );
    if (pictures.size === 0) throw new AppError(502, 'Le PDF de ce conte n’a pas pu être produit.', 'STORYBOOK_PDF_FAILED');
    pdf = buildStorybookPdf({ title: story.title, language: row.language, pages: story.pages }, pictures);
    await putObject(target, BUCKET, objectPath(row.generationRef, 'conte.pdf'), pdf, 'application/pdf').catch((error: unknown) =>
      console.warn('[conte] PDF non gardé :', error instanceof Error ? error.message : error),
    );
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  await pipeline(Readable.from(chunksOf(pdf)), res);
}

/** Illustration d'une page (0 : la couverture), pour l'aperçu à l'écran. */
export async function sendOwnStorybookPicture(row: StorybookRow, position: number, res: ExpressResponse): Promise<void> {
  const picture = row.illustrated.includes(position) ? await readPicture(row.generationRef, `page-${position}`) : null;
  if (!picture) throw new AppError(404, 'Illustration introuvable.', 'STORYBOOK_PICTURE_NOT_FOUND');
  res.setHeader('Content-Type', picture.mimeType);
  // Une page déposée ne change plus : le navigateur n'a pas à la redemander.
  res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
  res.end(picture.bytes);
}
