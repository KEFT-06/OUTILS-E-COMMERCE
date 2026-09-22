import { and, asc, eq, lt } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { generations } from '@server/db/schema';
import { providers } from '@server/env';
import { AppError } from '@server/middleware';
import { fileFormatOf, generationStateOf, getCreativeStatus } from '@server/services/creatives';
import { settleGeneration, type GenerationRow } from '@server/services/generations';
import { getStorybookGeneration } from '@server/services/storybook';

/**
 * Suivi des générations que plus aucun écran ne surveille.
 *
 * Le navigateur sonde le fournisseur tant que l'écran est ouvert. S'il est fermé
 * avant la fin, la génération resterait « en cours » et ses points réservés pour
 * toujours. Ce balayage reprend le suivi côté serveur : une génération échouée
 * rend ses points, une génération sans nouvelles depuis 48 h est abandonnée et
 * remboursée — les fournisseurs ne conservent de toute façon rien au-delà de
 * quelques jours.
 */

/** Laisse d'abord le navigateur suivre sa génération. */
const RESUME_AFTER_MS = 10 * 60_000;
const ABANDON_AFTER_MS = 48 * 3_600_000;
const BATCH_SIZE = 25;

const NOT_FOUND_CODES = new Set(['HIGGSFIELD_NOT_FOUND', 'GAMMA_GENERATION_NOT_FOUND', 'FAL_NOT_FOUND']);

async function checkWithProvider(generation: GenerationRow): Promise<GenerationRow> {
  if (!generation.providerRef) return settleGeneration(generation, 'failed');

  try {
    // Les vidéos sont chez fal.ai depuis la bascule, les visuels — et les créatifs plus
    // anciens — restent chez Higgsfield : le balayeur suit les deux, sans quoi une
    // génération abandonnée ne rendrait jamais ses points.
    if (generation.provider === 'fal' && providers.fal) {
      const status = await getCreativeStatus(generation.providerRef, 'fal');
      return settleGeneration(generation, generationStateOf(status.status), fileFormatOf(status));
    }
    if (generation.provider === 'higgsfield' && providers.higgsfield) {
      const status = await getCreativeStatus(generation.providerRef, 'higgsfield');
      return settleGeneration(generation, generationStateOf(status.status), fileFormatOf(status));
    }
    if (generation.provider === 'gamma' && providers.gamma) {
      const status = await getStorybookGeneration(generation.providerRef);
      return settleGeneration(generation, status.status);
    }
  } catch (error) {
    // Le fournisseur ne connaît pas (ou plus) cette génération : elle ne produira rien.
    if (error instanceof AppError && error.code && NOT_FOUND_CODES.has(error.code)) {
      return settleGeneration(generation, 'failed');
    }
    throw error;
  }

  return generation;
}

export async function sweepPendingGenerations(now = new Date()): Promise<{ checked: number; settled: number }> {
  const rows = await getDb()
    .select()
    .from(generations)
    .where(and(eq(generations.status, 'pending'), lt(generations.createdAt, new Date(now.getTime() - RESUME_AFTER_MS))))
    .orderBy(asc(generations.createdAt))
    .limit(BATCH_SIZE);

  let settled = 0;
  for (const row of rows) {
    try {
      const next =
        now.getTime() - row.createdAt.getTime() > ABANDON_AFTER_MS
          ? await settleGeneration(row, 'failed')
          : await checkWithProvider(row);
      if (next.status !== 'pending') settled += 1;
    } catch (error) {
      console.error('[générations] suivi impossible :', row.id, error instanceof Error ? error.message : error);
    }
  }

  return { checked: rows.length, settled };
}

/** Lance le balayage périodique. Renvoie la fonction d'arrêt. */
export function startGenerationSweeper(intervalMs = 5 * 60_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    sweepPendingGenerations()
      .catch((error: unknown) => console.error('[générations] balayage interrompu :', error))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
