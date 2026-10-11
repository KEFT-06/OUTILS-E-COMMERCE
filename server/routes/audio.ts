import { Router } from 'express';
import { z } from 'zod';
import { AppError, aiLimiter, asyncRoute, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import { type AudioRequest, audioRequestSchema, audioSummary, createAudioTrack, deleteAudioTrack, listAudioTracks, sendAudioTrack } from '@server/services/audio';

/** Parcours audio : les modules d'un ouvrage lus à voix haute, à écouter et à télécharger en MP3 (services/audio). */

export const audioRouter = Router();

audioRouter.use(requireAuth);

/** Les ouvrages du compte qui ont un parcours audio, pour « Mes créations ». */
audioRouter.get(
  '/summary',
  asyncRoute(async (req, res) => {
    res.json({ subjects: await audioSummary(req.auth!) });
  }),
);

/** Les pistes d'un ouvrage, dans l'ordre de ses modules. */
audioRouter.get(
  '/tracks',
  asyncRoute(async (req, res) => {
    const subjectId = z.string().trim().min(1).max(100).safeParse(req.query.subjectId);
    if (!subjectId.success) throw new AppError(400, 'Ouvrage inconnu.', 'AUDIO_SUBJECT_INVALID');
    res.json({ tracks: await listAudioTracks(req.auth!, subjectId.data) });
  }),
);

/** Lit un module à voix haute. La lecture se fait dans la demande : une à deux minutes pour un module entier. */
audioRouter.post(
  '/tracks',
  requireFeature('ai_writing'),
  aiLimiter,
  validateBody(audioRequestSchema),
  asyncRoute(async (req, res) => {
    res.status(201).json({ track: await createAudioTrack(req.auth!, req.body as AudioRequest) });
  }),
);

audioRouter.get(
  '/tracks/:id/file',
  asyncRoute(async (req, res) => {
    await sendAudioTrack(req.auth!, req.params.id, res, req.query.download === '1');
  }),
);

audioRouter.delete(
  '/tracks/:id',
  asyncRoute(async (req, res) => {
    await deleteAudioTrack(req.auth!, req.params.id);
    res.status(204).end();
  }),
);
