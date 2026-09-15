import { Router, type Request } from 'express';
import { and, desc, eq, gt, like } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { creditTransactions, sessions, users } from '@server/db/schema';
import { describeDevice, maskIp } from '@server/lib/device';
import { AppError, asyncRoute, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { creditSummary, loadAccount } from '@server/services/accounts';
import { accountView } from '@server/services/accounts/view';
import { clientInfo } from '@server/services/audit';
import {
  beginTotpEnrollment,
  changePassword,
  codeSchema,
  confirmTotpEnrollment,
  disableTotp,
  nameSchema,
  passwordInputSchema,
  regenerateRecoveryCodes,
} from '@server/services/auth';
import {
  ONLINE_WINDOW_MS,
  clearSessionCookie,
  revokeSession,
  revokeUserSessions,
} from '@server/services/auth/sessions';
import { recordClientExport } from '@server/services/generations';
import { chariowKeySchema, removeChariowKey, saveChariowKey } from '@server/services/integrations';

/** Espace personnel : profil, mot de passe, sessions, double authentification, crédits et clés API. */

export const accountRouter = Router();

accountRouter.use(requireAuth, (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/** Recharge le compte après une modification, pour renvoyer l'état réel. */
async function refreshAuth(req: Request): Promise<void> {
  const account = await loadAccount(req.auth!.account.user.id);
  if (account) req.auth = { ...req.auth!, account };
}

const profileSchema = z
  .object({
    name: nameSchema.optional(),
    savedNiches: z.array(z.string().trim().min(2).max(200)).max(50).optional(),
  })
  .refine((value) => value.name !== undefined || value.savedNiches !== undefined, { message: 'Rien à modifier.' });

accountRouter.patch(
  '/profile',
  validateBody(profileSchema),
  asyncRoute(async (req, res) => {
    const { name, savedNiches } = req.body as z.infer<typeof profileSchema>;
    await getDb()
      .update(users)
      .set({
        ...(name ? { name } : {}),
        ...(savedNiches ? { savedNiches: [...new Set(savedNiches)] } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, req.auth!.account.user.id));
    await refreshAuth(req);
    res.json({ account: await accountView(req.auth!) });
  }),
);

const passwordChangeSchema = z.object({ currentPassword: passwordInputSchema, newPassword: passwordInputSchema });

accountRouter.post(
  '/password',
  routeLimiter(15, 10),
  validateBody(passwordChangeSchema),
  asyncRoute(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof passwordChangeSchema>;
    const auth = req.auth!;
    await changePassword(auth.account.user, {
      currentPassword,
      newPassword,
      sessionId: auth.sessionId,
      client: clientInfo(req),
    });
    res.status(204).end();
  }),
);

/* -------------------------------------------------------------------------- */
/*  Sessions                                                                   */
/* -------------------------------------------------------------------------- */

/** Un préfixe de 64 bits de l'empreinte suffit à désigner une session sans exposer l'empreinte entière. */
const sessionHandle = (sessionId: string) => sessionId.slice(0, 16);

accountRouter.get(
  '/sessions',
  asyncRoute(async (req, res) => {
    const auth = req.auth!;
    const now = new Date();
    const rows = await getDb()
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, auth.account.user.id), gt(sessions.expiresAt, now)))
      .orderBy(desc(sessions.lastSeenAt));

    res.json({
      sessions: rows.map((session) => ({
        id: sessionHandle(session.id),
        current: session.id === auth.sessionId,
        device: describeDevice(session.userAgent),
        ip: maskIp(session.ipAddress),
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        online: now.getTime() - session.lastSeenAt.getTime() <= ONLINE_WINDOW_MS,
      })),
    });
  }),
);

accountRouter.post(
  '/sessions/revoke-others',
  asyncRoute(async (req, res) => {
    const auth = req.auth!;
    const revoked = await revokeUserSessions(auth.account.user.id, { exceptSessionId: auth.sessionId });
    res.json({ revoked });
  }),
);

accountRouter.post(
  '/sessions/:sessionId/revoke',
  asyncRoute(async (req, res) => {
    const handle = z.string().regex(/^[0-9a-f]{16}$/).safeParse(req.params.sessionId);
    if (!handle.success) throw new AppError(400, 'Identifiant de session invalide.', 'INVALID_SESSION_ID');

    const auth = req.auth!;
    const [target] = await getDb()
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.userId, auth.account.user.id), like(sessions.id, `${handle.data}%`)))
      .limit(1);
    if (!target) throw new AppError(404, 'Session introuvable.', 'SESSION_NOT_FOUND');

    await revokeSession(target.id);
    if (target.id === auth.sessionId) clearSessionCookie(res);
    res.status(204).end();
  }),
);

/* -------------------------------------------------------------------------- */
/*  Double authentification                                                    */
/* -------------------------------------------------------------------------- */

accountRouter.post(
  '/two-factor/setup',
  routeLimiter(15, 10),
  asyncRoute(async (req, res) => {
    res.json(await beginTotpEnrollment(req.auth!.account.user));
  }),
);

const codeBody = z.object({ code: codeSchema });

accountRouter.post(
  '/two-factor/enable',
  routeLimiter(15, 20),
  validateBody(codeBody),
  asyncRoute(async (req, res) => {
    const auth = req.auth!;
    const recoveryCodes = await confirmTotpEnrollment(
      auth.account.user,
      (req.body as z.infer<typeof codeBody>).code,
      auth.sessionId,
      clientInfo(req),
    );
    await refreshAuth(req);
    req.auth = { ...req.auth!, mfaVerified: true };
    res.json({ recoveryCodes, account: await accountView(req.auth) });
  }),
);

const disableSchema = z.object({ password: passwordInputSchema, code: codeSchema });

accountRouter.post(
  '/two-factor/disable',
  routeLimiter(15, 10),
  validateBody(disableSchema),
  asyncRoute(async (req, res) => {
    const auth = req.auth!;
    const { password, code } = req.body as z.infer<typeof disableSchema>;
    await disableTotp(auth.account.user, { password, code, isStaff: auth.account.isStaff, client: clientInfo(req) });
    await refreshAuth(req);
    res.json({ account: await accountView(req.auth!) });
  }),
);

accountRouter.post(
  '/two-factor/recovery-codes',
  routeLimiter(15, 10),
  validateBody(codeBody),
  asyncRoute(async (req, res) => {
    const recoveryCodes = await regenerateRecoveryCodes(
      req.auth!.account.user,
      (req.body as z.infer<typeof codeBody>).code,
      clientInfo(req),
    );
    res.json({ recoveryCodes });
  }),
);

/* -------------------------------------------------------------------------- */
/*  Crédits, exports et clés API                                               */
/* -------------------------------------------------------------------------- */

accountRouter.get(
  '/credits',
  asyncRoute(async (req, res) => {
    const auth = req.auth!;
    const rows = await getDb()
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, auth.account.user.id))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(50);

    res.json({
      credits: creditSummary(auth.account),
      entries: rows.map((entry) => ({
        id: entry.id,
        reason: entry.reason,
        actionId: entry.actionId,
        delta: entry.planDelta + entry.bonusDelta,
        balanceAfter: entry.balanceAfter,
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      })),
    });
  }),
);

const exportSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ebook'), format: z.enum(['pdf', 'docx']) }),
  z.object({ kind: z.literal('product_page'), format: z.literal('html') }),
  z.object({ kind: z.literal('report_pdf'), format: z.literal('pdf') }),
  z.object({ kind: z.literal('swipe_file'), format: z.enum(['csv', 'pdf']) }),
  z.object({ kind: z.literal('launch_kit'), format: z.literal('txt') }),
]);

/** Déclaration d'un export fait dans le navigateur, pour les statistiques de contenus. */
accountRouter.post(
  '/exports',
  routeLimiter(1, 30),
  validateBody(exportSchema),
  asyncRoute(async (req, res) => {
    const { kind, format } = req.body as z.infer<typeof exportSchema>;
    await recordClientExport(req.auth!, kind, format);
    res.status(204).end();
  }),
);

const chariowKeyBody = z.object({ apiKey: chariowKeySchema });

accountRouter.put(
  '/integrations/chariow',
  routeLimiter(15, 10),
  validateBody(chariowKeyBody),
  asyncRoute(async (req, res) => {
    const { apiKey } = req.body as z.infer<typeof chariowKeyBody>;
    res.json({ integrations: await saveChariowKey(req.auth!, apiKey, clientInfo(req)) });
  }),
);

accountRouter.delete(
  '/integrations/chariow',
  asyncRoute(async (req, res) => {
    res.json({ integrations: await removeChariowKey(req.auth!, clientInfo(req)) });
  }),
);
