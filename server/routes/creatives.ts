import { Router, type Request } from 'express';
import { providers } from '@server/env';
import { AppError, aiLimiter, asyncRoute, providerUnavailable, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import { effectiveLimits } from '@server/services/accounts';
import { assertCompliantBrief } from '@server/services/compliance/guard';
import {
  type VideoBrief,
  type VisualBrief,
  buildVisualInput,
  creativeText,
  fileFormatOf,
  generationStateOf,
  getCreativeStatus,
  streamCreativeFile,
  submitVideo,
  submitVisual,
  videoBriefSchema,
  visualBriefSchema,
  visualProvider,
} from '@server/services/creatives';
import { createLocalVisual, localVisualExists, sendLocalVisual } from '@server/services/creatives/local';
import type { CreativeProvider } from '@server/services/creatives';
import { falRequestIdSchema } from '@server/services/fal';
import { findOwnedGeneration, runBilledGeneration, settleGeneration } from '@server/services/generations';
import { requestIdSchema } from '@server/services/higgsfield';
import { findAdFramework, isAdFrameworkAvailable } from '@server/shared/adFrameworks';

/** Créatifs publicitaires : visuels par Cloudflare Workers AI, vidéos par fal.ai (feuille de route 4.1, 4.2, 4.4). */

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
 * Les deux fournisseurs ne nomment pas leurs demandes de la même façon : Higgsfield rend un
 * UUID, fal.ai une chaîne alphanumérique plus libre. On accepte les deux formes, puis c'est
 * la génération enregistrée qui dit de quel fournisseur elle vient.
 */
function parseCreativeRequestId(value: string | undefined): string {
  const parsed = requestIdSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const chezFal = falRequestIdSchema.safeParse(value);
  if (chezFal.success) return chezFal.data;
  throw new AppError(400, 'Identifiant de génération invalide.', 'INVALID_GENERATION_ID');
}

/**
 * Retrouve la génération de son auteur, quel que soit le fournisseur qui l'a produite, et
 * dit lequel c'est. Les créatifs lancés avant la bascule vers fal.ai restent suivis chez
 * Higgsfield jusqu'à leur terme : rien de ce qui a été payé ne devient inaccessible.
 */
async function findCreative(req: Request, requestId: string) {
  const candidats: CreativeProvider[] = ['interne', 'fal', 'higgsfield'];
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
      Deux chemins, parce que les deux fournisseurs ne rendent pas la même chose : Cloudflare
      répond l'image, Higgsfield un lien à relayer. Le client, lui, reçoit la même forme.
    */
    const provider = visualProvider();
    if (provider === 'interne') {
      const { result } = await runBilledGeneration({
        auth: req.auth!,
        actionId: 'image_generation',
        kind: 'image',
        provider,
        run: () => createLocalVisual(req.auth!, { prompt: buildVisualInput(brief).prompt, format: brief.format }),
        describe: (image) => ({
          providerRef: image.requestId,
          state: 'completed',
          fileFormat: image.mimeType === 'image/jpeg' ? 'jpg' : (image.mimeType.split('/')[1] ?? 'png'),
        }),
      });
      res.status(202).json({ requestId: result.requestId, status: 'completed', mediaType: 'image' });
      return;
    }

    if (!providers.higgsfield) throw providerUnavailable('création de visuels et vidéos');

    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'image_generation',
      kind: 'image',
      provider: 'higgsfield',
      run: () => submitVisual(brief),
      describe: (status) => ({
        providerRef: status.requestId,
        state: generationStateOf(status.status),
        fileFormat: fileFormatOf(status),
      }),
    });

    res.status(202).json(result);
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
    if (!providers.fal) throw providerUnavailable('rendu vidéo');

    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'video_generation',
      kind: 'video',
      provider: 'fal',
      run: () => submitVideo(brief),
      describe: (status) => ({
        providerRef: status.requestId,
        state: generationStateOf(status.status),
        fileFormat: fileFormatOf(status),
      }),
    });

    res.status(202).json(result);
  }),
);

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
      res.json({ requestId, status: 'completed', mediaType: 'image' });
      return;
    }

    const status = await getCreativeStatus(requestId, provider);
    await settleGeneration(generation, generationStateOf(status.status), fileFormatOf(status));
    res.json(status);
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
