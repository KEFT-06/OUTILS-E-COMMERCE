import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { guideTranslations, guides } from '@server/db/schema';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { latestCover } from '@server/services/covers';
import { reviewLevelOf, wordCount, type GuideSection, type TranslationCheck, type TranslationStatus } from '@server/shared/guides';

/**
 * Guides DÉJÀ écrits, et leurs traductions.
 *
 * Le module des guides multilingues (écriture, traduction automatique, relecture par l'auteur ou
 * par un locuteur natif) est retiré du site le 28/10/2026 (décision du propriétaire). Les guides
 * existants restent à leurs auteurs : ils se listent dans « Mes créations » et chacune de leurs
 * versions s'imprime en PDF. Rien ne s'y écrit plus.
 */

type GuideRow = typeof guides.$inferSelect;
type TranslationRow = typeof guideTranslations.$inferSelect;

const uuidSchema = z.string().uuid();
const iso = (date: Date | null) => date?.toISOString() ?? null;

async function ownedGuide(auth: RequestAuth, guideId: string | undefined): Promise<GuideRow> {
  const parsed = uuidSchema.safeParse(guideId);
  const notFound = new AppError(404, 'Guide introuvable.', 'GUIDE_NOT_FOUND');
  if (!parsed.success) throw notFound;
  const [row] = await getDb()
    .select()
    .from(guides)
    .where(and(eq(guides.id, parsed.data), eq(guides.userId, auth.account.user.id)))
    .limit(1);
  if (!row) throw notFound;
  return row;
}

const aDuTexte = (section: GuideSection) => Boolean(section.heading.trim() || section.body.trim());

/** Sections traduites sur sections à traduire : une traduction restée en cours n'est pas complète. */
function progressOf(source: readonly GuideSection[], translated: readonly GuideSection[]): { done: number; total: number } {
  const faites = new Map(translated.map((section) => [section.id, section]));
  const aTraduire = source.filter(aDuTexte);
  const restantes = aTraduire.filter((section) => !aDuTexte(faites.get(section.id) ?? { id: section.id, heading: '', body: '' }));
  return { done: aTraduire.length - restantes.length, total: aTraduire.length };
}

function serializeTranslation(row: TranslationRow, guide: Pick<GuideRow, 'revision' | 'sections'>) {
  return {
    id: row.id,
    language: row.language,
    title: row.title,
    sections: row.sections,
    checks: row.checks as TranslationCheck[],
    level: reviewLevelOf(row),
    status: row.status as TranslationStatus,
    progress: row.status === 'translating' ? progressOf(guide.sections, row.sections) : null,
    outdated: row.sourceRevision < guide.revision,
    words: wordCount(row.sections),
    authorValidatedAt: iso(row.authorValidatedAt),
    reviewRequestedAt: iso(row.reviewRequestedAt),
    reviewNote: row.reviewNote,
    reviewClaimedAt: row.status === 'in_review' ? iso(row.reviewClaimedAt) : null,
    reviewedAt: iso(row.reviewedAt),
    reviewerComment: row.reviewerComment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listGuides(auth: RequestAuth) {
  const db = getDb();
  const rows = await db.select().from(guides).where(eq(guides.userId, auth.account.user.id)).orderBy(desc(guides.updatedAt));
  const translations =
    rows.length === 0
      ? []
      : await db
          .select({
            guideId: guideTranslations.guideId,
            language: guideTranslations.language,
            status: guideTranslations.status,
            sourceRevision: guideTranslations.sourceRevision,
            authorValidatedAt: guideTranslations.authorValidatedAt,
            reviewedAt: guideTranslations.reviewedAt,
          })
          .from(guideTranslations)
          .where(inArray(guideTranslations.guideId, rows.map((row) => row.id)))
          .orderBy(asc(guideTranslations.createdAt));

  return {
    guides: rows.map((guide) => ({
      id: guide.id,
      title: guide.title,
      sourceLanguage: guide.sourceLanguage,
      source: guide.sourceKind && guide.sourceId ? { kind: guide.sourceKind, id: guide.sourceId } : null,
      words: wordCount(guide.sections),
      hasCover: Boolean(guide.coverId),
      updatedAt: guide.updatedAt.toISOString(),
      translations: translations
        .filter((translation) => translation.guideId === guide.id)
        .map((translation) => ({
          language: translation.language,
          level: reviewLevelOf(translation),
          status: translation.status as TranslationStatus,
          outdated: translation.sourceRevision < guide.revision,
        })),
    })),
  };
}

export async function getGuide(auth: RequestAuth, guideId: string | undefined) {
  const guide = await ownedGuide(auth, guideId);
  const rows = await getDb()
    .select()
    .from(guideTranslations)
    .where(eq(guideTranslations.guideId, guide.id))
    .orderBy(asc(guideTranslations.createdAt));
  return {
    id: guide.id,
    title: guide.title,
    sourceLanguage: guide.sourceLanguage,
    sections: guide.sections,
    terms: guide.terms,
    revision: guide.revision,
    source: guide.sourceKind && guide.sourceId ? { kind: guide.sourceKind, id: guide.sourceId } : null,
    words: wordCount(guide.sections),
    cover: await latestCover(auth, 'guide', guide.id),
    translations: rows.map((row) => serializeTranslation(row, guide)),
    createdAt: guide.createdAt.toISOString(),
    updatedAt: guide.updatedAt.toISOString(),
  };
}
