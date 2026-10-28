import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response as ExpressResponse } from 'express';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { generations, storybooks } from '@server/db/schema';
import { AppError, providerUnavailable } from '@server/middleware';
import { settleGeneration, type GenerationState } from '@server/services/generations';
import { type BucketOptions, getObject, listObjects, putObject, removeObjects, supabaseStorage } from '@server/services/storage/supabase';
import type { StoryDraft } from '@server/services/storybook';
import { buildStorybookPdf, type PdfPictures } from '@server/services/storybook/pdf';
import type { StoryPicture } from '@server/services/storybook/picture';
import { runInBackground } from '@server/shared/backgroundWork';

/**
 * Contes illustrés « maison », produits AVANT le 28/10/2026.
 *
 * L'illustration des contes est retirée du site ce jour-là avec toute génération d'images
 * (décision du propriétaire). Les contes illustrés existants restent à leurs auteurs : leurs pages
 * sont dans le stockage de fichiers, leur PDF s'assemble à la première demande puis est gardé. Un
 * conte encore en cours d'illustration ne peut plus aboutir : il est clos en échec et ses points
 * sont rendus.
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

type StorybookRow = typeof storybooks.$inferSelect;

export const isOwnGeneration = (generationRef: string) => generationRef.startsWith(REF_PREFIX);

const objectPath = (generationRef: string, name: string) => `${generationRef}/${name}`;

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

/** Clôt un conte qui ne sera plus illustré : il passe en échec, ses points sont rendus, ses fichiers effacés. */
async function abandon(row: Pick<StorybookRow, 'id' | 'generationRef'>): Promise<void> {
  console.warn(`[conte] ${row.generationRef} clos : l'illustration des contes est retirée`);
  await getDb()
    .update(storybooks)
    .set({ status: 'failed', completedAt: new Date(), leaseUntil: null })
    .where(and(eq(storybooks.id, row.id), eq(storybooks.status, 'pending')));
  await settle(row.generationRef, 'failed');
  await removeStoryFiles([row.generationRef]);
}

const positionsOf = (pages: number) => Array.from({ length: pages + 1 }, (_, position) => position);

/** Contes illustrés encore en cours (écran fermé avant le retrait) : clos, points rendus. */
export function resumeStalled(rows: Pick<StorybookRow, 'id' | 'generationRef' | 'engine' | 'status'>[]): void {
  for (const row of rows) {
    if (row.engine === OWN_ENGINE && row.status === 'pending') runInBackground(() => abandon(row), 'clôture du conte');
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

/** État d'un conte illustré ici. Un conte resté en cours est clos (points rendus) au passage. */
export async function getOwnStorybookStatus(generationRef: string): Promise<OwnStorybookStatus> {
  const [row] = await getDb().select().from(storybooks).where(eq(storybooks.generationRef, generationRef)).limit(1);
  if (!row) throw new AppError(404, 'Génération introuvable.', 'STORYBOOK_NOT_FOUND');
  if (row.engine === OWN_ENGINE && row.status === 'pending') await abandon(row);
  const status = (row.status === 'pending' ? 'failed' : row.status) as GenerationState;
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
  if (!target) throw providerUnavailable('contes illustrés');
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
