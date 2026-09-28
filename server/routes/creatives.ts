import { Router, type Request } from 'express';
import { z } from 'zod';
import { AppError, aiLimiter, asyncRoute, providerUnavailable, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import { effectiveLimits } from '@server/services/accounts';
import { assertCompliantBrief } from '@server/services/compliance/guard';
import {
  type VideoBrief,
  type VisualBrief,
  buildVisualInput,
  creativeText,
  extendVideo,
  extensionSchema,
  fileFormatOf,
  generationStateOf,
  getCreativeStatus,
  imagesConfigured,
  PROVIDER_RETENTION_DAYS,
  streamCreativeFile,
  submitVideo,
  videoBriefSchema,
  visualBriefSchema,
  VIDEO_PROVIDER,
} from '@server/services/creatives';
import { videoArchiveConfigured } from '@server/services/creatives/archive';
import { createLocalVisual, listLocalVisuals, localVisualExists, sendLocalVisual } from '@server/services/creatives/local';
import type { CreativeProvider } from '@server/services/creatives';
import { falRequestIdSchema } from '@server/services/fal';
import {
  VEO_EXTENSION_RESOLUTION,
  VEO_EXTENSION_SECONDS,
  VEO_EXTENSION_WINDOW_MS,
  VEO_MAX_INPUT_SECONDS,
  VEO_MAX_TOTAL_SECONDS,
  veoConfigured,
  veoRequestIdSchema,
  veoResolutionFor,
} from '@server/services/veo';
import { findOwnedGeneration, runBilledGeneration, settleGeneration } from '@server/services/generations';
import { findAdFramework, isAdFrameworkAvailable } from '@server/shared/adFrameworks';

/** Créatifs publicitaires : visuels par le moteur d'images interne (Google), vidéos par Veo (feuille de route 4.1, 4.2, 4.4). */

/** Identifiant d'un visuel interne : un UUID, frappé par le serveur à l'enregistrement. */
const internalRequestIdSchema = z.string().uuid();

export const creativesRouter = Router();

/** Une méthode publicitaire hors du palier est refusée par le serveur, pas seulement grisée à l'écran. */
function assertFrameworkAllowed(req: Request, brief: VisualBrief | VideoBrief): void {
  if (brief.purpose !== 'ad' || !brief.adFramework) return;
  const { account } = req.auth!;
  if (isAdFrameworkAvailable(brief.adFramework, effectiveLimits(account).adFrameworks)) return;
  const framework = findAdFramework(brief.adFramework);
  throw new AppError(
    403,
    `La méthode ${framework?.acronym ?? brief.adFramework} n’est pas incluse dans votre palier ${account.plan.label}. Choisissez une autre méthode, ou passez à un palier supérieur.`,
    'FRAMEWORK_LOCKED',
    { framework: brief.adFramework },
  );
}

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
  // « fal » reste dans la liste : les vidéos lancées avant la bascule vers Veo doivent
  // rester suivies et téléchargeables jusqu'à leur terme.
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

creativesRouter.post(
  '/visuals',
  requireAuth,
  requireFeature('image_generation'),
  aiLimiter,
  validateBody(visualBriefSchema),
  asyncRoute(async (req, res) => {
    const brief = req.body as VisualBrief;
    assertFrameworkAllowed(req, brief);
    await assertCompliantBrief(
      creativeText(brief),
      'Le brief du visuel contient des formulations non conformes : corrigez-les avant de lancer la génération.',
    );
    /*
      Un seul chemin : le moteur d'images interne (Google, Cloudflare en secours s'il est
      configuré) rend l'image elle-même, enregistrée sur le compte de son auteur. Higgsfield,
      qui rendait un lien à relayer, est abandonné.
    */
    if (!imagesConfigured()) throw providerUnavailable('création de visuels');
    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'image_generation',
      kind: 'image',
      provider: 'interne',
      run: () => createLocalVisual(req.auth!, { prompt: buildVisualInput(brief).prompt, format: brief.format }),
      describe: (image) => ({
        providerRef: image.requestId,
        state: 'completed',
        fileFormat: image.mimeType === 'image/jpeg' ? 'jpg' : (image.mimeType.split('/')[1] ?? 'png'),
      }),
    });
    res.status(202).json({ requestId: result.requestId, status: 'completed', mediaType: 'image', retentionDays: PROVIDER_RETENTION_DAYS.interne });
  }),
);

creativesRouter.post(
  '/videos',
  requireAuth,
  requireFeature('video_generation'),
  aiLimiter,
  validateBody(videoBriefSchema),
  asyncRoute(async (req, res) => {
    const brief = req.body as VideoBrief;
    assertFrameworkAllowed(req, brief);
    await assertCompliantBrief(
      creativeText(brief),
      'Le brief de la vidéo contient des formulations non conformes : corrigez-les avant de lancer la génération.',
    );
    if (!veoConfigured()) throw providerUnavailable('rendu vidéo');

    const duree = brief.extendable ? 8 : brief.duration;
    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'video_generation',
      kind: 'video',
      provider: VIDEO_PROVIDER,
      run: () => submitVideo(brief),
      describe: (status) => ({
        providerRef: status.requestId,
        state: generationStateOf(status.status),
        fileFormat: fileFormatOf(status),
      }),
      video: { durationSeconds: duree, resolution: veoResolutionFor(duree, brief.extendable) },
    });

    res.status(202).json({ ...result, retentionDays: videoArchiveConfigured() ? null : PROVIDER_RETENTION_DAYS[VIDEO_PROVIDER] });
  }),
);

/**
 * Prolonge de 7 secondes une vidéo longue de son auteur. Toutes les règles de Google sont
 * vérifiées AVANT de retirer le moindre point : une prolongation vouée à l'échec ne se paie pas.
 */
creativesRouter.post(
  '/videos/:requestId/extend',
  requireAuth,
  requireFeature('video_generation'),
  aiLimiter,
  validateBody(extensionSchema),
  asyncRoute(async (req, res) => {
    const parsedId = veoRequestIdSchema.safeParse(req.params.requestId);
    if (!parsedId.success) throw new AppError(400, 'Identifiant de vidéo invalide.', 'INVALID_GENERATION_ID');
    const parent = await findOwnedGeneration(req.auth!, 'veo', parsedId.data);
    const refus = extensionRefusal(parent);
    if (refus) throw new AppError(409, refus, 'VIDEO_NOT_EXTENDABLE');

    const { sceneDescription } = req.body as { sceneDescription: string };
    await assertCompliantBrief(sceneDescription, 'La scène décrite contient des formulations non conformes : corrigez-la avant de prolonger la vidéo.');
    if (!veoConfigured()) throw providerUnavailable('rendu vidéo');

    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'video_extension',
      kind: 'video',
      provider: VIDEO_PROVIDER,
      run: () => extendVideo(parsedId.data, sceneDescription),
      describe: (status) => ({ providerRef: status.requestId, state: generationStateOf(status.status), fileFormat: fileFormatOf(status) }),
      video: { parentId: parent.id, durationSeconds: (parent.durationSeconds ?? 8) + VEO_EXTENSION_SECONDS, resolution: VEO_EXTENSION_RESOLUTION },
    });
    res.status(202).json({ ...result, retentionDays: videoArchiveConfigured() ? null : PROVIDER_RETENTION_DAYS[VIDEO_PROVIDER] });
  }),
);

/**
 * Raison pour laquelle une vidéo ne peut pas être prolongée, ou null si elle le peut.
 * Règles de Google : vidéo Veo en 720p, de 141 s au plus, et de moins de deux jours.
 */
function extensionRefusal(video: { status: string; resolution: string | null; durationSeconds: number | null; completedAt: Date | null; createdAt: Date }): string | null {
  if (video.status !== 'completed') return 'La vidéo n’est pas encore terminée.';
  if (video.resolution !== VEO_EXTENSION_RESOLUTION || video.durationSeconds === null) {
    return 'Seule une vidéo créée en mode « vidéo longue » (720p) peut être prolongée.';
  }
  if (video.durationSeconds + VEO_EXTENSION_SECONDS > VEO_MAX_TOTAL_SECONDS || video.durationSeconds > VEO_MAX_INPUT_SECONDS) {
    return `La vidéo atteint la durée maximale de ${VEO_MAX_TOTAL_SECONDS} secondes.`;
  }
  if (Date.now() - (video.completedAt ?? video.createdAt).getTime() > VEO_EXTENSION_WINDOW_MS) {
    return 'Google ne prolonge une vidéo que dans les deux jours qui suivent sa création.';
  }
  return null;
}

/** Durée et possibilité de prolonger, renvoyées avec l'état d'une vidéo Veo. */
function videoChainInfo(video: Parameters<typeof extensionRefusal>[0]) {
  return {
    durationSeconds: video.durationSeconds,
    extendable: video.status === 'completed' && extensionRefusal(video) === null,
    maxDurationSeconds: VEO_MAX_TOTAL_SECONDS,
  };
}

/** Suivi d'une génération de son auteur. Hors `aiLimiter` : le client sonde toutes les 5 secondes. */
creativesRouter.get(
  '/requests/:requestId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const requestId = parseCreativeRequestId(req.params.requestId);
    const { generation, provider } = await findCreative(req, requestId);

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

    const status = await getCreativeStatus(requestId, provider);
    const settled = await settleGeneration(generation, generationStateOf(status.status), fileFormatOf(status));
    // Une vidéo Veo copiée (ou en cours de copie, le dépôt partant à la fin du rendu) ne périme plus.
    const archived = provider === 'veo' && (settled.archivedAt !== null || videoArchiveConfigured());
    res.json({
      ...status,
      retentionDays: archived ? null : PROVIDER_RETENTION_DAYS[provider],
      ...(provider === 'veo' ? videoChainInfo(settled) : {}),
    });
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
    const { provider } = await findCreative(req, requestId);
    const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline';
    // Le visuel produit chez nous n'a aucun fournisseur à interroger : il est déjà en base.
    if (provider === 'interne') {
      await sendLocalVisual(req.auth!, requestId, disposition, res);
      return;
    }
    await streamCreativeFile(requestId, provider, disposition, res);
  }),
);
