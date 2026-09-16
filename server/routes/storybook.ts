import { Router } from 'express';
import { providers } from '@server/env';
import { AppError, aiLimiter, asyncRoute, providerUnavailable, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import { assertCompliantBrief } from '@server/services/compliance/guard';
import { findOwnedGeneration, runBilledGeneration, settleGeneration } from '@server/services/generations';
import {
  type StorybookBrief,
  briefText,
  createStorybookGeneration,
  generationIdSchema,
  getStorybookGeneration,
  storybookBriefSchema,
} from '@server/services/storybook';

/** Storybook africain via Gamma (feuille de route 3.4). */

export const storybookRouter = Router();

/**
 * Lance la génération d'un conte.
 *
 * Ordre des contrôles : compte et palier, validation, conformité du brief, puis
 * disponibilité de Gamma. La conformité passe avant le fournisseur pour que
 * l'auteur puisse corriger son brief même sur un serveur sans clé Gamma.
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

    if (!providers.gamma) throw providerUnavailable('Gamma');

    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'storybook_generation',
      kind: 'storybook',
      provider: 'gamma',
      run: () => createStorybookGeneration(brief),
      describe: (created) => ({ providerRef: created.generationId, state: 'pending', fileFormat: 'lien' }),
    });

    res.status(202).json(result);
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
