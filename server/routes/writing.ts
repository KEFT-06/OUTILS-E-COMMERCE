import express, { Router, type Request } from 'express';
import { AppError, aiLimiter, asyncRoute, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import {
  VIDEO_FILE_MAX_BYTES,
  VIDEO_MIME_TYPES,
  videoLinkSchema,
  videoToProduct,
  youtubeWatchUrl,
} from '@server/services/writing/video';
import {
  type LaunchKitWritingRequest,
  type ProductWritingRequest,
  launchKitWritingSchema,
  productWritingSchema,
  writeLaunchKit,
  writeProduct,
} from '@server/services/writing';
import {
  type EbookRequest,
  ebookRequestSchema,
  cancelEbook,
  getActiveEbookJob,
  getEbookJob,
  getEbookResult,
  startEbook,
} from '@server/services/writing/ebookJobs';
import { type MarketReportRequest, marketReportRequestSchema, startMarketReport } from '@server/services/writing/marketReport';

/** Rédaction par l'IA : modules d'un produit et textes du kit de lancement. Facturée, points rendus en cas d'échec. */

export const writingRouter = Router();

writingRouter.post(
  '/product',
  requireAuth,
  requireFeature('ai_writing'),
  aiLimiter,
  validateBody(productWritingSchema),
  asyncRoute(async (req, res) => {
    res.json(await writeProduct(req.auth!, req.body as ProductWritingRequest));
  }),
);

/* -------------------------------------------------------------------------- */
/*  Ebook long : plan détaillé puis rédaction par tranches                     */
/* -------------------------------------------------------------------------- */

/**
 * La rédaction ne tient pas dans une requête : le lancement répond tout de suite, et le
 * suivi ci-dessous renvoie l'avancement — c'est lui aussi qui relance la tranche suivante.
 */
writingRouter.post(
  '/ebook',
  requireAuth,
  requireFeature('ai_writing'),
  aiLimiter,
  validateBody(ebookRequestSchema),
  asyncRoute(async (req, res) => {
    const { job, created } = await startEbook(req.auth!, req.body as EbookRequest);
    res.status(created ? 202 : 200).json({ job });
  }),
);

/**
 * Dossier stratégique : développe une analyse de niche déjà enregistrée. Les faits sont
 * relus sur le serveur depuis le rapport, jamais repris de la requête.
 */
writingRouter.post(
  '/market-report',
  requireAuth,
  requireFeature('ai_writing'),
  aiLimiter,
  validateBody(marketReportRequestSchema),
  asyncRoute(async (req, res) => {
    const { job, created } = await startMarketReport(req.auth!, req.body as MarketReportRequest);
    res.status(created ? 202 : 200).json({ job });
  }),
);

writingRouter.get(
  '/ebook/active',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({ job: await getActiveEbookJob(req.auth!) });
  }),
);

writingRouter.get(
  '/ebook/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({ job: await getEbookJob(req.auth!, req.params.id) });
  }),
);

/** Renoncer à une rédaction en cours : points rendus, le compte est libéré tout de suite. */
writingRouter.delete(
  '/ebook/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({ job: await cancelEbook(req.auth!, req.params.id) });
  }),
);

writingRouter.get(
  '/ebook/:id/result',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json(await getEbookResult(req.auth!, req.params.id!));
  }),
);

/* -------------------------------------------------------------------------- */
/*  Vidéo → Produit                                                            */
/* -------------------------------------------------------------------------- */

writingRouter.post(
  '/video-link',
  requireAuth,
  requireFeature('ai_writing'),
  aiLimiter,
  validateBody(videoLinkSchema),
  asyncRoute(async (req, res) => {
    const url = youtubeWatchUrl((req.body as { url: string }).url);
    if (!url) {
      throw new AppError(400, 'Collez le lien d’une vidéo YouTube publique (https://www.youtube.com/watch?v=…).', 'VIDEO_LINK_INVALID');
    }
    res.json(await videoToProduct(req.auth!, { kind: 'youtube', url }));
  }),
);

const mediaTypeOf = (req: Request) => String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();

/** Corps brut, lu seulement pour un compte connecté et un type vidéo ou audio, 14 Mo au plus. */
const videoBody = express.raw({ type: (req) => VIDEO_MIME_TYPES.includes(mediaTypeOf(req as Request)), limit: VIDEO_FILE_MAX_BYTES });

function fileNameOf(req: Request): string {
  try {
    return decodeURIComponent(String(req.headers['x-file-name'] ?? ''))
      .replace(/\p{Cc}/gu, '')
      .trim()
      .slice(0, 120);
  } catch {
    return '';
  }
}

writingRouter.post(
  '/video-file',
  requireAuth,
  requireFeature('ai_writing'),
  aiLimiter,
  videoBody,
  asyncRoute(async (req, res) => {
    const mimeType = mediaTypeOf(req);
    if (!VIDEO_MIME_TYPES.includes(mimeType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError(415, 'Envoyez un fichier vidéo ou audio (MP4, MOV, WebM, MP3, M4A, WAV…).', 'VIDEO_TYPE_UNSUPPORTED');
    }
    res.json(await videoToProduct(req.auth!, { kind: 'file', mimeType, data: req.body, fileName: fileNameOf(req) }));
  }),
);

writingRouter.post(
  '/launch-kit',
  requireAuth,
  requireFeature('ai_writing'),
  aiLimiter,
  validateBody(launchKitWritingSchema),
  asyncRoute(async (req, res) => {
    res.json(await writeLaunchKit(req.auth!, req.body as LaunchKitWritingRequest));
  }),
);
