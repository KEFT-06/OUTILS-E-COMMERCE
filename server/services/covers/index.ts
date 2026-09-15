import type { Response as ExpressResponse } from 'express';
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { covers, guides } from '@server/db/schema';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { VISUAL_MODEL_PATH, generationStateOf } from '@server/services/creatives';
import { findOwnedGeneration, runBilledGeneration, settleGeneration } from '@server/services/generations';
import { fetchMedia, getGenerationStatus, submitGeneration } from '@server/services/higgsfield';

/**
 * Images de couverture des guides et des ebooks du Studio.
 *
 * Générées par le modèle d'image de Higgsfield, sans aucun texte : le titre est
 * posé ensuite par la mise en page, dans la langue de chaque export. L'image est
 * recopiée en base dès qu'elle est prête, car le fournisseur efface ses fichiers
 * après environ sept jours.
 */

export const COVER_STYLES = ['illustration', 'photo', 'minimal'] as const;

const STYLE_DIRECTION: Record<(typeof COVER_STYLES)[number], string> = {
  illustration: 'Modern editorial illustration, bold simple shapes, harmonious warm palette, clean composition.',
  photo: 'Editorial photograph, natural light, shallow depth of field, rich but realistic colours.',
  minimal: 'Minimalist abstract composition, soft gradients and simple geometric shapes, calm negative space.',
};

/** Au-delà, l'image est refusée : elle alourdirait chaque export et la base. */
const MAX_COVER_BYTES = 12 * 1024 * 1024;

export const coverRequestSchema = z.object({
  subject: z.enum(['guide', 'product']),
  subjectId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(2).max(200),
  subtitle: z.string().trim().max(300).optional(),
  /** Ce que l'image doit montrer ; absent : une métaphore visuelle du sujet. */
  description: z.string().trim().max(500).optional(),
  style: z.enum(COVER_STYLES).default('illustration'),
});

export type CoverRequest = z.infer<typeof coverRequestSchema>;

/** Consigne du modèle d'image. Fonction pure, testable sans appel réseau. */
export function buildCoverPrompt(input: Pick<CoverRequest, 'title' | 'subtitle' | 'description' | 'style'>): string {
  return [
    `Cover artwork for a practical guide titled "${input.title}"${input.subtitle ? ` (${input.subtitle})` : ''}.`,
    input.description
      ? `The image shows: ${input.description}.`
      : 'The image evokes the subject of the guide through one strong, positive visual metaphor.',
    `Style: ${STYLE_DIRECTION[input.style]}`,
    'Vertical book-cover composition, with a calm and uncluttered upper third where the title will be placed afterwards.',
    'Absolutely no text, letters, numbers, logos or watermarks anywhere in the image.',
    'No real brands and no celebrities; people, if any, portrayed respectfully and without stereotypes.',
  ]
    .join('\n')
    .slice(0, 3000);
}

type CoverRow = typeof covers.$inferSelect;

function serializeCover(row: CoverRow) {
  return {
    id: row.id,
    subject: row.subject,
    subjectId: row.subjectId,
    status: row.status as 'pending' | 'ready' | 'failed',
    mimeType: row.mimeType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type CoverView = ReturnType<typeof serializeCover>;

async function ownedCover(auth: RequestAuth, coverId: string | undefined): Promise<CoverRow> {
  const parsed = z.string().uuid().safeParse(coverId);
  if (!parsed.success) throw new AppError(404, 'Couverture introuvable.', 'COVER_NOT_FOUND');
  const [row] = await getDb()
    .select()
    .from(covers)
    .where(and(eq(covers.id, parsed.data), eq(covers.userId, auth.account.user.id)))
    .limit(1);
  if (!row) throw new AppError(404, 'Couverture introuvable.', 'COVER_NOT_FOUND');
  return row;
}

export async function createCover(auth: RequestAuth, input: CoverRequest): Promise<CoverView> {
  const prompt = buildCoverPrompt(input);
  const { result } = await runBilledGeneration({
    auth,
    actionId: 'cover_generation',
    kind: 'cover',
    provider: 'higgsfield',
    run: () => submitGeneration(VISUAL_MODEL_PATH, { prompt, num_images: 1, resolution: '2K', aspect_ratio: '9:16' }),
    describe: (status) => ({ providerRef: status.request_id, state: generationStateOf(status.status), fileFormat: null }),
  });

  const [row] = await getDb()
    .insert(covers)
    .values({
      userId: auth.account.user.id,
      subject: input.subject,
      subjectId: input.subjectId,
      prompt,
      status: generationStateOf(result.status) === 'failed' ? 'failed' : 'pending',
      providerRef: result.request_id,
    })
    .returning();
  return serializeCover(row!);
}

/** Dernière couverture d'un guide ou d'un produit (prête, ou en cours). */
export async function latestCover(auth: RequestAuth, subject: string, subjectId: string): Promise<CoverView | null> {
  const [row] = await getDb()
    .select()
    .from(covers)
    .where(and(eq(covers.userId, auth.account.user.id), eq(covers.subject, subject), eq(covers.subjectId, subjectId), ne(covers.status, 'failed')))
    .orderBy(desc(covers.createdAt))
    .limit(1);
  return row ? serializeCover(row) : null;
}

/**
 * État d'une couverture. Tant qu'elle est en cours, interroge le fournisseur ;
 * prête, recopie l'image en base et remplace l'ancienne couverture du même sujet.
 */
export async function refreshCover(auth: RequestAuth, coverId: string | undefined): Promise<CoverView> {
  const row = await ownedCover(auth, coverId);
  if (row.status !== 'pending' || !row.providerRef) return serializeCover(row);

  const status = await getGenerationStatus(row.providerRef);
  const state = generationStateOf(status.status);
  const generation = await findOwnedGeneration(auth, 'higgsfield', row.providerRef);
  const db = getDb();

  if (state === 'failed') {
    await settleGeneration(generation, 'failed');
    const [failed] = await db.update(covers).set({ status: 'failed', updatedAt: new Date() }).where(eq(covers.id, row.id)).returning();
    return serializeCover(failed!);
  }
  if (state === 'pending') return serializeCover(row);

  const imageUrl = status.images?.[0]?.url;
  if (!imageUrl) throw new AppError(502, 'Le fournisseur n’a renvoyé aucune image.', 'COVER_IMAGE_MISSING');
  const media = await fetchMedia(imageUrl);
  const bytes = Buffer.from(await media.arrayBuffer());
  if (bytes.length > MAX_COVER_BYTES) throw new AppError(502, 'L’image générée est trop lourde pour être conservée.', 'COVER_TOO_LARGE');
  const mimeType = media.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
  if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) throw new AppError(502, 'Format d’image inattendu.', 'COVER_UNEXPECTED_FORMAT');

  await settleGeneration(generation, 'completed', mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]);
  const ready = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(covers)
      .set({ status: 'ready', mimeType, data: bytes.toString('base64'), updatedAt: new Date() })
      .where(eq(covers.id, row.id))
      .returning();
    // Une seule couverture par sujet : la précédente est remplacée.
    await tx
      .delete(covers)
      .where(and(eq(covers.userId, row.userId), eq(covers.subject, row.subject), eq(covers.subjectId, row.subjectId), ne(covers.id, row.id)));
    if (row.subject === 'guide') {
      await tx.update(guides).set({ coverId: row.id }).where(and(eq(guides.userId, row.userId), eq(guides.id, row.subjectId)));
    }
    return updated!;
  });
  return serializeCover(ready);
}

export async function sendCoverImage(auth: RequestAuth, coverId: string | undefined, res: ExpressResponse): Promise<void> {
  const row = await ownedCover(auth, coverId);
  if (row.status !== 'ready' || !row.data || !row.mimeType) {
    throw new AppError(409, 'La couverture n’est pas encore prête.', 'COVER_NOT_READY');
  }
  const bytes = Buffer.from(row.data, 'base64');
  res.setHeader('Content-Type', row.mimeType);
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.end(bytes);
}

export async function deleteCover(auth: RequestAuth, coverId: string | undefined): Promise<void> {
  const row = await ownedCover(auth, coverId);
  await getDb().transaction(async (tx) => {
    if (row.subject === 'guide') {
      await tx.update(guides).set({ coverId: null }).where(and(eq(guides.userId, row.userId), eq(guides.coverId, row.id)));
    }
    await tx.delete(covers).where(eq(covers.id, row.id));
  });
}

/** Supprime les couvertures d'un sujet (guide effacé). */
export async function deleteSubjectCovers(userId: string, subject: string, subjectId: string): Promise<void> {
  await getDb().delete(covers).where(and(eq(covers.userId, userId), eq(covers.subject, subject), eq(covers.subjectId, subjectId)));
}
