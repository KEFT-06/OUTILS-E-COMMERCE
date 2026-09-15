import { Router } from 'express';
import { asyncRoute } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { deleteReport, getReport, listReports } from '@server/services/analysis';

/** Rapports d'analyse du compte connecté : liste, lecture et suppression. */

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

reportsRouter.delete(
  '/:reportId',
  asyncRoute(async (req, res) => {
    await deleteReport(req.auth!, req.params.reportId);
    res.status(204).end();
  }),
);
