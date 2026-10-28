import type { Response as ExpressResponse } from 'express';
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { covers, guides } from '@server/db/schema';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';

/**
 * Couvertures DÉJÀ générées, des ebooks du Studio et des guides. L'image est en base : elle ouvre
 * encore chaque export de son ouvrage.
 *
 * La génération de couvertures est retirée du site le 28/10/2026 avec toute génération d'images
 * (décision du propriétaire). Un ouvrage sans couverture générée prend la couverture de mise en
 * page du site (titre et sous-titre, sans image).
 */

type CoverRow = typeof covers.$inferSelect;

/** Complète (elle porte son titre, on la montre telle quelle) ou illustration (le titre est posé dessus). */
export type CoverLayout = 'designed' | 'illustration';
const layoutOf = (value: string): CoverLayout => (value === 'designed' ? 'designed' : 'illustration');

function serializeCover(row: CoverRow) {
  return {
    id: row.id,
    subject: row.subject,
    subjectId: row.subjectId,
    status: row.status as 'pending' | 'ready' | 'failed',
    mimeType: row.mimeType,
    layout: layoutOf(row.layout),
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

/**
 * Les couvertures prêtes d'un compte pour un type de sujet, une par sujet (la plus récente),
 * SANS leurs octets : de quoi montrer la couverture de chaque ouvrage sur sa carte en une seule
 * lecture, au lieu d'une demande par carte.
 */
export async function listCovers(auth: RequestAuth, subject: string): Promise<CoverView[]> {
  const rows = await getDb()
    .select({
      id: covers.id,
      subject: covers.subject,
      subjectId: covers.subjectId,
      status: covers.status,
      mimeType: covers.mimeType,
      layout: covers.layout,
      createdAt: covers.createdAt,
      updatedAt: covers.updatedAt,
    })
    .from(covers)
    .where(and(eq(covers.userId, auth.account.user.id), eq(covers.subject, subject), eq(covers.status, 'ready')))
    .orderBy(desc(covers.createdAt))
    .limit(300);
  const seen = new Set<string>();
  return rows
    .filter((row) => (seen.has(row.subjectId) ? false : (seen.add(row.subjectId), true)))
    .map((row) => ({ ...row, status: 'ready' as const, layout: layoutOf(row.layout), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
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

export async function sendCoverImage(auth: RequestAuth, coverId: string | undefined, res: ExpressResponse): Promise<void> {
  const row = await ownedCover(auth, coverId);
  if (row.status !== 'ready' || !row.data || !row.mimeType) {
    throw new AppError(409, 'La couverture n’est pas encore prête.', 'COVER_NOT_READY');
  }
  const bytes = Buffer.from(row.data, 'base64');
  res.setHeader('Content-Type', row.mimeType);
  // Les exports la lisent par cette route : ils doivent savoir si elle porte déjà son titre.
  res.setHeader('X-Cover-Layout', layoutOf(row.layout));
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
