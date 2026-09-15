import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { isProd } from '@server/env';
import { authCookieOptions, clearAuthCookie, readCookie } from '@server/lib/cookies';
import { sha256 } from '@server/lib/crypto';
import { AppError, asyncRoute, countrySchema, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { loadAccount } from '@server/services/accounts';
import { accountView } from '@server/services/accounts/view';
import { clientInfo, recordAuthEvent } from '@server/services/audit';
import {
  attemptLogin,
  codeSchema,
  completeMfaLogin,
  consumePasswordToken,
  emailSchema,
  inspectPasswordToken,
  nameSchema,
  openSession,
  passwordInputSchema,
  registerUser,
  type OpenedSession,
} from '@server/services/auth';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  revokeSession,
  revokeUserSessions,
  setSessionCookie,
} from '@server/services/auth/sessions';

/**
 * Inscription, connexion, double authentification, déconnexion et liens de mot de
 * passe. Les réponses ne sont jamais mises en cache : elles portent un compte.
 */

export const authRouter = Router();

const MFA_COOKIE = isProd ? '__Host-sc_mfa' : 'sc_mfa';

authRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/** Ouvre la session dans le navigateur et renvoie le compte. L'ancienne session éventuelle est révoquée. */
async function respondWithSession(req: Request, res: Response, opened: OpenedSession, status = 200) {
  const previous = readCookie(req, SESSION_COOKIE);
  if (previous) await revokeSession(sha256(previous), 'replaced');

  setSessionCookie(res, opened.token, opened.expiresAt);
  const account = await loadAccount(opened.user.id);
  if (!account) throw new AppError(500, 'Compte introuvable après connexion.', 'ACCOUNT_MISSING');

  req.auth = { sessionId: opened.sessionId, mfaVerified: opened.mfaVerified, account };
  res.status(status).json({ account: await accountView(req.auth) });
}

const signupSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordInputSchema,
  /** Pays de l'utilisateur : il fixe la devise des prix affichés. */
  country: countrySchema.optional(),
});

authRouter.post(
  '/signup',
  routeLimiter(60, 10),
  validateBody(signupSchema),
  asyncRoute(async (req, res) => {
    const { name, email, password, country } = req.body as z.infer<typeof signupSchema>;
    const client = clientInfo(req);
    const user = await registerUser({ name, email, password, country, client });
    await respondWithSession(req, res, await openSession(user, false, client), 201);
  }),
);

const loginSchema = z.object({ email: emailSchema, password: passwordInputSchema });

authRouter.post(
  '/login',
  routeLimiter(15, 60),
  validateBody(loginSchema),
  asyncRoute(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const result = await attemptLogin({ email, password, client: clientInfo(req) });

    if (result.kind === 'mfa') {
      res.cookie(MFA_COOKIE, result.challengeToken, authCookieOptions(result.expiresAt.getTime() - Date.now()));
      res.json({ mfaRequired: true, expiresAt: result.expiresAt.toISOString(), methods: result.methods });
      return;
    }

    await respondWithSession(req, res, result);
  }),
);

authRouter.post(
  '/login/mfa',
  routeLimiter(15, 60),
  validateBody(z.object({ code: codeSchema })),
  asyncRoute(async (req, res) => {
    const challengeToken = readCookie(req, MFA_COOKIE);
    if (!challengeToken) {
      throw new AppError(401, 'La vérification a expiré. Reconnectez-vous avec votre mot de passe.', 'MFA_CHALLENGE_EXPIRED');
    }

    try {
      const opened = await completeMfaLogin({
        challengeToken,
        code: (req.body as { code: string }).code,
        client: clientInfo(req),
      });
      clearAuthCookie(res, MFA_COOKIE);
      await respondWithSession(req, res, opened);
    } catch (error) {
      if (error instanceof AppError && error.code === 'MFA_CHALLENGE_EXPIRED') clearAuthCookie(res, MFA_COOKIE);
      throw error;
    }
  }),
);

authRouter.post(
  '/logout',
  asyncRoute(async (req, res) => {
    if (req.auth) {
      await revokeSession(req.auth.sessionId, 'logout');
      await recordAuthEvent('logout', {
        userId: req.auth.account.user.id,
        email: req.auth.account.user.email,
        client: clientInfo(req),
      });
    }
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

authRouter.post(
  '/logout-all',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { user } = req.auth!.account;
    const count = await revokeUserSessions(user.id, { reason: 'logout_all' });
    await recordAuthEvent('logout_all', { userId: user.id, email: user.email, client: clientInfo(req), details: { sessions: count } });
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

/** Compte de la session courante ; `null` sans session (pas de 401 : ce n'est pas une erreur de ne pas être connecté). */
authRouter.get(
  '/me',
  asyncRoute(async (req, res) => {
    res.json({ account: req.auth ? await accountView(req.auth) : null });
  }),
);

const tokenSchema = z.object({ token: z.string().min(20).max(100) });

authRouter.post(
  '/password-token/inspect',
  routeLimiter(15, 30),
  validateBody(tokenSchema),
  asyncRoute(async (req, res) => {
    res.json(await inspectPasswordToken((req.body as z.infer<typeof tokenSchema>).token));
  }),
);

const consumeSchema = tokenSchema.extend({ password: passwordInputSchema });

authRouter.post(
  '/password-token/consume',
  routeLimiter(15, 20),
  validateBody(consumeSchema),
  asyncRoute(async (req, res) => {
    const { token, password } = req.body as z.infer<typeof consumeSchema>;
    await consumePasswordToken({ token, password, client: clientInfo(req) });
    clearSessionCookie(res);
    res.status(204).end();
  }),
);
