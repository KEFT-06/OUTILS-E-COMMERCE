import { Router } from 'express';
import { aiLimiter, asyncRoute, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import { type AnalysisRequest, analysisRequestSchema } from '@server/services/analysis';
import { cancelAnalysis, getActiveAnalysisJob, getAnalysisJob, startAnalysis } from '@server/services/analysis/jobs';

/**
 * Analyse stratégique d'une niche : étude du web, rapport rédigé par l'IA, faits sourcés et
 * propositions dites comme telles (server/services/analysis). L'analyse tourne en
 * arrière-plan : le lancement répond tout de suite, le navigateur suit ensuite son avancement.
 * Les rapports enregistrés se lisent par server/routes/reports.ts.
 */

export const analysisRouter = Router();

analysisRouter.post(
  '/analyze-niche',
  requireAuth,
  requireFeature('niche_analysis'),
  aiLimiter,
  validateBody(analysisRequestSchema),
  asyncRoute(async (req, res) => {
    const { job, created } = await startAnalysis(req.auth!, req.body as AnalysisRequest);
    res.status(created ? 202 : 200).json({ job });
  }),
);

/** Analyse en cours du compte, pour reprendre le suivi après un rechargement de la page. */
analysisRouter.get(
  '/analyze-niche/jobs/active',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({ job: await getActiveAnalysisJob(req.auth!) });
  }),
);

/** Avancement d'une analyse du compte (sondé toutes les quelques secondes). */
analysisRouter.get(
  '/analyze-niche/jobs/:jobId',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({ job: await getAnalysisJob(req.auth!, req.params.jobId) });
  }),
);

/** Renoncer à une analyse en cours : points rendus, le compte est libéré tout de suite. */
analysisRouter.delete(
  '/analyze-niche/jobs/:jobId',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({ job: await cancelAnalysis(req.auth!, req.params.jobId) });
  }),
);
