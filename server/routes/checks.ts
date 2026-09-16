import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncRoute, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { checkText } from '@server/services/compliance';
import { asComplianceRouteError } from '@server/services/compliance/guard';
import { OriginalityConfigUnavailableError, checkOriginality } from '@server/services/originality';

/**
 * Vérificateurs appelés avant chaque export : conformité publicitaire (droit de veto)
 * et originalité (avertissement bloquant sous le seuil, feuille de route 3.2).
 * Réservés aux comptes : le calcul coûte, il ne doit pas être ouvert à tous.
 */

export const checksRouter = Router();

const complianceSchema = z.object({
  text: z.string().min(1).max(20_000),
  context: z.enum(['ad_copy', 'product_page', 'ebook', 'storybook', 'video_script']).optional(),
});

checksRouter.post(
  '/compliance/check',
  requireAuth,
  routeLimiter(1, 60),
  validateBody(complianceSchema),
  asyncRoute(async (req, res) => {
    const { text } = req.body as z.infer<typeof complianceSchema>;
    res.json(await checkText(text).catch(asComplianceRouteError));
  }),
);

const originalitySchema = z.object({
  text: z.string().min(1).max(50_000),
  // Plafonds choisis pour rester sous la limite de 1 Mo du corps de requête.
  references: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(200),
        text: z.string().min(1).max(10_000),
      }),
    )
    .max(80)
    .optional(),
});

checksRouter.post(
  '/originality/check',
  requireAuth,
  routeLimiter(1, 20),
  validateBody(originalitySchema),
  asyncRoute(async (req, res) => {
    const { text, references } = req.body as z.infer<typeof originalitySchema>;

    try {
      res.json(await checkOriginality(text, references ?? []));
    } catch (error) {
      if (error instanceof OriginalityConfigUnavailableError) {
        console.error('[originalité] paramètres illisibles :', error.configPath, error.cause);
        throw new AppError(503, error.message, 'ORIGINALITY_UNAVAILABLE');
      }
      throw error;
    }
  }),
);
