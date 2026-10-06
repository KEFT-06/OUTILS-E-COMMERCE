import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { ebookJobs } from '@server/db/schema';
import { env, isServerless, providers } from '@server/env';
import { AppError, countrySchema, providerUnavailable } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { debitCredits, refundDebit } from '@server/services/accounts';
import { getActionCost } from '@server/services/credits';
import { EBOOK_PAGES_CEILING, WORDS_PER_PAGE } from '@server/services/plans';
import { ensureReady } from '@server/services/preflight';
import { type WritingFinding, findingsOf } from '@server/services/writing';
import { BATCH_SIZE, type WrittenSection, writeSection } from '@server/services/writing/longform';
import { type Outline, type OutlineSection, buildOutline } from '@server/services/writing/outline';
import { runInBackground } from '@server/shared/backgroundWork';

/**
 * Rédaction d'un ebook long, menée par tranches.
 *
 * Pourquoi des tranches : un ouvrage de deux cents pages demande des dizaines d'appels au
 * service de rédaction, bien au-delà du temps accordé à une seule requête. Chaque passage
 * écrit donc ce qu'il peut dans son budget, enregistre, et rend la main.
 *
 * LA RÉDACTION AVANCE SANS L'ÉCRAN. Chaque tranche lance elle-même la suivante. Elle dépendait
 * du suivi du navigateur : un téléphone verrouillé, un onglet quitté, et plus rien n'avançait —
 * au retour, vingt minutes plus tard, l'ouvrage à moitié écrit était jeté avec « La rédaction a
 * été interrompue trop longtemps » (vu par un client le 04/10/2026). Désormais une absence n'est
 * jamais une raison d'abandonner : au retour, la rédaction a continué, ou reprend où elle en était.
 *
 * Rien n'est jamais réécrit : les sections déjà rédigées sont gardées en base. Une coupure,
 * un redémarrage ou un changement d'instance ne coûte que la section en cours.
 *
 * LE CONTENU D'UN PRODUIT PASSE PAR LE MÊME MOTEUR (« product »). Il était rédigé d'une seule
 * demande, longue de plusieurs minutes : coupée ou refusée une fois, tout était perdu et l'écran
 * répondait « Réessayez ». Ses modules sont maintenant écrits un par un, enregistrés à mesure, et
 * repris d'eux-mêmes — au même prix qu'avant, la longueur étant déduite du nombre de modules.
 *
 *  1. Lancement : points réservés d'après la longueur demandée, travail enregistré.
 *  2. Plan : chapitres et sections, avec l'angle de chacune (outline.ts).
 *  3. Rédaction : les sections partent par lots, avec le résumé de ce qui précède.
 *  4. Fin : texte complet rendu au brouillon ; en cas d'échec, points rendus une seule fois.
 */

export type EbookJobStatus = 'queued' | 'outline' | 'writing' | 'completed' | 'failed';

/** « product » : le contenu des modules d'un produit, à longueur et à prix fixes. */
export type EbookJobKind = 'ebook' | 'market_report' | 'product';

/** Au-delà, ce n'est plus un produit à prix fixe mais un ouvrage long, facturé à la page. */
const PRODUCT_MAX_MODULES = 16;
/** Modules d'un produit dont l'auteur n'a pas donné le plan. */
const PRODUCT_FREE_MODULES = 6;

/**
 * Longueur d'un produit, en pages : environ 525 mots par module — ce que la rédaction d'une
 * seule demande visait (350 à 700 mots) —, soit une section par module dans le plan.
 */
export const productPages = (modules: number): number =>
  Math.min(60, Math.max(3, Math.round((modules > 0 ? modules : PRODUCT_FREE_MODULES) * 1.75)));

const ACTIVE: EbookJobStatus[] = ['queued', 'outline', 'writing'];

/**
 * Temps de travail par passage. L'hébergeur coupe à 300 s : la tranche s'arrête d'elle-même
 * avant, pour avoir le temps d'enregistrer ce qui vient d'être écrit. Une tranche coupée
 * en plein enregistrement perdrait le travail du lot en cours.
 */
const SLICE_BUDGET_MS = 200_000;

/**
 * Aucun appel lancé par une tranche ne dépasse ce moment. Le budget ci-dessus ne bornait que
 * le DÉPART des lots : un lot parti à 199 s avec trois minutes de délai courait jusqu'à 380 s,
 * et l'hébergeur le coupait à 300 s — lot payé, perdu, et tranche jamais libérée.
 */
const SLICE_HARD_STOP_MS = 280_000;

/** En deçà, un nouveau lot n'aurait pas le temps d'aboutir : on laisse la place à la tranche suivante. */
const MIN_BATCH_MS = 60_000;

/** Réservation d'une tranche : au-delà, une instance coupée par l'hébergeur ne bloque plus rien. */
const LEASE_MS = 295_000;

/** Pause après un refus passager du fournisseur, avant que le suivi ne relance. */
const TRANSIENT_PAUSE_MS = 45_000;

/** Pannes qui se règlent en attendant : saturation, débit, délai, indisponibilité. */
const TRANSIENT = /_(OVERLOADED|RATE_LIMITED|TIMEOUT|UNAVAILABLE)$/;

/**
 * Tranches refusées d'affilée par le service de rédaction avant de renoncer et de rembourser :
 * une vingtaine de minutes d'essais réels. Le temps écoulé, lui, ne fait jamais renoncer.
 */
const MAX_STALLS = 20;

/** Attente au plus, dans une tranche enchaînée, que la pause de la précédente se termine. */
const PAUSE_WAIT_MS = 60_000;

const stalledError = () =>
  new AppError(503, 'La rédaction n’a pas pu avancer malgré plusieurs essais : vos points ont été rendus.', 'EBOOK_STALLED');

/** Le service de rédaction refuse depuis trop d'essais : continuer ne ferait qu'occuper le compte. */
const isStuck = (job: Pick<JobRow, 'stalls'>) => job.stalls >= MAX_STALLS;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

type JobRow = typeof ebookJobs.$inferSelect;

export interface EbookJobView {
  id: string;
  kind: EbookJobKind;
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
  /** Rédaction en pause après un refus passager : elle reprend d'elle-même. */
  notice: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

function viewOf(row: JobRow): EbookJobView {
  const outline = row.outline as unknown as Outline | null;
  const active = ACTIVE.includes(row.status as EbookJobStatus);
  const problem = row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? 'La rédaction a échoué.' } : null;
  return {
    id: row.id,
    kind: row.kind as EbookJobKind,
    title: row.title,
    productId: row.productId,
    status: row.status as EbookJobStatus,
    targetPages: row.targetPages,
    sectionsDone: row.sectionsDone,
    sectionsTotal: row.sectionsTotal,
    wordsWritten: row.wordsWritten,
    pagesWritten: Math.round(row.wordsWritten / WORDS_PER_PAGE),
    outline: outline ? { chapters: outline.chapters.map((chapter) => ({ index: chapter.index, title: chapter.title })) } : null,
    error: active ? null : problem,
    notice: active ? problem : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Rédactions en cours dans ce processus : une tranche n'est jamais exécutée deux fois. */
const running = new Set<string>();

export const ebookRequestSchema = z.object({
  kind: z.enum(['ebook', 'market_report', 'product']).default('ebook'),
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
  const message = known ? error.message : 'La rédaction n’a pas pu aboutir : vos points ont été rendus.';
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
 * Réserve la tranche suivante en base, pour cette instance seule. Refusée si une autre tranche
 * tourne encore (réservation en cours) ou si la rédaction marque une pause après un refus.
 */
async function claimSlice(jobId: string): Promise<boolean> {
  const now = new Date();
  const [claimed] = await getDb()
    .update(ebookJobs)
    .set({ leaseUntil: new Date(now.getTime() + LEASE_MS) })
    .where(
      and(
        eq(ebookJobs.id, jobId),
        inArray(ebookJobs.status, ACTIVE),
        or(isNull(ebookJobs.leaseUntil), lt(ebookJobs.leaseUntil, now)),
      ),
    )
    .returning({ id: ebookJobs.id });
  return Boolean(claimed);
}

/**
 * Écrit ce qui tient dans le budget, puis rend la main. S'il reste des sections, le suivi
 * rappellera une tranche de plus.
 */
async function runSlice(jobId: string, started = Date.now()): Promise<boolean> {
  if (running.has(jobId)) return false;
  running.add(jobId);
  const db = getDb();
  const until = started + SLICE_BUDGET_MS;
  const hardStop = started + SLICE_HARD_STOP_MS;
  let claimed = false;
  let pausedUntil: Date | null = null;

  try {
    claimed = await claimSlice(jobId);
    if (!claimed) return false;
    const [job] = await db.select().from(ebookJobs).where(eq(ebookJobs.id, jobId)).limit(1);
    if (!job || !ACTIVE.includes(job.status as EbookJobStatus)) return true;

    const request = job.request as unknown as EbookRequest;

    // ---- Plan : une seule fois, gardé en base pour toutes les tranches suivantes.
    let outline = job.outline as unknown as Outline | null;
    if (!outline) {
      await db
        .update(ebookJobs)
        .set({ status: 'outline', updatedAt: new Date() })
        .where(and(eq(ebookJobs.id, jobId), inArray(ebookJobs.status, ACTIVE)));
      outline = await buildOutline({
        // Un produit s'écrit comme un ebook : mêmes consignes, seule la longueur est imposée.
        kind: request.kind === 'product' ? 'ebook' : request.kind,
        ...(request.kind === 'product' && request.chapters.length === 0 ? { freeChapters: PRODUCT_FREE_MODULES } : {}),
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
      // La condition sur le statut n'est pas une précaution de style : l'utilisateur a pu
      // renoncer pendant la construction du plan. Sans elle, cette écriture ramènerait le
      // travail à « en cours » alors qu'il a été annulé et remboursé, et le compte
      // resterait bloqué sur une rédaction fantôme.
      const [stillRunning] = await db
        .update(ebookJobs)
        .set({
          outline: outline as unknown as Record<string, unknown>,
          sectionsTotal: outline.sections.length,
          status: 'writing',
          errorCode: null,
          errorMessage: null,
          stalls: 0,
          progressAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(ebookJobs.id, jobId), inArray(ebookJobs.status, ACTIVE)))
        .returning();
      if (!stillRunning) return true;
    }

    // ---- Rédaction : lot par lot, tant que le budget de la tranche le permet.
    let written = (job.sections as unknown as WrittenSection[]) ?? [];
    const done = new Set(written.map((section) => section.index));

    while (Date.now() < until && hardStop - Date.now() >= MIN_BATCH_MS) {
      const remaining = outline.sections.filter((section) => !done.has(section.index));
      if (remaining.length === 0) break;

      const batch = remaining.slice(0, BATCH_SIZE);
      const summaries = outline.sections
        .filter((section) => done.has(section.index))
        .map((section) => ({ title: section.title, gist: written.find((entry) => entry.index === section.index)?.gist ?? '' }));

      /*
        Chaque section du lot est gardée si elle aboutit, même quand une voisine échoue.
        Avec un « tout ou rien », une seule section refusée jetait les deux autres, déjà
        rédigées et payées, et elles étaient réécrites au passage suivant.
      */
      const settled = await Promise.allSettled(
        batch.map((section) =>
          writeSection({
            outline,
            section,
            written: summaries,
            upcoming: upcomingOf(outline, section, done),
            market: request.market ?? null,
            targetAudience: request.targetAudience,
            ...(request.findings ? { findings: request.findings } : {}),
            timeoutMs: hardStop - Date.now(),
          }),
        ),
      );
      const results = settled.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []));
      const failure = settled.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');

      if (results.length > 0) {
        written = [...written, ...results].sort((a, b) => a.index - b.index);
        for (const result of results) done.add(result.index);
        const wordsWritten = written.reduce((total, section) => total + section.words, 0);

        // Enregistré après chaque lot : une coupure ne coûte que le lot en cours.
        const [saved] = await db
          .update(ebookJobs)
          .set({
            sections: written as unknown as Record<string, unknown>[],
            sectionsDone: written.length,
            wordsWritten,
            errorCode: null,
            errorMessage: null,
            stalls: 0,
            progressAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(ebookJobs.id, jobId), inArray(ebookJobs.status, ACTIVE)))
          .returning();

        // Plus rien à mettre à jour : l'utilisateur a renoncé pendant ce lot. Poursuivre
        // ferait payer au propriétaire des appels dont personne ne verra jamais le texte.
        if (!saved) return true;
      }
      if (failure) throw failure.reason;
    }

    // ---- Fin, ou tranche suivante.
    if (done.size >= outline.sections.length) {
      await db
        .update(ebookJobs)
        .set({ status: 'completed', updatedAt: new Date(), completedAt: new Date() })
        .where(and(eq(ebookJobs.id, jobId), inArray(ebookJobs.status, ACTIVE)));
    }
  } catch (error) {
    if (error instanceof AppError && TRANSIENT.test(error.code)) {
      /*
        Refus passager : la rédaction marque une pause au lieu d'échouer. Les sections écrites
        restent acquises ; le suivi relance après la pause. Faire échouer ici jetait tout un
        ouvrage déjà à moitié rédigé pour une saturation de quelques secondes chez Google.
        Le filet reste en place : après une vingtaine de refus d'affilée, on renonce.
      */
      pausedUntil = new Date(Date.now() + TRANSIENT_PAUSE_MS);
      console.warn(`[ebook] ${jobId} en pause ${TRANSIENT_PAUSE_MS / 1000} s (${error.code})`);
      await db
        .update(ebookJobs)
        .set({
          leaseUntil: pausedUntil,
          stalls: sql`${ebookJobs.stalls} + 1`,
          errorCode: error.code,
          // Ton neutre : l'auteur n'a rien à faire, et « saturé » lui faisait croire à une panne (29/09/2026).
          errorMessage: 'Courte pause entre deux sections : la rédaction reprend d’elle-même dans un instant. Rien de ce qui est écrit n’est perdu.',
          updatedAt: new Date(),
        })
        .where(and(eq(ebookJobs.id, jobId), inArray(ebookJobs.status, ACTIVE)))
        .catch((failure: unknown) => console.error('[ebook] pause non enregistrée', failure));
    } else {
      await failJob(jobId, error).catch((failure: unknown) => console.error('[ebook] échec non enregistré', failure));
    }
  } finally {
    running.delete(jobId);
    // Tranche finie : la suivante peut partir tout de suite, sur n'importe quelle instance.
    if (claimed && !pausedUntil) {
      await db
        .update(ebookJobs)
        .set({ leaseUntil: null })
        .where(eq(ebookJobs.id, jobId))
        .catch((failure: unknown) => console.error('[ebook] réservation non libérée', failure));
    }
  }
  return claimed;
}

/**
 * Demande la tranche suivante sans attendre le navigateur.
 *
 * En hébergement sans serveur, une fonction ne survit pas à sa requête : la suite part par une
 * requête au site lui-même, protégée par le secret du planificateur, qui répond tout de suite
 * et travaille ensuite. Sur un serveur classique, le processus reste vivant : la suite part
 * d'ici. Si la relance échoue, rien n'est perdu — le suivi de l'écran ou le retour de l'auteur
 * reprendra la rédaction où elle en est.
 */
async function chainNext(jobId: string): Promise<void> {
  // Les tests font avancer les tranches eux-mêmes, une à une, pour en observer chaque état.
  if (env.NODE_ENV === 'test') return;
  if (!isServerless) {
    setTimeout(() => void continueEbook(jobId, { waitForPause: true }), 1_000).unref();
    return;
  }
  if (!env.CRON_SECRET) return;
  try {
    const response = await fetch(`${env.APP_URL.replace(/\/+$/, '')}/api/cron/redaction`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) console.warn(`[ebook] relance de ${jobId} refusée (${response.status})`);
  } catch (error) {
    console.warn(`[ebook] relance de ${jobId} non partie :`, error instanceof Error ? error.message : error);
  }
}

/**
 * Une tranche, puis la suivante tant qu'il reste des sections à écrire.
 *
 * `waitForPause` : la tranche précédente s'est mise en pause après un refus passager ; une
 * tranche enchaînée attend la fin de cette pause au lieu de repartir bredouille. Le suivi de
 * l'écran, lui, n'attend pas : il repassera.
 */
export async function continueEbook(jobId: string, options: { waitForPause?: boolean } = {}): Promise<void> {
  const started = Date.now();
  if (options.waitForPause) {
    const [waiting] = await getDb().select({ leaseUntil: ebookJobs.leaseUntil }).from(ebookJobs).where(eq(ebookJobs.id, jobId)).limit(1);
    const wait = (waiting?.leaseUntil?.getTime() ?? 0) - Date.now();
    if (wait > 0 && wait <= PAUSE_WAIT_MS) await sleep(wait + 500);
  }

  // Une tranche que cette instance n'a pas obtenue est tenue par une autre, qui enchaînera elle-même.
  if (!(await runSlice(jobId, started))) return;

  const [job] = await getDb().select().from(ebookJobs).where(eq(ebookJobs.id, jobId)).limit(1);
  if (!job || !ACTIVE.includes(job.status as EbookJobStatus)) return;
  if (isStuck(job)) {
    await failJob(job.id, stalledError());
    return;
  }
  await chainNext(jobId);
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
  if (!providers.gemini) throw providerUnavailable('rédaction automatique');
  // Un service déjà relevé en panne : on refuse maintenant, avant tout débit, plutôt que
  // de laisser l'auteur attendre une rédaction qui échouera.
  ensureReady(['writing', 'database']);

  /*
    Un produit : la longueur ne se choisit pas, elle suit le nombre de modules, et le prix reste
    celui de la rédaction d'un produit. Le plafond de pages du palier, lui, borne les ouvrages
    dont l'auteur CHOISIT la longueur : il ne s'applique pas ici.
  */
  const isProduct = request.kind === 'product';
  if (isProduct && request.chapters.length > PRODUCT_MAX_MODULES) {
    throw new AppError(400, `Un produit compte ${PRODUCT_MAX_MODULES} modules au plus. Aucun point n’a été retiré.`, 'PRODUCT_TOO_MANY_MODULES');
  }
  if (isProduct) request = { ...request, targetPages: productPages(request.chapters.length) };
  const actionId = isProduct ? 'product_generation' : 'ebook_longform';

  const allowed = auth.account.plan.limits.ebookPages;
  if (!isProduct && request.targetPages > allowed) {
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
    cost: await getActionCost(actionId, isProduct ? 1 : request.targetPages),
    actionId,
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
        progressAt: new Date(),
      })
      .returning();
  } catch (error) {
    // Deux lancements simultanés : l'index unique n'en garde qu'un, l'autre rend ses points.
    await refundDebit({ debitTransactionId: debit.transactionId, generationId: null, note: 'Rédaction déjà en cours : points rendus.' });
    const concurrent = await current();
    if (concurrent) return { job: viewOf(concurrent), created: false };
    throw error;
  }

  runInBackground(() => continueEbook(job!.id), `ebook ${job!.id}`);
  return { job: viewOf(job!), created: true };
}

const jobIdSchema = z.string().uuid();

/**
 * État d'une rédaction. Le suivi relance aussi le travail s'il s'est arrêté en chemin (relance
 * non partie, instance coupée) : un auteur qui revient après une heure retrouve sa rédaction
 * terminée, ou la voit reprendre où elle en était — jamais abandonnée pour son absence.
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
    if (isStuck(job)) {
      await failJob(job.id, stalledError());
      const [failed] = await getDb().select().from(ebookJobs).where(eq(ebookJobs.id, job.id)).limit(1);
      return viewOf(failed ?? job);
    }
    runInBackground(() => continueEbook(job.id), `tranche d’ebook ${job.id}`);
  }
  return viewOf(job);
}

/**
 * Renonce à une rédaction en cours et rend les points.
 *
 * Une rédaction longue occupe le compte jusqu'à une demi-heure. Sans cette sortie, une
 * longueur mal choisie ou un titre erroné obligeait à attendre la fin pour recommencer.
 * Les sections déjà écrites sont perdues : l'utilisateur ne reçoit rien, il ne paie rien.
 */
export async function cancelEbook(auth: RequestAuth, jobId: string | undefined): Promise<EbookJobView> {
  const parsed = jobIdSchema.safeParse(jobId);
  if (!parsed.success) throw new AppError(404, 'Rédaction introuvable sur votre compte.', 'EBOOK_JOB_NOT_FOUND');

  const [job] = await getDb()
    .select()
    .from(ebookJobs)
    .where(and(eq(ebookJobs.id, parsed.data), eq(ebookJobs.userId, auth.account.user.id)))
    .limit(1);
  if (!job) throw new AppError(404, 'Rédaction introuvable sur votre compte.', 'EBOOK_JOB_NOT_FOUND');

  // Terminée entre l'affichage du bouton et le clic : mieux vaut rendre le texte qu'une erreur.
  if (!ACTIVE.includes(job.status as EbookJobStatus)) return viewOf(job);

  await failJob(job.id, new AppError(200, 'Rédaction annulée à votre demande : vos points ont été rendus.', 'EBOOK_CANCELLED'));

  const [cancelled] = await getDb().select().from(ebookJobs).where(eq(ebookJobs.id, job.id)).limit(1);
  return viewOf(cancelled ?? job);
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
): Promise<{
  kind: EbookJobKind;
  title: string;
  productId: string;
  /** `index` : rang du chapitre dans le plan — celui du module de l'auteur, quand il en a donné. */
  chapters: { index: number; title: string; content: string }[];
  words: number;
  pages: number;
  /** Formulations relevées par le contrôle de conformité, chapitre par chapitre. */
  findings: WritingFinding[];
}> {
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
        // « ## » : le titre de section est rendu en gras, en tête de sa partie — plus une ligne perdue dans le texte.
        return text ? `## ${section.title}\n\n${text}` : null;
      })
      .filter((part): part is string => part !== null)
      .join('\n\n');
    return { index: chapter.index, title: chapter.title, content: body };
  });
  const ready = chapters.filter((chapter) => chapter.content.trim());

  return {
    kind: job.kind,
    title: job.title,
    productId: job.productId,
    chapters: ready,
    words: job.wordsWritten,
    pages: job.pagesWritten,
    findings: await findingsOf(ready.map((chapter) => ({ label: `Module ${chapter.index} — ${chapter.title}`, text: chapter.content }))),
  };
}

/**
 * Reprend les rédactions laissées en chemin : au démarrage d'un serveur classique, et au réveil
 * quotidien en hébergement sans serveur. Une rédaction n'est jamais abandonnée pour son âge.
 */
export async function resumeEbookJobs(): Promise<number> {
  const active = await getDb().select().from(ebookJobs).where(inArray(ebookJobs.status, ACTIVE));
  for (const job of active) {
    if (isStuck(job)) await failJob(job.id, stalledError());
    else if (isServerless) await chainNext(job.id);
    else void continueEbook(job.id);
  }
  return active.length;
}

/** Tranche demandée par le site lui-même (enchaînement) : répond tout de suite, travaille ensuite. */
export function continueEbookInBackground(jobId: string): void {
  runInBackground(() => continueEbook(jobId, { waitForPause: true }), `tranche enchaînée d’ebook ${jobId}`);
}
