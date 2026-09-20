import { and, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { analysisJobs, generations, users } from '@server/db/schema';
import { providers } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { debitCredits, refundDebit } from '@server/services/accounts';
import { type AnalysisRequest, todayLabel, writeReport } from '@server/services/analysis';
import { researchMarket } from '@server/services/analysis/research';
import { getActionCost } from '@server/services/credits';
import { ensureReady } from '@server/services/preflight';
import type { AnalysisJob, WebGroundingSource } from '@server/shared/analysis';
import { runInBackground } from '@server/shared/backgroundWork';
import { countryName } from '@server/shared/countries';

/**
 * Analyses de niche en arrière-plan.
 *
 * 1. Lancement : points réservés, analyse enregistrée (une seule en cours par compte).
 * 2. Étude : le moteur de recherche cherche et lit le web (une à plusieurs minutes).
 * 3. Rédaction : le rapport est écrit à partir de l'étude ; le serveur écarte tout fait sans source.
 * 4. Fin : rapport enregistré ; en cas d'échec, message clair et points rendus, une seule fois.
 *
 * Le navigateur suit l'avancement : quitter la page ou perdre la connexion n'interrompt rien.
 * Après un redémarrage du serveur, les analyses en cours reprennent là où l'étude en était.
 */

export type AnalysisJobStatus = AnalysisJob['status'];

const ACTIVE: AnalysisJobStatus[] = ['queued', 'research', 'writing'];
/** Au-delà, une analyse restée « en cours » est abandonnée et remboursée. */
const JOB_DEADLINE_MS = 25 * 60_000;

type JobRow = typeof analysisJobs.$inferSelect;

export type AnalysisJobView = AnalysisJob;

function viewOf(row: JobRow): AnalysisJobView {
  return {
    id: row.id,
    query: row.query,
    market: row.market,
    status: row.status as AnalysisJobStatus,
    reportId: row.reportId,
    error: row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? 'L’analyse a échoué.' } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.sources ? { sources: row.sources as WebGroundingSource[] } : {}),
  };
}

/** Analyses en cours dans ce processus : un même travail n'est jamais exécuté deux fois. */
const running = new Set<string>();

async function setStatus(jobId: string, status: AnalysisJobStatus): Promise<void> {
  await getDb()
    .update(analysisJobs)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(analysisJobs.id, jobId), inArray(analysisJobs.status, ACTIVE)));
}

/** Échec : message gardé, points rendus une seule fois (la réclamation est conditionnelle). */
async function failJob(jobId: string, error: unknown): Promise<void> {
  const known = error instanceof AppError;
  const code = known ? error.code : 'ANALYSIS_FAILED';
  const message = known ? error.message : 'L’analyse a échoué sur le serveur. Réessayez : vos points ont été rendus.';
  if (!known) console.error('[analyse] échec inattendu', error);

  await getDb().transaction(async (tx) => {
    const [claimed] = await tx
      .update(analysisJobs)
      .set({ status: 'failed', errorCode: code, errorMessage: message, refunded: true, updatedAt: new Date(), completedAt: new Date() })
      .where(and(eq(analysisJobs.id, jobId), inArray(analysisJobs.status, ACTIVE), eq(analysisJobs.refunded, false)))
      .returning();
    if (claimed?.debitTransactionId && claimed.creditsCharged > 0) {
      await refundDebit(
        { debitTransactionId: claimed.debitTransactionId, generationId: null, note: 'L’analyse n’a pas abouti : points rendus.' },
        tx,
      );
    }
  });
}

async function runJob(jobId: string): Promise<void> {
  if (running.has(jobId)) return;
  running.add(jobId);
  const db = getDb();
  try {
    const [job] = await db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).limit(1);
    if (!job || !ACTIVE.includes(job.status as AnalysisJobStatus)) return;

    const [owner] = await db.select({ country: users.country }).from(users).where(eq(users.id, job.userId)).limit(1);
    const request: AnalysisRequest = { query: job.query, market: job.market };
    const now = new Date();

    await setStatus(jobId, 'research');
    const research = await researchMarket({
      query: job.query,
      market: job.market,
      marketName: job.market ? countryName(job.market) : null,
      today: todayLabel(now),
      researchRef: job.researchRef,
      onResearchRef: async (ref) => {
        await db.update(analysisJobs).set({ researchRef: ref, updatedAt: new Date() }).where(eq(analysisJobs.id, jobId));
      },
    });

    /*
      Les sources sont enregistrées avec le passage en rédaction : le travail le plus long
      est fini, ses résultats sont connus, et l'écran peut les montrer au lieu de laisser
      l'utilisateur devant une barre immobile une minute de plus.
    */
    await db
      .update(analysisJobs)
      .set({ status: 'writing', sources: research.sources, updatedAt: new Date() })
      .where(and(eq(analysisJobs.id, jobId), inArray(analysisJobs.status, ACTIVE)));
    const report = await writeReport({ userId: job.userId, userCountry: owner?.country ?? null, request, now, research });

    await db.transaction(async (tx) => {
      const [done] = await tx
        .update(analysisJobs)
        .set({ status: 'completed', reportId: report.id, updatedAt: new Date(), completedAt: new Date() })
        .where(and(eq(analysisJobs.id, jobId), inArray(analysisJobs.status, ACTIVE)))
        .returning();
      if (!done) return;
      await tx
        .insert(generations)
        .values({
          userId: done.userId,
          kind: 'niche_analysis',
          provider: 'smart-creator',
          providerRef: report.id,
          status: 'completed',
          fileFormat: null,
          creditsCharged: done.creditsCharged,
          debitTransactionId: done.debitTransactionId,
          completedAt: new Date(),
        });
    });
  } catch (error) {
    await failJob(jobId, error).catch((failure: unknown) => console.error('[analyse] échec non enregistré', failure));
  } finally {
    running.delete(jobId);
  }
}

/**
 * Lance une analyse. Une analyse déjà en cours sur le compte est renvoyée telle quelle, sans
 * nouvelle réservation de points.
 */
export async function startAnalysis(auth: RequestAuth, request: AnalysisRequest): Promise<{ job: AnalysisJobView; created: boolean }> {
  if (!providers.gemini) throw providerUnavailable('rédaction par IA');
  if (!providers.webSearch) {
    throw new AppError(
      503,
      'L’analyse de niche exige l’étude de marché sur le web, qui n’est pas branchée sur ce serveur : l’administrateur doit la configurer. Aucun point n’a été retiré.',
      'WEB_SEARCH_NOT_CONFIGURED',
    );
  }
  // Un service déjà relevé en panne : on refuse maintenant, avant tout débit, plutôt que
  // de faire attendre puis de rembourser.
  ensureReady(['writing', 'webSearch', 'database']);

  const userId = auth.account.user.id;
  const db = getDb();
  const current = async () =>
    (
      await db
        .select()
        .from(analysisJobs)
        .where(and(eq(analysisJobs.userId, userId), inArray(analysisJobs.status, ACTIVE)))
        .limit(1)
    )[0];

  const existing = await current();
  if (existing) return { job: viewOf(existing), created: false };

  const debit = await debitCredits({
    userId,
    cost: await getActionCost('niche_analysis'),
    actionId: 'niche_analysis',
    unlimited: auth.account.plan.monthlyCredits === null,
  });

  let job: JobRow | undefined;
  try {
    [job] = await db
      .insert(analysisJobs)
      .values({
        userId,
        query: request.query,
        market: request.market ?? null,
        status: 'queued',
        creditsCharged: debit.charged,
        debitTransactionId: debit.transactionId,
      })
      .returning();
  } catch (error) {
    // Deux lancements simultanés : l'index unique n'en garde qu'un, l'autre rend ses points.
    await refundDebit({ debitTransactionId: debit.transactionId, generationId: null, note: 'Analyse déjà en cours : points rendus.' });
    const concurrent = await current();
    if (concurrent) return { job: viewOf(concurrent), created: false };
    throw error;
  }

  runInBackground(() => runJob(job!.id), `analyse ${job!.id}`);
  return { job: viewOf(job!), created: true };
}

const jobIdSchema = z.string().uuid();

export async function getAnalysisJob(auth: RequestAuth, jobId: string | undefined): Promise<AnalysisJobView> {
  const parsed = jobIdSchema.safeParse(jobId);
  if (!parsed.success) throw new AppError(404, 'Analyse introuvable sur votre compte.', 'ANALYSIS_JOB_NOT_FOUND');
  const [job] = await getDb()
    .select()
    .from(analysisJobs)
    .where(and(eq(analysisJobs.id, parsed.data), eq(analysisJobs.userId, auth.account.user.id)))
    .limit(1);
  if (!job) throw new AppError(404, 'Analyse introuvable sur votre compte.', 'ANALYSIS_JOB_NOT_FOUND');
  // Filet de sécurité : une analyse orpheline (processus arrêté, instance sans serveur gelée)
  // est relancée par le suivi. C'est elle qui fait avancer le travail d'une instance à l'autre.
  if (ACTIVE.includes(job.status as AnalysisJobStatus) && !running.has(job.id)) {
    runInBackground(() => resumeJob(job), `reprise de l’analyse ${job.id}`);
  }
  return viewOf(job);
}

/**
 * Renonce à une analyse en cours et rend les points.
 *
 * Sans cette sortie, une erreur de saisie coûtait plusieurs minutes d'attente : une seule
 * analyse peut tourner par compte, et rien ne permettait d'y renoncer. Le travail engagé
 * chez le moteur de recherche n'est pas récupérable, mais l'utilisateur n'en reçoit rien :
 * lui faire payer une analyse qu'il n'aura jamais serait injuste.
 */
export async function cancelAnalysis(auth: RequestAuth, jobId: string | undefined): Promise<AnalysisJobView> {
  const parsed = jobIdSchema.safeParse(jobId);
  if (!parsed.success) throw new AppError(404, 'Analyse introuvable sur votre compte.', 'ANALYSIS_JOB_NOT_FOUND');

  const [job] = await getDb()
    .select()
    .from(analysisJobs)
    .where(and(eq(analysisJobs.id, parsed.data), eq(analysisJobs.userId, auth.account.user.id)))
    .limit(1);
  if (!job) throw new AppError(404, 'Analyse introuvable sur votre compte.', 'ANALYSIS_JOB_NOT_FOUND');

  if (!ACTIVE.includes(job.status as AnalysisJobStatus)) {
    // Terminée entre l'affichage du bouton et le clic : son résultat vaut mieux qu'une erreur.
    return viewOf(job);
  }

  await failJob(
    job.id,
    new AppError(200, 'Analyse annulée à votre demande : vos points ont été rendus.', 'ANALYSIS_CANCELLED'),
  );

  const [cancelled] = await getDb().select().from(analysisJobs).where(eq(analysisJobs.id, job.id)).limit(1);
  return viewOf(cancelled ?? job);
}

export async function getActiveAnalysisJob(auth: RequestAuth): Promise<AnalysisJobView | null> {
  const [job] = await getDb()
    .select()
    .from(analysisJobs)
    .where(and(eq(analysisJobs.userId, auth.account.user.id), inArray(analysisJobs.status, ACTIVE)))
    .limit(1);
  return job ? viewOf(job) : null;
}

async function resumeJob(job: JobRow): Promise<void> {
  if (Date.now() - job.createdAt.getTime() > JOB_DEADLINE_MS) {
    await failJob(
      job.id,
      new AppError(
        504,
        'L’analyse a été interrompue et n’a pas pu reprendre. Relancez-la : vos points ont été rendus.',
        'ANALYSIS_INTERRUPTED',
      ),
    );
    return;
  }
  await runJob(job.id);
}

/** Au démarrage du serveur : reprend les analyses en cours, abandonne (et rembourse) les trop anciennes. */
export async function resumeAnalysisJobs(): Promise<number> {
  const db = getDb();
  const stale = await db
    .select()
    .from(analysisJobs)
    .where(and(inArray(analysisJobs.status, ACTIVE), lt(analysisJobs.createdAt, new Date(Date.now() - JOB_DEADLINE_MS))));
  for (const job of stale) await resumeJob(job);

  const active = await db.select().from(analysisJobs).where(inArray(analysisJobs.status, ACTIVE));
  for (const job of active) void resumeJob(job);
  return active.length;
}
