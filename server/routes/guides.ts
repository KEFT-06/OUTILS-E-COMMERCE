import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { providers } from '@server/env';
import { AppError, aiLimiter, asyncRoute, providerUnavailable, validateBody } from '@server/middleware';
import { requireAuth, requireFeature, requirePermission } from '@server/middleware/auth';
import {
  coverRequestSchema,
  createCover,
  deleteCover,
  latestCover,
  refreshCover,
  sendCoverImage,
  type CoverRequest,
} from '@server/services/covers';
import {
  addTranslations,
  cancelReview,
  claimReview,
  completeReview,
  createGuide,
  deleteGuide,
  deleteTranslation,
  editTranslation,
  getGuide,
  getReview,
  guideInputSchema,
  listGuides,
  ownedGuide,
  releaseReview,
  requestReview,
  retranslate,
  reviewCompleteSchema,
  reviewRequestSchema,
  reviewerDashboard,
  reviewerLanguagesSchema,
  saveReview,
  setReviewerLanguages,
  translationEditSchema,
  translationRequestSchema,
  updateGuide,
  validateTranslation,
  type GuideInput,
  type TranslationEdit,
} from '@server/services/guides';

/** Guides multilingues, couvertures générées et réseau de relecteurs natifs. */

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

const requireTranslator: RequestHandler = (_req, _res, next) => {
  next(providers.gemini ? undefined : providerUnavailable('Gemini'));
};

/* -------------------------------------------------------------------------- */
/*  Guides                                                                     */
/* -------------------------------------------------------------------------- */

export const guidesRouter = Router();

guidesRouter.use(requireAuth, requireFeature('guide_translation'), noStore);

guidesRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json(await listGuides(req.auth!));
  }),
);

guidesRouter.post(
  '/',
  validateBody(guideInputSchema),
  asyncRoute(async (req, res) => {
    res.status(201).json({ guide: await createGuide(req.auth!, req.body as GuideInput) });
  }),
);

guidesRouter.get(
  '/:guideId',
  asyncRoute(async (req, res) => {
    res.json({ guide: await getGuide(req.auth!, req.params.guideId) });
  }),
);

guidesRouter.put(
  '/:guideId',
  validateBody(guideInputSchema),
  asyncRoute(async (req, res) => {
    res.json({ guide: await updateGuide(req.auth!, req.params.guideId, req.body as GuideInput) });
  }),
);

guidesRouter.delete(
  '/:guideId',
  asyncRoute(async (req, res) => {
    await deleteGuide(req.auth!, req.params.guideId);
    res.status(204).end();
  }),
);

guidesRouter.post(
  '/:guideId/translations',
  aiLimiter,
  requireTranslator,
  validateBody(translationRequestSchema),
  asyncRoute(async (req, res) => {
    const { languages } = req.body as z.infer<typeof translationRequestSchema>;
    res.json(await addTranslations(req.auth!, req.params.guideId, languages));
  }),
);

guidesRouter.post(
  '/:guideId/translations/:language/retranslate',
  aiLimiter,
  requireTranslator,
  asyncRoute(async (req, res) => {
    res.json({ guide: await retranslate(req.auth!, req.params.guideId, req.params.language) });
  }),
);

guidesRouter.put(
  '/:guideId/translations/:language',
  validateBody(translationEditSchema),
  asyncRoute(async (req, res) => {
    res.json({ guide: await editTranslation(req.auth!, req.params.guideId, req.params.language, req.body as TranslationEdit) });
  }),
);

guidesRouter.post(
  '/:guideId/translations/:language/validate',
  asyncRoute(async (req, res) => {
    res.json({ guide: await validateTranslation(req.auth!, req.params.guideId, req.params.language) });
  }),
);

guidesRouter.post(
  '/:guideId/translations/:language/review',
  requireFeature('native_review'),
  validateBody(reviewRequestSchema),
  asyncRoute(async (req, res) => {
    const { note } = req.body as z.infer<typeof reviewRequestSchema>;
    res.json({ guide: await requestReview(req.auth!, req.params.guideId, req.params.language, { note }) });
  }),
);

guidesRouter.post(
  '/:guideId/translations/:language/review/cancel',
  asyncRoute(async (req, res) => {
    res.json({ guide: await cancelReview(req.auth!, req.params.guideId, req.params.language) });
  }),
);

guidesRouter.delete(
  '/:guideId/translations/:language',
  asyncRoute(async (req, res) => {
    res.json({ guide: await deleteTranslation(req.auth!, req.params.guideId, req.params.language) });
  }),
);

/* -------------------------------------------------------------------------- */
/*  Couvertures                                                                */
/* -------------------------------------------------------------------------- */

export const coversRouter = Router();

coversRouter.use(requireAuth);

coversRouter.post(
  '/',
  requireFeature('image_generation'),
  aiLimiter,
  noStore,
  validateBody(coverRequestSchema),
  asyncRoute(async (req, res) => {
    const input = req.body as CoverRequest;
    if (input.subject === 'guide') await ownedGuide(req.auth!, input.subjectId);
    if (!providers.higgsfield) throw providerUnavailable('Higgsfield');
    res.status(202).json({ cover: await createCover(req.auth!, input) });
  }),
);

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

/** État d'une couverture ; le client sonde toutes les 5 secondes tant qu'elle est en cours. */
coversRouter.get(
  '/:coverId',
  noStore,
  asyncRoute(async (req, res) => {
    res.json({ cover: await refreshCover(req.auth!, req.params.coverId) });
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

/* -------------------------------------------------------------------------- */
/*  Relecteurs natifs                                                          */
/* -------------------------------------------------------------------------- */

export const reviewsRouter = Router();

reviewsRouter.use(requireAuth, requirePermission('guides.review'), noStore);

reviewsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json(await reviewerDashboard(req.auth!));
  }),
);

reviewsRouter.put(
  '/languages',
  validateBody(reviewerLanguagesSchema),
  asyncRoute(async (req, res) => {
    const { languages } = req.body as z.infer<typeof reviewerLanguagesSchema>;
    res.json(await setReviewerLanguages(req.auth!, languages));
  }),
);

reviewsRouter.post(
  '/:translationId/claim',
  asyncRoute(async (req, res) => {
    res.json({ review: await claimReview(req.auth!, req.params.translationId) });
  }),
);

reviewsRouter.get(
  '/:translationId',
  asyncRoute(async (req, res) => {
    res.json({ review: await getReview(req.auth!, req.params.translationId) });
  }),
);

reviewsRouter.put(
  '/:translationId',
  validateBody(translationEditSchema),
  asyncRoute(async (req, res) => {
    res.json({ review: await saveReview(req.auth!, req.params.translationId, req.body as TranslationEdit) });
  }),
);

reviewsRouter.post(
  '/:translationId/release',
  asyncRoute(async (req, res) => {
    await releaseReview(req.auth!, req.params.translationId);
    res.status(204).end();
  }),
);

reviewsRouter.post(
  '/:translationId/complete',
  validateBody(reviewCompleteSchema),
  asyncRoute(async (req, res) => {
    await completeReview(req.auth!, req.params.translationId, req.body as z.infer<typeof reviewCompleteSchema>);
    res.status(204).end();
  }),
);
