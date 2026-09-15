import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, routeLimiter, validateBody } from '@server/middleware';
import { recordVisit, visitSchema } from '@server/services/audience';
import { clientInfo } from '@server/services/audit';
import { type ContactInput, contactSchema, createContactMessage } from '@server/services/contact';

/** Routes ouvertes aux visiteurs : page Contact et mesure d'audience sans cookie. */

export const publicRouter = Router();

publicRouter.post(
  '/contact',
  routeLimiter(60, 5),
  validateBody(contactSchema),
  asyncRoute(async (req, res) => {
    await createContactMessage(req.body as ContactInput, req.auth);
    res.status(201).json({ message: 'Message envoyé : nous vous répondrons par e-mail.' });
  }),
);

publicRouter.post(
  '/audience/visit',
  routeLimiter(1, 60),
  validateBody(visitSchema),
  asyncRoute(async (req, res) => {
    const { path, referrer } = req.body as z.infer<typeof visitSchema>;
    const client = clientInfo(req);
    await recordVisit({
      path,
      referrer,
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      optOut: req.get('DNT') === '1' || req.get('Sec-GPC') === '1',
    });
    res.status(204).end();
  }),
);
