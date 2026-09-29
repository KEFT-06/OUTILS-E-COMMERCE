import { Router } from 'express';
import { asyncRoute } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import { deleteReport, getReport, listReports, todayLabel } from '@server/services/analysis';
import { getReportDocument, startReportDocument } from '@server/services/analysis/document';

/** Rapports d'analyse du compte connecté : liste, lecture, suppression, et rapport rédigé à la demande. */

export const reportsRouter = Router();

reportsRouter.use(requireAuth, (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

reportsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json({ reports: await listReports(req.auth!) });
  }),
);

reportsRouter.get(
  '/:reportId',
  asyncRoute(async (req, res) => {
    res.json({ report: await getReport(req.auth!, req.params.reportId) });
  }),
);

/** Rapport rédigé de l'analyse : null tant qu'il n'a pas été demandé. */
reportsRouter.get(
  '/:reportId/document',
  asyncRoute(async (req, res) => {
    res.json({ document: await getReportDocument(req.auth!, req.params.reportId) });
  }),
);

/** Lance la rédaction (points débités, rendus si elle échoue) ; le navigateur suit ensuite l'avancement. */
reportsRouter.post(
  '/:reportId/document',
  // Même droit que l'analyse qu'il développe : un palier ou un compte privé d'analyse n'y a pas accès.
  requireFeature('niche_analysis'),
  asyncRoute(async (req, res) => {
    const { document, created } = await startReportDocument(req.auth!, req.params.reportId, todayLabel(new Date()));
    res.status(created ? 202 : 200).json({ document });
  }),
);

reportsRouter.delete(
  '/:reportId',
  asyncRoute(async (req, res) => {
    await deleteReport(req.auth!, req.params.reportId);
    res.status(204).end();
  }),
);
