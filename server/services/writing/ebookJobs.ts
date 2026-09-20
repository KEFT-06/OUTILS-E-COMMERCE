import { and, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { ebookJobs } from '@server/db/schema';
import { providers } from '@server/env';
import { AppError, countrySchema, providerUnavailable } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { debitCredits, refundDebit } from '@server/services/accounts';
import { getActionCost } from '@server/services/credits';
import { EBOOK_PAGES_CEILING, WORDS_PER_PAGE } from '@server/services/plans';
import { ensureReady } from '@server/services/preflight';
import { BATCH_SIZE, type WrittenSection, writeSection } from '@server/services/writing/longform';
import { type Outline, type OutlineSection, buildOutline } from '@server/services/writing/outline';
import { runInBackground } from '@server/shared/backgroundWork';

/**
 * Rédaction d'un ebook long, menée par tranches.
 *
 * Pourquoi des tranches : un ouvrage de deux cents pages demande des dizaines d'appels au
 * service de rédaction, bien au-delà du temps accordé à une seule requête. Chaque passage
 * écrit donc ce qu'il peut dans son budget, enregistre, et rend la main. Le suivi du
 * navigateur rappelle le travail, qui repart exactement où il s'était arrêté.
 *
 * Rien n'est jamais réécrit : les sections déjà rédigées sont gardées en base. Une coupure,
 * un redémarrage ou un changement d'instance ne coûte que la section en cours.
 *
 *  1. Lancement : points réservés d'après la longueur demandée, travail enregistré.
 *  2. Plan : chapitres et sections, avec l'angle de chacune (outline.ts).
 *  3. Rédaction : les sections partent par lots, avec le résumé de ce qui précède.
 *  4. Fin : texte complet rendu au brouillon ; en cas d'échec, points rendus une seule fois.
 */

export type EbookJobStatus = 'queued' | 'outline' | 'writing' | 'completed' | 'failed';

const ACTIVE: EbookJobStatus[] = ['queued', 'outline', 'writing'];

/**
 * Temps de travail par passage. L'hébergeur coupe à 300 s : la tranche s'arrête d'elle-même
 * avant, pour avoir le temps d'enregistrer ce qui vient d'être écrit. Une tranche coupée
 * en plein enregistrement perdrait le travail du lot en cours.
 */
const SLICE_BUDGET_MS = 200_000;

/** Au-delà, une rédaction restée « en cours » est abandonnée et remboursée. */
const JOB_DEADLINE_MS = 90 * 60_000;

type JobRow = typeof ebookJobs.$inferSelect;

export interface EbookJobView {
  id: string;
  kind: 'ebook' | 'market_report';
  title: string;
  productId: string;
  status: EbookJobStatus;
  targetPages: number;
  sectionsDone: number;
  sectionsTotal: number;
  wordsWritten: number;
  /** Pages rédigées jusqu'ici, à la même échelle que la cible. */
  pagesWritten: number;
  outline: { chapters: { index: number; title: string }[] } | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

function viewOf(row: JobRow): EbookJobView {
  const outline = row.outline as unknown as Outline | null;
  return {
    id: row.id,
    kind: row.kind as 'ebook' | 'market_report',
    title: row.title,
    productId: row.productId,
    status: row.status as EbookJobStatus,
    targetPages: row.targetPages,
    sectionsDone: row.sectionsDone,
    sectionsTotal: row.sectionsTotal,
    wordsWritten: row.wordsWritten,
    pagesWritten: Math.round(row.wordsWritten / WORDS_PER_PAGE),
    outline: outline ? { chapters: outline.chapters.map((chapter) => ({ index: chapter.index, title: chapter.title })) } : null,
    error: row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? 'La rédaction a échoué.' } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Rédactions en cours dans ce processus : une tranche n'est jamais exécutée deux fois. */
const running = new Set<string>();

export const ebookRequestSchema = z.object({
  kind: z.enum(['ebook', 'market_report']).default('ebook'),
  productId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(300).default(''),
  typeName: z.string().trim().max(60).default(''),
  targetAudience: z.string().trim().max(1000).default(''),
  transformationPromise: z.string().trim().max(1000).default(''),
  chapters: z
    .array(z.object({ title: z.string().trim().min(1).max(200), details: z.string().trim().max(2000).default('') }))
    .max(40)
    .default([]),
  market: countrySchema.nullish(),
  targetPages: z.number().int().min(1).max(EBOOK_PAGES_CEILING),
  /**
   * Matière établie, pour un dossier de marché : ce que l'analyse a trouvé, sources à
   * l'appui. Le serveur la reprend du rapport enregistré ; elle n'est jamais crue sur
   * parole depuis le navigateur pour un fait affiché comme établi.
   */
  findings: z.string().max(40_000).optional(),
});

export type EbookRequest = z.infer<typeof ebookRequestSchema>;

/* -------------------------------------------------------------------------- */
/*  Déroulé d'une tranche                                                      */
/* -------------------------------------------------------------------------- */

async function failJob(jobId: string, error: unknown): Promise<void> {
  const known = error instanceof AppError;
  const code = known ? error.code : 'EBOOK_FAILED';
  const message = known ? error.message : 'La rédaction a échoué sur le serveur. Réessayez : vos points ont été rendus.';
  if (!known) console.error('[ebook] échec inattendu', error);

  await getDb().transaction(async (tx) => {
    const [claimed] = await tx
      .update(ebookJobs)
      .set({ status: 'failed', errorCode: code, errorMessage: message, refunded: true, updatedAt: new Date(), completedAt: new Date() })
      .where(and(eq(ebookJobs.id, jobId), inArray(ebookJobs.status, ACTIVE), eq(ebookJobs.refunded, false)))
      .returning();
    if (claimed?.debitTransactionId && claimed.creditsCharged > 0) {
      await refundDebit({ debitTransactionId: claimed.debitTransactionId, generationId: null, note: 'La rédaction n’a pas abouti : points rendus.' }, tx);
    }
  });
}

/**
 * Écrit ce qui tient dans le budget, puis rend la main. Renvoie vrai si l'ouvrage est
 * terminé, faux s'il reste des sections — le suivi rappellera alors une tranche de plus.
 */
async function runSlice(jobId: string): Promise<void> {
  if (running.has(jobId)) return;
  running.add(jobId);
  const db = getDb();
  const until = Date.now() + SLICE_BUDGET_MS;

  try {
    const [job] = await db.select().from(ebookJobs).where(eq(ebookJobs.id, jobId)).limit(1);
    if (!job || !ACTIVE.includes(job.status as EbookJobStatus)) return;

    const request = job.request as unknown as EbookRequest;

    // ---- Plan : une seule fois, gardé en base pour toutes les tranches suivantes.
    let outline = job.outline as unknown as Outline | null;
    if (!outline) {
      await db.update(ebookJobs).set({ status: 'outline', updatedAt: new Date() }).where(eq(ebookJobs.id, jobId));
      outline = await buildOutline({
        kind: request.kind,
        title: request.title,
        subtitle: request.subtitle,
        typeName: request.typeName,
        targetAudience: request.targetAudience,
        transformationPromise: request.transformationPromise,
        chapters: request.chapters,
        market: request.market ?? null,
        targetPages: request.targetPages,
        ...(request.findings ? { findings: request.findings } : {}),
      });
      await db
        .update(ebookJobs)
        .set({
          outline: outline as unknown as Record<string, unknown>,
          sectionsTotal: outline.sections.length,
          status: 'writing',
          updatedAt: new Date(),
        })
        .where(eq(ebookJobs.id, jobId));
    }

    // ---- Rédaction : lot par lot, tant que le budget de la tranche le permet.
    let written = (job.sections as unknown as WrittenSection[]) ?? [];
    const done = new Set(written.map((section) => section.index));

    while (Date.now() < until) {
      const remaining = outline.sections.filter((section) => !done.has(section.index));
      if (remaining.length === 0) break;

      const batch = remaining.slice(0, BATCH_SIZE);
      const summaries = outline.sections
        .filter((section) => done.has(section.index))
        .map((section) => ({ title: section.title, gist: written.find((entry) => entry.index === section.index)?.gist ?? '' }));

      const results = await Promise.all(
        batch.map((section) =>
          writeSection({
            outline,
            section,
            written: summaries,
            upcoming: upcomingOf(outline, section, done),
            market: request.market ?? null,
            targetAudience: request.targetAudience,
            ...(request.findings ? { findings: request.findings } : {}),
          }),
        ),
      );

      written = [...written, ...results].sort((a, b) => a.index - b.index);
      for (const result of results) done.add(result.index);
      const wordsWritten = written.reduce((total, section) => total + section.words, 0);

      // Enregistré après chaque lot : une coupure ne coûte que le lot en cours.
      await db
        .update(ebookJobs)
        .set({
          sections: written as unknown as Record<string, unknown>[],
          sectionsDone: written.length,
          wordsWritten,
          updatedAt: new Date(),
        })
        .where(and(eq(ebookJobs.id, jobId), inArray(ebookJobs.status, ACTIVE)));
    }

    // ---- Fin, ou tranche suivante.
    if (done.size >= outline.sections.length) {
      await db
        .update(ebookJobs)
        .set({ status: 'completed', updatedAt: new Date(), completedAt: new Date() })
        .where(and(eq(ebookJobs.id, jobId), inArray(ebookJobs.status, ACTIVE)));
    }
  } catch (error) {
    await failJob(jobId, error).catch((failure: unknown) => console.error('[ebook] échec non enregistré', failure));
  } finally {
    running.delete(jobId);
  }
}

/** Les trois sections suivantes encore à écrire : de quoi ne pas empiéter sur elles. */
function upcomingOf(outline: Outline, current: OutlineSection, done: Set<number>): { title: string; angle: string }[] {
  return outline.sections
    .filter((section) => section.index > current.index && !done.has(section.index))
    .slice(0, 3)
    .map((section) => ({ title: section.title, angle: section.angle }));
}

/* -------------------------------------------------------------------------- */
/*  Entrées publiques                                                          */
/* -------------------------------------------------------------------------- */

export async function startEbook(auth: RequestAuth, request: EbookRequest): Promise<{ job: EbookJobView; created: boolean }> {
  if (!providers.gemini) throw providerUnavailable('rédaction par IA');
  // Un service déjà relevé en panne : on refuse maintenant, avant tout débit, plutôt que
  // de laisser l'auteur attendre une rédaction qui échouera.
  ensureReady(['writing', 'database']);

  const allowed = auth.account.plan.limits.ebookPages;
  if (request.targetPages > allowed) {
    throw new AppError(
      403,
      `Votre palier permet ${allowed} pages au plus par ebook. Choisissez une longueur inférieure, ou passez à un palier supérieur. Aucun point n’a été retiré.`,
      'EBOOK_PAGES_OVER_PLAN',
      { allowed, requested: request.targetPages },
    );
  }

  const userId = auth.account.user.id;
  const db = getDb();
  const current = async () =>
    (await db.select().from(ebookJobs).where(and(eq(ebookJobs.userId, userId), inArray(ebookJobs.status, ACTIVE))).limit(1))[0];

  const existing = await current();
  if (existing) return { job: viewOf(existing), created: false };

  const debit = await debitCredits({
    userId,
    cost: await getActionCost('ebook_longform', request.targetPages),
    actionId: 'ebook_longform',
    unlimited: auth.account.plan.monthlyCredits === null,
  });

  let job: JobRow | undefined;
  try {
    [job] = await db
      .insert(ebookJobs)
      .values({
        userId,
        kind: request.kind,
        productId: request.productId,
        title: request.title,
        market: request.market ?? null,
        status: 'queued',
        targetPages: request.targetPages,
        request: request as unknown as Record<string, unknown>,
        creditsCharged: debit.charged,
        debitTransactionId: debit.transactionId,
      })
      .returning();
  } catch (error) {
    // Deux lancements simultanés : l'index unique n'en garde qu'un, l'autre rend ses points.
    await refundDebit({ debitTransactionId: debit.transactionId, generationId: null, note: 'Rédaction déjà en cours : points rendus.' });
    const concurrent = await current();
    if (concurrent) return { job: viewOf(concurrent), created: false };
    throw error;
  }

  runInBackground(() => runSlice(job!.id), `ebook ${job!.id}`);
  return { job: viewOf(job!), created: true };
}

const jobIdSchema = z.string().uuid();

/**
 * État d'une rédaction. C'est aussi ce suivi qui relance la tranche suivante : sans
 * processus de fond permanent, c'est le navigateur qui fait avancer le travail.
 */
export async function getEbookJob(auth: RequestAuth, jobId: string | undefined): Promise<EbookJobView> {
  const parsed = jobIdSchema.safeParse(jobId);
  if (!parsed.success) throw new AppError(404, 'Rédaction introuvable sur votre compte.', 'EBOOK_JOB_NOT_FOUND');
  const [job] = await getDb()
    .select()
    .from(ebookJobs)
    .where(and(eq(ebookJobs.id, parsed.data), eq(ebookJobs.userId, auth.account.user.id)))
    .limit(1);
  if (!job) throw new AppError(404, 'Rédaction introuvable sur votre compte.', 'EBOOK_JOB_NOT_FOUND');

  if (ACTIVE.includes(job.status as EbookJobStatus) && !running.has(job.id)) {
    if (Date.now() - job.createdAt.getTime() > JOB_DEADLINE_MS) {
      await failJob(job.id, new AppError(504, 'La rédaction a été interrompue trop longtemps. Relancez-la : vos points ont été rendus.', 'EBOOK_INTERRUPTED'));
    } else {
      runInBackground(() => runSlice(job.id), `tranche d’ebook ${job.id}`);
    }
  }
  return viewOf(job);
}

export async function getActiveEbookJob(auth: RequestAuth): Promise<EbookJobView | null> {
  const [job] = await getDb()
    .select()
    .from(ebookJobs)
    .where(and(eq(ebookJobs.userId, auth.account.user.id), inArray(ebookJobs.status, ACTIVE)))
    .limit(1);
  return job ? viewOf(job) : null;
}

/** Texte complet d'une rédaction terminée, chapitre par chapitre, prêt pour le brouillon. */
export async function getEbookResult(
  auth: RequestAuth,
  jobId: string,
): Promise<{ title: string; productId: string; chapters: { title: string; content: string }[]; words: number; pages: number }> {
  const job = await getEbookJob(auth, jobId);
  if (job.status !== 'completed') {
    throw new AppError(409, 'La rédaction n’est pas terminée.', 'EBOOK_NOT_READY');
  }
  const [row] = await getDb().select().from(ebookJobs).where(eq(ebookJobs.id, jobId)).limit(1);
  const outline = row?.outline as unknown as Outline | null;
  const written = (row?.sections as unknown as WrittenSection[]) ?? [];
  if (!outline) throw new AppError(409, 'La rédaction n’est pas terminée.', 'EBOOK_NOT_READY');

  // Un chapitre = ses sections dans l'ordre, chacune précédée de son intertitre.
  const chapters = outline.chapters.map((chapter) => {
    const body = outline.sections
      .filter((section) => section.chapterIndex === chapter.index)
      .map((section) => {
        const text = written.find((entry) => entry.index === section.index)?.content;
        return text ? `${section.title}\n\n${text}` : null;
      })
      .filter((part): part is string => part !== null)
      .join('\n\n');
    return { title: chapter.title, content: body };
  });

  return {
    title: job.title,
    productId: job.productId,
    chapters: chapters.filter((chapter) => chapter.content.trim()),
    words: job.wordsWritten,
    pages: job.pagesWritten,
  };
}

/** Au démarrage d'un serveur classique : reprend les rédactions laissées en plan. */
export async function resumeEbookJobs(): Promise<number> {
  const db = getDb();
  const stale = await db
    .select()
    .from(ebookJobs)
    .where(and(inArray(ebookJobs.status, ACTIVE), lt(ebookJobs.createdAt, new Date(Date.now() - JOB_DEADLINE_MS))));
  for (const job of stale) {
    await failJob(job.id, new AppError(504, 'La rédaction a été interrompue trop longtemps. Relancez-la : vos points ont été rendus.', 'EBOOK_INTERRUPTED'));
  }

  const active = await db.select().from(ebookJobs).where(inArray(ebookJobs.status, ACTIVE));
  for (const job of active) void runSlice(job.id);
  return active.length;
}
