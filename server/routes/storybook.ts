import { Router } from 'express';
import { providers } from '@server/env';
import { AppError, aiLimiter, asyncRoute, providerUnavailable, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import { assertCompliantBrief } from '@server/services/compliance/guard';
import { findOwnedGeneration, runBilledGeneration, settleGeneration } from '@server/services/generations';
import {
  type StorybookBrief,
  briefText,
  createStorybook,
  generationIdSchema,
  getStorybookGeneration,
  listStorybooks,
  recordStorybook,
  sendStorybookPdf,
  storybookBriefSchema,
} from '@server/services/storybook';

/** Storybook africain : conte rédigé par Gemini, mis en page et illustré par Gamma (server/services/storybook). */

export const storybookRouter = Router();

/**
 * Lance la création d'un conte.
 *
 * Ordre des contrôles : compte et palier, validation, conformité du brief, puis disponibilité de
 * Gemini et de Gamma. La conformité passe avant les fournisseurs pour que l'auteur puisse corriger
 * son brief même sur un serveur sans clé.
 */
storybookRouter.post(
  '/generations',
  requireAuth,
  requireFeature('storybook_generation'),
  aiLimiter,
  validateBody(storybookBriefSchema),
  asyncRoute(async (req, res) => {
    const brief = req.body as StorybookBrief;

    await assertCompliantBrief(
      briefText(brief),
      'Le brief contient des formulations non conformes : corrigez-les avant de lancer la génération.',
    );

    if (!providers.gemini) throw providerUnavailable('Gemini');
    if (!providers.gamma) throw providerUnavailable('Gamma');

    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'storybook_generation',
      kind: 'storybook',
      provider: 'gamma',
      run: () => createStorybook(brief),
      describe: (created) => ({ providerRef: created.generationId, state: 'pending', fileFormat: 'pdf' }),
    });
    const storybookId = await recordStorybook(req.auth!, brief, result.generationId, result.story);

    res.status(202).json({ generationId: result.generationId, storybookId, title: result.story.title });
  }),
);

/** Contes du compte, du plus récent au plus ancien. */
storybookRouter.get(
  '/books',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({ storybooks: await listStorybooks(req.auth!) });
  }),
);

/** PDF d'un conte terminé. Le lien d'export de Gamma, secret, ne quitte jamais le serveur. */
storybookRouter.get(
  '/books/:storybookId/pdf',
  requireAuth,
  routeLimiter(10, 60),
  asyncRoute(async (req, res) => {
    if (!providers.gamma) throw providerUnavailable('Gamma');
    await sendStorybookPdf(req.auth!, req.params.storybookId, res);
  }),
);

/** Suivi d'une génération de son auteur. Hors `aiLimiter` : le client sonde toutes les 5 secondes. */
storybookRouter.get(
  '/generations/:generationId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const parsed = generationIdSchema.safeParse(req.params.generationId);
    if (!parsed.success) {
      throw new AppError(400, 'Identifiant de génération invalide.', 'INVALID_GENERATION_ID');
    }
    if (!providers.gamma) throw providerUnavailable('Gamma');

    const generation = await findOwnedGeneration(req.auth!, 'gamma', parsed.data);
    const status = await getStorybookGeneration(parsed.data);
    await settleGeneration(generation, status.status);
    res.json(status);
  }),
);
