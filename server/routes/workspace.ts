import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { parseWorkspaceKind, readWorkspaceDocument, saveWorkspaceDocument } from '@server/services/workspace';

/** Brouillons de l'espace de travail du compte connecté. */

export const workspaceRouter = Router();

workspaceRouter.use(requireAuth, (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

workspaceRouter.get(
  '/:kind',
  asyncRoute(async (req, res) => {
    res.json(await readWorkspaceDocument(req.auth!.account.user.id, parseWorkspaceKind(req.params.kind)));
  }),
);

const saveSchema = z.object({ data: z.unknown() });

/** Les écrans enregistrent quelques instants après chaque modification : limite large, mais bornée. */
workspaceRouter.put(
  '/:kind',
  routeLimiter(1, 120),
  validateBody(saveSchema),
  asyncRoute(async (req, res) => {
    const kind = parseWorkspaceKind(req.params.kind);
    const { data } = req.body as z.infer<typeof saveSchema>;
    res.json(await saveWorkspaceDocument(req.auth!.account.user.id, kind, data));
  }),
);
