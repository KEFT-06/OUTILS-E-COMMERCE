import { Router, type Request } from 'express';
import { z } from 'zod';
import { AppError, asyncRoute } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import {
  fileFormatOf,
  generationStateOf,
  getCreativeStatus,
  PROVIDER_RETENTION_DAYS,
  streamCreativeFile,
} from '@server/services/creatives';
import { VEO_KEEPS_DAYS, videoArchiveConfigured, videoRetentionDaysFor } from '@server/services/creatives/archive';
import { listLocalVisuals, localVisualExists, sendLocalVisual } from '@server/services/creatives/local';
import type { CreativeProvider } from '@server/services/creatives';
import { falRequestIdSchema } from '@server/services/fal';
import { veoRequestIdSchema } from '@server/services/veo';
import { findOwnedGeneration, findOwnedGenerationByFormerRef, listOwnVideoGenerations, settleGeneration } from '@server/services/generations';

/**
 * Visuels et vidéos DÉJÀ créés : suivi, listes et fichiers.
 *
 * La création de visuels et de vidéos est retirée du site le 28/10/2026 (décision du propriétaire).
 * Ce qui a été produit avant reste à son auteur : il le retrouve dans « Mes créations », le
 * télécharge, et une vidéo encore en rendu ce jour-là va au bout de son suivi. Aucune route ne
 * lance plus de génération.
 */

/** Identifiant d'un visuel interne : un UUID, frappé par le serveur à l'enregistrement. */
const internalRequestIdSchema = z.string().uuid();

export const creativesRouter = Router();

/**
 * Les fournisseurs ne nomment pas leurs demandes de la même façon : un visuel interne porte un
 * UUID, fal.ai une chaîne alphanumérique plus libre, Veo un identifiant d'opération. On accepte
 * ces formes, puis c'est la génération enregistrée qui dit de quel fournisseur elle vient.
 */
function parseCreativeRequestId(value: string | undefined): string {
  const parsed = internalRequestIdSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const chezFal = falRequestIdSchema.safeParse(value);
  if (chezFal.success) return chezFal.data;
  /*
    Google nomme ses opérations `models/<modèle>/operations/<id>`. Seul l'`<id>` voyage, et
    ce schéma le vérifie : laisser passer un chemin ferait interroger par le serveur une
    adresse choisie par l'appelant.
  */
  const chezVeo = veoRequestIdSchema.safeParse(value);
  if (chezVeo.success) return chezVeo.data;
  throw new AppError(400, 'Identifiant de génération invalide.', 'INVALID_GENERATION_ID');
}

/** Retrouve la génération de son auteur, quel que soit le fournisseur qui l'a produite, et dit lequel c'est. */
async function findCreative(req: Request, requestId: string) {
  const candidats: CreativeProvider[] = ['interne', 'veo', 'fal'];
  for (const provider of candidats) {
    try {
      return { generation: await findOwnedGeneration(req.auth!, provider, requestId), provider };
    } catch (error) {
      if (error instanceof AppError && error.code === 'GENERATION_NOT_FOUND') continue;
      throw error;
    }
  }
  throw new AppError(404, 'Génération introuvable sur votre compte.', 'GENERATION_NOT_FOUND');
}

const DAY_MS = 24 * 3_600_000;

/**
 * Jours pendant lesquels une vidéo de cet auteur reste téléchargeable : ceux de son palier,
 * ou les deux jours du fournisseur quand aucune copie ne peut être faite (stockage non configuré).
 */
async function videoRetentionDays(userId: string): Promise<number> {
  const planned = await videoRetentionDaysFor(userId);
  return videoArchiveConfigured() ? planned : Math.min(planned, VEO_KEEPS_DAYS);
}

/** Échéance d'une vidéo : celle de sa copie, ou sa fin de rendu plus la durée du palier. */
function videoDeadline(
  video: { archiveExpiresAt: Date | null; completedAt: Date | null; createdAt: Date },
  retentionDays: number,
): Date {
  return video.archiveExpiresAt ?? new Date((video.completedAt ?? video.createdAt).getTime() + retentionDays * DAY_MS);
}

/** Suivi d'une génération de son auteur. Hors limites de génération : l'écran sonde toutes les 5 secondes. */
creativesRouter.get(
  '/requests/:requestId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const requestId = parseCreativeRequestId(req.params.requestId);
    let found: Awaited<ReturnType<typeof findCreative>>;
    try {
      found = await findCreative(req, requestId);
    } catch (error) {
      // Rendu relancé autrefois : l'écran qui suit encore l'ancien identifiant est remis sur le nouveau.
      const moved =
        error instanceof AppError && error.code === 'GENERATION_NOT_FOUND' ? await findOwnedGenerationByFormerRef(req.auth!, 'veo', requestId) : null;
      if (!moved?.providerRef) throw error;
      res.json({ requestId: moved.providerRef, status: moved.status === 'completed' ? 'completed' : moved.status === 'failed' ? 'failed' : 'in_progress', ...(moved.status === 'completed' ? { mediaType: 'video' } : {}) });
      return;
    }
    const { generation, provider } = found;

    /*
      Un visuel produit chez nous est enregistré une fois terminé : son existence EST son état.
      Il n'y a personne à sonder, et la génération a déjà été soldée à l'enregistrement.
    */
    if (provider === 'interne') {
      if (!(await localVisualExists(req.auth!, requestId))) {
        throw new AppError(404, 'Visuel introuvable sur votre compte.', 'CREATIVE_FILE_MISSING');
      }
      res.json({ requestId, status: 'completed', mediaType: 'image', retentionDays: PROVIDER_RETENTION_DAYS.interne });
      return;
    }

    const retentionDays = await videoRetentionDays(generation.userId);
    const deadline = videoDeadline(generation, retentionDays);
    /*
      Vidéo échue : ni le fournisseur ni notre stockage ne l'ont plus. Le dire, sans interroger
      le fournisseur — qui répondrait « introuvable », affiché comme une panne.
    */
    if (generation.status === 'completed' && deadline.getTime() < Date.now()) {
      res.json({ requestId, status: 'completed', mediaType: 'video', retentionDays, availableUntil: deadline.toISOString(), expired: true, durationSeconds: generation.durationSeconds });
      return;
    }
    // Un échec n'est plus relancé : aucune nouvelle vidéo ne part. Il est soldé, et les points rendus.
    const { retryable: _retryable, ...status } = await getCreativeStatus(requestId, provider);
    const settled = await settleGeneration(generation, generationStateOf(status.status), fileFormatOf(status));
    res.json({
      ...status,
      retentionDays,
      ...(settled.status === 'completed' ? { availableUntil: videoDeadline(settled, retentionDays).toISOString() } : {}),
      durationSeconds: settled.durationSeconds,
    });
  }),
);

/**
 * « Mes vidéos » : les vidéos de l'auteur, en cours ou rendues. L'état rendu ici est celui de la
 * base : une vidéo encore « en cours » est sondée par l'écran, qui la solde.
 */
creativesRouter.get(
  '/videos',
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = req.auth!.account.user.id;
    const retentionDays = await videoRetentionDays(userId);
    const demandees = Number(req.query.limit);
    const limite = Number.isInteger(demandees) ? Math.min(Math.max(demandees, 1), 60) : 12;
    const rows = await listOwnVideoGenerations(userId, ['veo', 'fal'], new Date(Date.now() - 120 * DAY_MS), 120);
    // Une vidéo longue se construisait par étapes : seule sa dernière version est montrée.
    const prolongees = new Set(rows.map((row) => row.parentId).filter((id): id is string => id !== null));
    const now = Date.now();
    res.json({
      videos: rows
        .filter((row) => !prolongees.has(row.id))
        .slice(0, limite)
        .map((row) => {
          const deadline = videoDeadline(row, retentionDays);
          const completed = row.status === 'completed';
          return {
            requestId: row.providerRef,
            status: completed ? 'completed' : 'in_progress',
            createdAt: row.createdAt.toISOString(),
            durationSeconds: row.durationSeconds,
            availableUntil: completed ? deadline.toISOString() : null,
            expired: completed && deadline.getTime() < now,
          };
        }),
    });
  }),
);

/**
 * Vidéos du compte qui seront supprimées dans les 48 heures : la pastille de « Mes créations ».
 * Un entier, lu à chaque écran : aucune liste, aucun fichier.
 */
creativesRouter.get(
  '/expiring',
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = req.auth!.account.user.id;
    const retentionDays = await videoRetentionDays(userId);
    const rows = await listOwnVideoGenerations(userId, ['veo', 'fal'], new Date(Date.now() - 120 * DAY_MS), 120);
    const prolongees = new Set(rows.map((row) => row.parentId).filter((id): id is string => id !== null));
    const now = Date.now();
    const expiring = rows.filter((row) => {
      if (prolongees.has(row.id) || row.status !== 'completed') return false;
      const reste = videoDeadline(row, retentionDays).getTime() - now;
      return reste > 0 && reste < 2 * DAY_MS;
    }).length;
    res.json({ expiring });
  }),
);

/** « Mes visuels » : les visuels enregistrés de l'auteur, sans leurs octets. */
creativesRouter.get(
  '/visuals',
  requireAuth,
  asyncRoute(async (req, res) => {
    const page = Math.min(Math.max(Number.parseInt(String(req.query.page ?? '1'), 10) || 1, 1), 1_000);
    res.json(await listLocalVisuals(req.auth!, page));
  }),
);

/** Fichier généré, relayé depuis le fournisseur, à son seul auteur (aperçu ou téléchargement). */
creativesRouter.get(
  '/requests/:requestId/file',
  requireAuth,
  asyncRoute(async (req, res) => {
    const requestId = parseCreativeRequestId(req.params.requestId);
    const { generation, provider } = await findCreative(req, requestId);
    const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline';
    if ((provider === 'veo' || provider === 'fal') && generation.status === 'completed') {
      const retentionDays = await videoRetentionDays(generation.userId);
      const deadline = videoDeadline(generation, retentionDays);
      if (deadline.getTime() < Date.now()) {
        throw new AppError(
          410,
          `Cette vidéo a expiré le ${deadline.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} : votre palier la conserve ${retentionDays === 1 ? '24 heures' : `${retentionDays} jours`}.`,
          'VIDEO_EXPIRED',
        );
      }
    }
    // Le visuel produit chez nous n'a aucun fournisseur à interroger : il est déjà en base.
    if (provider === 'interne') {
      await sendLocalVisual(req.auth!, requestId, disposition, res);
      return;
    }
    await streamCreativeFile(requestId, provider, disposition, res);
  }),
);
