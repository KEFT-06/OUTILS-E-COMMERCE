import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { guideTranslations, guides, users } from '@server/db/schema';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { debitCredits, effectiveLimits, refundDebit } from '@server/services/accounts';
import { deleteSubjectCovers, latestCover } from '@server/services/covers';
import { getActionCost } from '@server/services/credits';
import { runBilledGeneration } from '@server/services/generations';
import { translateGuide } from '@server/services/guides/translator';
import {
  GUIDE_LIMITS,
  checkTranslation,
  guideCharacters,
  hasBlockingIssues,
  reviewLevelOf,
  wordCount,
  type GuideSection,
  type TranslationCheck,
  type TranslationStatus,
} from '@server/shared/guides';
import { isLanguageCode, languageName } from '@server/shared/languages';

/**
 * Guides multilingues (module 10).
 *
 * Un guide est écrit une fois, dans sa langue d'origine, puis traduit langue par
 * langue. Chaque traduction a un niveau de relecture :
 *  - C : traduite par l'IA, contrôlée automatiquement ;
 *  - B : relue et validée par l'auteur ;
 *  - A : relue par un locuteur natif du réseau de relecteurs.
 *
 * Confidentialité : un relecteur ne voit ni le texte ni l'auteur d'une demande
 * avant de l'avoir prise en charge, et n'y a plus accès une fois la relecture rendue.
 */

export const languageSchema = z.string().refine(isLanguageCode, 'Langue inconnue.');

const sectionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  heading: z.string().max(GUIDE_LIMITS.headingMax),
  body: z.string().max(GUIDE_LIMITS.bodyMax),
});

export const guideInputSchema = z
  .object({
    title: z.string().trim().min(2, 'Donnez un titre au guide.').max(GUIDE_LIMITS.titleMax),
    sourceLanguage: languageSchema,
    sections: z
      .array(sectionSchema)
      .min(1, 'Ajoutez au moins une section.')
      .max(GUIDE_LIMITS.sectionsMax, `Un guide compte ${GUIDE_LIMITS.sectionsMax} sections au plus.`),
    /** Noms à garder tels quels : marque, produit, personne. */
    terms: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  })
  .superRefine((guide, ctx) => {
    if (new Set(guide.sections.map((section) => section.id)).size !== guide.sections.length) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'Deux sections portent le même identifiant.' });
    }
    if (!guide.sections.some((section) => section.heading.trim() || section.body.trim())) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'Le guide est vide.' });
    }
    if (guideCharacters(guide) > GUIDE_LIMITS.totalMax) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: `Le guide dépasse ${GUIDE_LIMITS.totalMax.toLocaleString('fr-FR')} caractères : découpez-le en plusieurs guides.`,
      });
    }
  });

export type GuideInput = z.infer<typeof guideInputSchema>;

export const translationEditSchema = z.object({
  title: z.string().trim().min(1, 'Le titre traduit ne peut pas être vide.').max(GUIDE_LIMITS.titleMax),
  sections: z.array(sectionSchema).max(GUIDE_LIMITS.sectionsMax),
});

export type TranslationEdit = z.infer<typeof translationEditSchema>;

export const translationRequestSchema = z.object({ languages: z.array(languageSchema).min(1).max(30) });

export const reviewRequestSchema = z.object({
  note: z.string().trim().max(500).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Acceptez qu’un relecteur lise ce guide pour le corriger.' }) }),
});

export const reviewCompleteSchema = z.object({ comment: z.string().trim().max(1000).optional() });

export const reviewerLanguagesSchema = z.object({ languages: z.array(languageSchema).max(8) });

type GuideRow = typeof guides.$inferSelect;
type TranslationRow = typeof guideTranslations.$inferSelect;

const uuidSchema = z.string().uuid();
const guideNotFound = () => new AppError(404, 'Guide introuvable.', 'GUIDE_NOT_FOUND');
const translationNotFound = () => new AppError(404, 'Traduction introuvable.', 'TRANSLATION_NOT_FOUND');
const iso = (date: Date | null) => date?.toISOString() ?? null;

function reviewBusy(status: string): AppError {
  return new AppError(
    409,
    status === 'in_review'
      ? 'Un relecteur travaille sur cette traduction : attendez la fin de sa relecture.'
      : 'Une relecture native est demandée : annulez la demande avant de modifier la traduction.',
    'REVIEW_IN_PROGRESS',
  );
}

const hasErrors = () =>
  new AppError(422, 'Corrigez d’abord les erreurs signalées (section manquante ou vide, titre absent).', 'TRANSLATION_HAS_ERRORS');

function cleanSections(sections: readonly GuideSection[]): GuideSection[] {
  return sections.map((section) => ({ id: section.id.trim(), heading: section.heading.trim(), body: section.body.replace(/\s+$/, '') }));
}

/** Sections traduites dans l'ordre du guide : une section non envoyée garde sa version précédente. */
function mergeSections(source: readonly GuideSection[], previous: readonly GuideSection[], edited: readonly GuideSection[]): GuideSection[] {
  const next = new Map(edited.map((section) => [section.id, section]));
  const before = new Map(previous.map((section) => [section.id, section]));
  return source.map((original) => {
    const section = next.get(original.id) ?? before.get(original.id);
    return { id: original.id, heading: section?.heading.trim() ?? '', body: section?.body.replace(/\s+$/, '') ?? '' };
  });
}

export async function ownedGuide(auth: RequestAuth, guideId: string | undefined): Promise<GuideRow> {
  const parsed = uuidSchema.safeParse(guideId);
  if (!parsed.success) throw guideNotFound();
  const [row] = await getDb()
    .select()
    .from(guides)
    .where(and(eq(guides.id, parsed.data), eq(guides.userId, auth.account.user.id)))
    .limit(1);
  if (!row) throw guideNotFound();
  return row;
}

async function ownedTranslation(guide: GuideRow, language: string | undefined): Promise<TranslationRow> {
  if (!language || !isLanguageCode(language)) throw translationNotFound();
  const [row] = await getDb()
    .select()
    .from(guideTranslations)
    .where(and(eq(guideTranslations.guideId, guide.id), eq(guideTranslations.language, language)))
    .limit(1);
  if (!row) throw translationNotFound();
  return row;
}

function serializeTranslation(row: TranslationRow, guide: Pick<GuideRow, 'revision'>) {
  return {
    id: row.id,
    language: row.language,
    title: row.title,
    sections: row.sections,
    checks: row.checks as TranslationCheck[],
    level: reviewLevelOf(row),
    status: row.status as TranslationStatus,
    /** Le guide a changé depuis cette traduction. */
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

async function guideView(auth: RequestAuth, guide: GuideRow) {
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
    words: wordCount(guide.sections),
    cover: await latestCover(auth, 'guide', guide.id),
    limits: { languages: effectiveLimits(auth.account).guideLanguages, used: rows.length },
    translations: rows.map((row) => serializeTranslation(row, guide)),
    createdAt: guide.createdAt.toISOString(),
    updatedAt: guide.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/*  Guides                                                                     */
/* -------------------------------------------------------------------------- */

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
    limits: { languages: effectiveLimits(auth.account).guideLanguages },
    guides: rows.map((guide) => ({
      id: guide.id,
      title: guide.title,
      sourceLanguage: guide.sourceLanguage,
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
  return guideView(auth, await ownedGuide(auth, guideId));
}

export async function createGuide(auth: RequestAuth, input: GuideInput) {
  const db = getDb();
  const [count] = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(guides)
    .where(eq(guides.userId, auth.account.user.id));
  if ((count?.value ?? 0) >= GUIDE_LIMITS.guidesMax) {
    throw new AppError(409, `Vous avez ${GUIDE_LIMITS.guidesMax} guides : supprimez-en un pour en créer un autre.`, 'GUIDE_COUNT_LIMIT');
  }

  const [row] = await db
    .insert(guides)
    .values({
      userId: auth.account.user.id,
      title: input.title,
      sourceLanguage: input.sourceLanguage,
      sections: cleanSections(input.sections),
      terms: [...new Set(input.terms)],
    })
    .returning();
  return guideView(auth, row!);
}

export async function updateGuide(auth: RequestAuth, guideId: string | undefined, input: GuideInput) {
  const guide = await ownedGuide(auth, guideId);
  const db = getDb();
  const sections = cleanSections(input.sections);
  const terms = [...new Set(input.terms)];

  if (input.sourceLanguage !== guide.sourceLanguage) {
    const [clash] = await db
      .select({ id: guideTranslations.id })
      .from(guideTranslations)
      .where(and(eq(guideTranslations.guideId, guide.id), eq(guideTranslations.language, input.sourceLanguage)))
      .limit(1);
    if (clash) {
      throw new AppError(
        409,
        `Ce guide a déjà une traduction en ${languageName(input.sourceLanguage).toLowerCase()} : supprimez-la avant d’en faire la langue d’origine.`,
        'SOURCE_LANGUAGE_TAKEN',
      );
    }
  }

  const changed =
    guide.title !== input.title ||
    guide.sourceLanguage !== input.sourceLanguage ||
    JSON.stringify(guide.sections) !== JSON.stringify(sections) ||
    JSON.stringify(guide.terms) !== JSON.stringify(terms);

  const [row] = await db
    .update(guides)
    .set({
      title: input.title,
      sourceLanguage: input.sourceLanguage,
      sections,
      terms,
      revision: changed ? guide.revision + 1 : guide.revision,
      updatedAt: new Date(),
    })
    .where(eq(guides.id, guide.id))
    .returning();
  return guideView(auth, row!);
}

export async function deleteGuide(auth: RequestAuth, guideId: string | undefined): Promise<void> {
  const guide = await ownedGuide(auth, guideId);
  const db = getDb();
  const waiting = await db
    .select()
    .from(guideTranslations)
    .where(and(eq(guideTranslations.guideId, guide.id), eq(guideTranslations.status, 'review_requested')));
  for (const row of waiting) {
    if (row.reviewDebitId) {
      await refundDebit({ debitTransactionId: row.reviewDebitId, generationId: null, note: 'Guide supprimé avant sa relecture : points rendus.' });
    }
  }
  await deleteSubjectCovers(auth.account.user.id, 'guide', guide.id);
  await db.delete(guides).where(eq(guides.id, guide.id));
}

/* -------------------------------------------------------------------------- */
/*  Traductions                                                                */
/* -------------------------------------------------------------------------- */

async function translateInto(auth: RequestAuth, guide: GuideRow, language: string, existing: TranslationRow | null): Promise<void> {
  const { result } = await runBilledGeneration({
    auth,
    actionId: 'guide_translation',
    kind: 'guide_translation',
    provider: 'gemini',
    run: () =>
      translateGuide({ title: guide.title, sections: guide.sections, from: guide.sourceLanguage, to: language, terms: guide.terms }),
    describe: () => ({ providerRef: null, state: 'completed' as const, fileFormat: null }),
  });

  const values = {
    title: result.title,
    sections: result.sections,
    checks: checkTranslation(guide, result, { language, terms: guide.terms }),
    sourceRevision: guide.revision,
    status: 'ready',
    authorValidatedAt: null,
    reviewRequestedAt: null,
    reviewNote: null,
    reviewDebitId: null,
    reviewerId: null,
    reviewClaimedAt: null,
    reviewedAt: null,
    reviewerComment: null,
    updatedAt: new Date(),
  };

  const db = getDb();
  if (existing) await db.update(guideTranslations).set(values).where(eq(guideTranslations.id, existing.id));
  else await db.insert(guideTranslations).values({ guideId: guide.id, userId: guide.userId, language, ...values });
}

/** Erreurs qui valent pour toutes les langues suivantes : inutile de continuer. */
const STOPPING_CODES = new Set(['INSUFFICIENT_CREDITS', 'TRANSLATION_ACCESS_DENIED', 'TRANSLATION_RATE_LIMITED', 'PROVIDER_NOT_CONFIGURED']);

export async function addTranslations(auth: RequestAuth, guideId: string | undefined, languages: readonly string[]) {
  const guide = await ownedGuide(auth, guideId);
  const requested = [...new Set(languages)].filter((code) => code !== guide.sourceLanguage);
  if (requested.length === 0) {
    throw new AppError(400, 'Choisissez au moins une langue différente de celle du guide.', 'NO_TARGET_LANGUAGE');
  }

  const existing = await getDb()
    .select({ language: guideTranslations.language })
    .from(guideTranslations)
    .where(eq(guideTranslations.guideId, guide.id));
  const taken = new Set(existing.map((row) => row.language));
  const toCreate = requested.filter((code) => !taken.has(code));
  if (toCreate.length === 0) throw new AppError(409, 'Ce guide est déjà traduit dans ces langues.', 'ALREADY_TRANSLATED');

  const limit = effectiveLimits(auth.account).guideLanguages;
  if (limit !== null && taken.size + toCreate.length > limit) {
    const left = Math.max(0, limit - taken.size);
    const plan = auth.account.plan.label;
    throw new AppError(
      403,
      left === 0
        ? `Votre palier ${plan} permet ${limit} langue${limit > 1 ? 's' : ''} par guide, toutes utilisées. Passez à un palier supérieur pour en ajouter.`
        : `Votre palier ${plan} permet ${limit} langue${limit > 1 ? 's' : ''} par guide : vous pouvez encore en ajouter ${left}.`,
      'GUIDE_LANGUAGE_LIMIT',
      { limit, left },
    );
  }

  const failures: { language: string; code: string; message: string }[] = [];
  let firstError: AppError | null = null;
  let created = 0;

  for (const language of toCreate) {
    try {
      await translateInto(auth, guide, language, null);
      created += 1;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      firstError ??= error;
      failures.push({ language, code: error.code ?? 'TRANSLATION_FAILED', message: error.message });
      if (error.code && STOPPING_CODES.has(error.code)) break;
    }
  }

  if (created === 0 && firstError) throw firstError;
  return { guide: await guideView(auth, guide), failures };
}

export async function retranslate(auth: RequestAuth, guideId: string | undefined, language: string | undefined) {
  const guide = await ownedGuide(auth, guideId);
  const row = await ownedTranslation(guide, language);
  if (row.status !== 'ready') throw reviewBusy(row.status);
  await translateInto(auth, guide, row.language, row);
  return guideView(auth, guide);
}

export async function editTranslation(auth: RequestAuth, guideId: string | undefined, language: string | undefined, input: TranslationEdit) {
  const guide = await ownedGuide(auth, guideId);
  const row = await ownedTranslation(guide, language);
  if (row.status !== 'ready') throw reviewBusy(row.status);

  const sections = mergeSections(guide.sections, row.sections, input.sections);
  if (row.title !== input.title || JSON.stringify(row.sections) !== JSON.stringify(sections)) {
    // Le texte relu n'est plus celui-ci : il redevient une traduction à valider.
    await getDb()
      .update(guideTranslations)
      .set({
        title: input.title,
        sections,
        checks: checkTranslation(guide, { title: input.title, sections }, { language: row.language, terms: guide.terms }),
        authorValidatedAt: null,
        reviewedAt: null,
        reviewerComment: null,
        updatedAt: new Date(),
      })
      .where(eq(guideTranslations.id, row.id));
  }
  return guideView(auth, guide);
}

/** Niveau B. Valider une traduction signalée comme ancienne confirme qu'elle suit le guide actuel. */
export async function validateTranslation(auth: RequestAuth, guideId: string | undefined, language: string | undefined) {
  const guide = await ownedGuide(auth, guideId);
  const row = await ownedTranslation(guide, language);
  if (row.status !== 'ready') throw reviewBusy(row.status);

  const checks = checkTranslation(guide, row, { language: row.language, terms: guide.terms });
  const db = getDb();
  if (hasBlockingIssues(checks)) {
    await db.update(guideTranslations).set({ checks }).where(eq(guideTranslations.id, row.id));
    throw hasErrors();
  }

  const outdated = row.sourceRevision < guide.revision;
  await db
    .update(guideTranslations)
    .set({
      checks,
      authorValidatedAt: new Date(),
      sourceRevision: guide.revision,
      ...(outdated ? { reviewedAt: null, reviewerComment: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(guideTranslations.id, row.id));
  return guideView(auth, guide);
}

export async function requestReview(
  auth: RequestAuth,
  guideId: string | undefined,
  language: string | undefined,
  input: { note?: string },
) {
  const guide = await ownedGuide(auth, guideId);
  const row = await ownedTranslation(guide, language);
  if (row.status !== 'ready') throw reviewBusy(row.status);
  if (row.sourceRevision < guide.revision) {
    throw new AppError(
      409,
      'Le guide a changé depuis cette traduction : retraduisez-la, ou validez-la après l’avoir mise à jour, avant de demander une relecture.',
      'TRANSLATION_OUTDATED',
    );
  }
  if (row.reviewedAt) throw new AppError(409, 'Cette traduction est déjà relue par un locuteur natif.', 'ALREADY_REVIEWED');

  const checks = checkTranslation(guide, row, { language: row.language, terms: guide.terms });
  if (hasBlockingIssues(checks)) throw hasErrors();

  const debit = await debitCredits({
    userId: auth.account.user.id,
    cost: await getActionCost('native_review'),
    actionId: 'native_review',
    unlimited: auth.account.plan.monthlyCredits === null,
  });

  const [claimed] = await getDb()
    .update(guideTranslations)
    .set({
      status: 'review_requested',
      checks,
      reviewRequestedAt: new Date(),
      reviewNote: input.note || null,
      reviewDebitId: debit.transactionId,
      updatedAt: new Date(),
    })
    .where(and(eq(guideTranslations.id, row.id), eq(guideTranslations.status, 'ready')))
    .returning({ id: guideTranslations.id });

  if (!claimed) {
    await refundDebit({ debitTransactionId: debit.transactionId, generationId: null, note: 'Demande de relecture déjà en cours : points rendus.' });
    throw reviewBusy('review_requested');
  }
  return guideView(auth, guide);
}

export async function cancelReview(auth: RequestAuth, guideId: string | undefined, language: string | undefined) {
  const guide = await ownedGuide(auth, guideId);
  const row = await ownedTranslation(guide, language);

  const [cancelled] = await getDb()
    .update(guideTranslations)
    .set({ status: 'ready', reviewRequestedAt: null, reviewNote: null, reviewDebitId: null, updatedAt: new Date() })
    .where(and(eq(guideTranslations.id, row.id), eq(guideTranslations.status, 'review_requested')))
    .returning({ id: guideTranslations.id });

  if (!cancelled) {
    throw new AppError(
      409,
      row.status === 'in_review'
        ? 'Un relecteur a déjà pris la demande en charge : elle ne peut plus être annulée.'
        : 'Aucune demande de relecture en attente.',
      'REVIEW_NOT_CANCELLABLE',
    );
  }
  if (row.reviewDebitId) {
    await refundDebit({ debitTransactionId: row.reviewDebitId, generationId: null, note: 'Demande de relecture annulée : points rendus.' });
  }
  return guideView(auth, guide);
}

export async function deleteTranslation(auth: RequestAuth, guideId: string | undefined, language: string | undefined) {
  const guide = await ownedGuide(auth, guideId);
  const row = await ownedTranslation(guide, language);
  if (row.status === 'in_review') throw reviewBusy('in_review');

  const [deleted] = await getDb()
    .delete(guideTranslations)
    .where(and(eq(guideTranslations.id, row.id), ne(guideTranslations.status, 'in_review')))
    .returning({ status: guideTranslations.status, reviewDebitId: guideTranslations.reviewDebitId });
  if (!deleted) throw reviewBusy('in_review');
  if (deleted.status === 'review_requested' && deleted.reviewDebitId) {
    await refundDebit({ debitTransactionId: deleted.reviewDebitId, generationId: null, note: 'Traduction supprimée avant sa relecture : points rendus.' });
  }
  return guideView(auth, guide);
}

/* -------------------------------------------------------------------------- */
/*  Réseau de relecteurs                                                       */
/* -------------------------------------------------------------------------- */

function reviewerLanguagesOf(auth: RequestAuth): string[] {
  return auth.account.user.reviewerLanguages.filter(isLanguageCode);
}

const reviewFields = {
  translation: guideTranslations,
  guide: { title: guides.title, sourceLanguage: guides.sourceLanguage, sections: guides.sections, terms: guides.terms },
};

type ReviewRow = { translation: TranslationRow; guide: { title: string; sourceLanguage: string; sections: GuideSection[]; terms: string[] } };

function reviewItem({ translation, guide }: ReviewRow) {
  return {
    id: translation.id,
    guideTitle: guide.title,
    from: guide.sourceLanguage,
    to: translation.language,
    words: wordCount(guide.sections),
    note: translation.reviewNote,
    requestedAt: iso(translation.reviewRequestedAt),
    claimedAt: iso(translation.reviewClaimedAt),
    reviewedAt: iso(translation.reviewedAt),
  };
}

export async function reviewerDashboard(auth: RequestAuth, languages = reviewerLanguagesOf(auth)) {
  const db = getDb();
  const me = auth.account.user.id;

  const queue =
    languages.length === 0
      ? []
      : await db
          .select(reviewFields)
          .from(guideTranslations)
          .innerJoin(guides, eq(guides.id, guideTranslations.guideId))
          .where(
            and(
              eq(guideTranslations.status, 'review_requested'),
              inArray(guideTranslations.language, languages),
              ne(guideTranslations.userId, me),
            ),
          )
          .orderBy(asc(guideTranslations.reviewRequestedAt))
          .limit(50);

  const mine = await db
    .select(reviewFields)
    .from(guideTranslations)
    .innerJoin(guides, eq(guides.id, guideTranslations.guideId))
    .where(and(eq(guideTranslations.status, 'in_review'), eq(guideTranslations.reviewerId, me)))
    .orderBy(asc(guideTranslations.reviewClaimedAt));

  const completed = await db
    .select(reviewFields)
    .from(guideTranslations)
    .innerJoin(guides, eq(guides.id, guideTranslations.guideId))
    .where(and(eq(guideTranslations.reviewerId, me), eq(guideTranslations.status, 'ready'), isNotNull(guideTranslations.reviewedAt)))
    .orderBy(desc(guideTranslations.reviewedAt))
    .limit(20);

  return {
    languages,
    queue: queue.map(reviewItem),
    mine: mine.map(reviewItem),
    // Relecture rendue : titre et langues seulement, le texte n'est plus accessible.
    completed: completed.map((row) => {
      const { note: _note, ...item } = reviewItem(row);
      return item;
    }),
  };
}

export async function setReviewerLanguages(auth: RequestAuth, languages: readonly string[]) {
  const unique = [...new Set(languages)];
  await getDb().update(users).set({ reviewerLanguages: unique, updatedAt: new Date() }).where(eq(users.id, auth.account.user.id));
  return reviewerDashboard(auth, unique);
}

async function assignment(auth: RequestAuth, translationId: string | undefined): Promise<ReviewRow> {
  const parsed = uuidSchema.safeParse(translationId);
  const notFound = () => new AppError(404, 'Relecture introuvable, ou déjà rendue.', 'REVIEW_NOT_FOUND');
  if (!parsed.success) throw notFound();
  const [row] = await getDb()
    .select(reviewFields)
    .from(guideTranslations)
    .innerJoin(guides, eq(guides.id, guideTranslations.guideId))
    .where(
      and(
        eq(guideTranslations.id, parsed.data),
        eq(guideTranslations.reviewerId, auth.account.user.id),
        eq(guideTranslations.status, 'in_review'),
      ),
    )
    .limit(1);
  if (!row) throw notFound();
  return row;
}

function reviewDetailOf({ translation, guide }: ReviewRow) {
  return {
    ...reviewItem({ translation, guide }),
    source: { title: guide.title, sections: guide.sections, terms: guide.terms },
    translation: { title: translation.title, sections: translation.sections, checks: translation.checks as TranslationCheck[] },
  };
}

export async function claimReview(auth: RequestAuth, translationId: string | undefined) {
  const parsed = uuidSchema.safeParse(translationId);
  if (!parsed.success) throw new AppError(404, 'Demande de relecture introuvable.', 'REVIEW_NOT_FOUND');
  const languages = reviewerLanguagesOf(auth);
  if (languages.length === 0) {
    throw new AppError(409, 'Indiquez d’abord vos langues maternelles.', 'REVIEWER_LANGUAGES_MISSING');
  }

  const [claimed] = await getDb()
    .update(guideTranslations)
    .set({ status: 'in_review', reviewerId: auth.account.user.id, reviewClaimedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(guideTranslations.id, parsed.data),
        eq(guideTranslations.status, 'review_requested'),
        inArray(guideTranslations.language, languages),
        ne(guideTranslations.userId, auth.account.user.id),
      ),
    )
    .returning({ id: guideTranslations.id });
  if (!claimed) {
    throw new AppError(409, 'Cette demande a déjà été prise en charge, ou elle n’est pas dans vos langues.', 'REVIEW_NOT_AVAILABLE');
  }
  return reviewDetailOf(await assignment(auth, claimed.id));
}

export async function getReview(auth: RequestAuth, translationId: string | undefined) {
  return reviewDetailOf(await assignment(auth, translationId));
}

export async function saveReview(auth: RequestAuth, translationId: string | undefined, input: TranslationEdit) {
  const { translation, guide } = await assignment(auth, translationId);
  const sections = mergeSections(guide.sections, translation.sections, input.sections);
  await getDb()
    .update(guideTranslations)
    .set({
      title: input.title,
      sections,
      checks: checkTranslation(guide, { title: input.title, sections }, { language: translation.language, terms: guide.terms }),
      updatedAt: new Date(),
    })
    .where(eq(guideTranslations.id, translation.id));
  return getReview(auth, translation.id);
}

export async function releaseReview(auth: RequestAuth, translationId: string | undefined): Promise<void> {
  const { translation } = await assignment(auth, translationId);
  await getDb()
    .update(guideTranslations)
    .set({ status: 'review_requested', reviewerId: null, reviewClaimedAt: null, updatedAt: new Date() })
    .where(and(eq(guideTranslations.id, translation.id), eq(guideTranslations.status, 'in_review')));
}

export async function completeReview(auth: RequestAuth, translationId: string | undefined, input: { comment?: string }): Promise<void> {
  const { translation, guide } = await assignment(auth, translationId);
  const checks = checkTranslation(guide, translation, { language: translation.language, terms: guide.terms });
  if (hasBlockingIssues(checks)) throw hasErrors();

  await getDb()
    .update(guideTranslations)
    .set({ status: 'ready', checks, reviewedAt: new Date(), reviewerComment: input.comment || null, updatedAt: new Date() })
    .where(and(eq(guideTranslations.id, translation.id), eq(guideTranslations.status, 'in_review')));
}
