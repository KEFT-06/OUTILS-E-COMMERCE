import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError, asyncRoute } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { deleteCover, latestCover, listCovers, sendCoverImage } from '@server/services/covers';
import { getGuide, listGuides } from '@server/services/guides';

/**
 * Guides et couvertures DÉJÀ créés.
 *
 * Le module des guides multilingues (écriture, traduction, relecture native) et la génération de
 * couvertures sont retirés du site le 28/10/2026 (décision du propriétaire). Ce qui existe reste à
 * son auteur : ses guides se lisent et s'impriment en PDF depuis « Mes créations », ses couvertures
 * ouvrent toujours les exports de ses ouvrages. Aucune route ne crée, ne traduit ni ne relit plus.
 */

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/* -------------------------------------------------------------------------- */
/*  Guides                                                                     */
/* -------------------------------------------------------------------------- */

export const guidesRouter = Router();

guidesRouter.use(requireAuth, noStore);

guidesRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json(await listGuides(req.auth!));
  }),
);

guidesRouter.get(
  '/:guideId',
  asyncRoute(async (req, res) => {
    res.json({ guide: await getGuide(req.auth!, req.params.guideId) });
  }),
);

/* -------------------------------------------------------------------------- */
/*  Couvertures                                                                */
/* -------------------------------------------------------------------------- */

export const coversRouter = Router();

coversRouter.use(requireAuth);

const coverSubjectQuery = z.object({
  subject: z.enum(['guide', 'product']),
  subjectId: z.string().trim().min(1).max(100),
});

coversRouter.get(
  '/',
  noStore,
  asyncRoute(async (req, res) => {
    const query = coverSubjectQuery.safeParse(req.query);
    if (!query.success) throw new AppError(400, 'Sujet de couverture invalide.', 'VALIDATION_ERROR');
    res.json({ cover: await latestCover(req.auth!, query.data.subject, query.data.subjectId) });
  }),
);

/** Toutes les couvertures prêtes du compte pour un type de sujet : une lecture pour toutes les cartes. */
coversRouter.get(
  '/mine',
  noStore,
  asyncRoute(async (req, res) => {
    const subject = z.enum(['guide', 'product']).safeParse(req.query.subject);
    if (!subject.success) throw new AppError(400, 'Sujet de couverture invalide.', 'VALIDATION_ERROR');
    res.json({ covers: await listCovers(req.auth!, subject.data) });
  }),
);

coversRouter.get(
  '/:coverId/image',
  asyncRoute(async (req, res) => {
    await sendCoverImage(req.auth!, req.params.coverId, res);
  }),
);

coversRouter.delete(
  '/:coverId',
  asyncRoute(async (req, res) => {
    await deleteCover(req.auth!, req.params.coverId);
    res.status(204).end();
  }),
);
