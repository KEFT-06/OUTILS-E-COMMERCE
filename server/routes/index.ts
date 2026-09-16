import { Router } from 'express';
import { authenticate } from '@server/middleware/auth';
import { accountRouter } from '@server/routes/account';
import { adminRouter } from '@server/routes/admin';
import { analysisRouter } from '@server/routes/analysis';
import { authRouter } from '@server/routes/auth';
import { billingRouter } from '@server/routes/billing';
import { catalogRouter } from '@server/routes/catalog';
import { checksRouter } from '@server/routes/checks';
import { creativesRouter } from '@server/routes/creatives';
import { coversRouter, guidesRouter, reviewsRouter } from '@server/routes/guides';
import { affiliationRouter, marketplacesRouter } from '@server/routes/marketplaces';
import { publicRouter } from '@server/routes/public';
import { reportsRouter } from '@server/routes/reports';
import { storybookRouter } from '@server/routes/storybook';
import { workspaceRouter } from '@server/routes/workspace';
import { writingRouter } from '@server/routes/writing';

/**
 * API de Smart Creator, montée sur /api. Chaque domaine a son fichier de routes ;
 * les contrôles d'accès (compte, palier, droits d'administration) se font route par route.
 */

export const api = Router();

// Attache le compte de la session à chaque requête ; les refus se font route par route.
api.use(authenticate);

// Aucune réponse de l'API n'est gardée en cache par le navigateur ou un proxy : comptes,
// ventes, affiliés. Les fichiers qui peuvent l'être le précisent eux-mêmes.
api.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

api.use('/auth', authRouter);
api.use('/account', accountRouter);
api.use('/admin', adminRouter);
api.use('/billing', billingRouter);
api.use('/reports', reportsRouter);
api.use('/workspace', workspaceRouter);
api.use('/writing', writingRouter);
api.use('/guides', guidesRouter);
api.use('/covers', coversRouter);
api.use('/reviews', reviewsRouter);
api.use('/storybook', storybookRouter);
api.use('/creatives', creativesRouter);
api.use('/marketplaces', marketplacesRouter);
api.use('/affiliation/chariow', affiliationRouter);
api.use(analysisRouter);
api.use(checksRouter);
api.use(catalogRouter);
api.use(publicRouter);
