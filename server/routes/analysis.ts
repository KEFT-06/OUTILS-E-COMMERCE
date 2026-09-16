import { Router } from 'express';
import { aiLimiter, asyncRoute, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import { type AnalysisRequest, analysisRequestSchema, analyzeNiche } from '@server/services/analysis';

/**
 * Analyse stratégique d'une niche : faits de marché sourcés, propositions de l'IA dites
 * comme telles, rapport conservé sur le compte (server/services/analysis). Les rapports
 * enregistrés se lisent ensuite par server/routes/reports.ts.
 */

export const analysisRouter = Router();

analysisRouter.post(
  '/analyze-niche',
  requireAuth,
  requireFeature('niche_analysis'),
  aiLimiter,
  validateBody(analysisRequestSchema),
  asyncRoute(async (req, res) => {
    res.status(201).json(await analyzeNiche(req.auth!, req.body as AnalysisRequest));
  }),
);
