import { Router, type Request } from 'express';
import { providers } from '@server/env';
import { AppError, aiLimiter, asyncRoute, providerUnavailable, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import { effectiveLimits } from '@server/services/accounts';
import { assertCompliantBrief } from '@server/services/compliance/guard';
import {
  type VideoBrief,
  type VisualBrief,
  creativeText,
  fileFormatOf,
  generationStateOf,
  getCreativeStatus,
  streamCreativeFile,
  submitVideo,
  submitVisual,
  videoBriefSchema,
  visualBriefSchema,
} from '@server/services/creatives';
import { findOwnedGeneration, runBilledGeneration, settleGeneration } from '@server/services/generations';
import { requestIdSchema } from '@server/services/higgsfield';
import { findAdFramework, isAdFrameworkAvailable } from '@server/shared/adFrameworks';

/** Créatifs publicitaires : visuels et vidéos générés par Higgsfield (feuille de route 4.1, 4.2, 4.4). */

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

function parseCreativeRequestId(value: string | undefined): string {
  const parsed = requestIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, 'Identifiant de génération invalide.', 'INVALID_GENERATION_ID');
  }
  return parsed.data;
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
    if (!providers.higgsfield) throw providerUnavailable('création de visuels et vidéos');

    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'video_generation',
      kind: 'video',
      provider: 'higgsfield',
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
    if (!providers.higgsfield) throw providerUnavailable('création de visuels et vidéos');

    const generation = await findOwnedGeneration(req.auth!, 'higgsfield', requestId);
    const status = await getCreativeStatus(requestId);
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
    if (!providers.higgsfield) throw providerUnavailable('création de visuels et vidéos');

    await findOwnedGeneration(req.auth!, 'higgsfield', requestId);
    const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline';
    await streamCreativeFile(requestId, disposition, res);
  }),
);
