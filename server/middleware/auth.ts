import type { RequestHandler } from 'express';
import { readCookie } from '@server/lib/cookies';
import { AppError, asyncRoute } from '@server/middleware';
import { loadAccount, type AccountSnapshot } from '@server/services/accounts';
import type { Permission } from '@server/services/auth/permissions';
import { SESSION_COOKIE, resolveSession, revokeSession } from '@server/services/auth/sessions';
import { FEATURES, type FeatureId } from '@server/services/plans';

/**
 * Authentification des requêtes.
 *
 * `authenticate` ne refuse rien : il attache le compte quand une session valide
 * est présentée. Ce sont `requireAuth`, `requirePermission` et `requireFeature`,
 * posés route par route, qui refusent.
 */

export interface RequestAuth {
  sessionId: string;
  mfaVerified: boolean;
  account: AccountSnapshot;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: RequestAuth;
    }
  }
}

export const authenticate: RequestHandler = asyncRoute(async (req, _res, next) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    const resolved = await resolveSession(token);
    if (resolved) {
      if (resolved.user.status !== 'active') {
        await revokeSession(resolved.session.id);
      } else {
        const account = await loadAccount(resolved.user.id);
        if (account) {
          req.auth = { sessionId: resolved.session.id, mfaVerified: resolved.session.mfaVerified, account };
        }
      }
    }
  }
  next();
});

const authRequired = () => new AppError(401, 'Connectez-vous pour continuer.', 'AUTH_REQUIRED');

export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.auth ? undefined : authRequired());
};

/** Un privilège d'administration exige un compte protégé par la double authentification, et une session qui l'a prouvée. */
function staffSessionProblem(auth: RequestAuth): AppError | null {
  if (!auth.account.user.twoFactorEnabledAt) {
    return new AppError(
      403,
      'Activez la double authentification dans Mon compte pour accéder à l’administration.',
      'TWO_FACTOR_REQUIRED',
    );
  }
  if (!auth.mfaVerified) {
    return new AppError(
      403,
      'Cette session n’a pas été ouverte avec votre code de double authentification : reconnectez-vous.',
      'TWO_FACTOR_SESSION_REQUIRED',
    );
  }
  return null;
}

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(authRequired());
    if (!auth.account.permissions.includes(permission)) {
      return next(new AppError(403, 'Votre compte ne détient pas ce privilège.', 'FORBIDDEN'));
    }
    next(staffSessionProblem(auth) ?? undefined);
  };
}

/** Au moins un privilège d'administration, dans une session protégée : accès aux métadonnées de l'administration. */
export const requireStaff: RequestHandler = (req, _res, next) => {
  const auth = req.auth;
  if (!auth) return next(authRequired());
  if (!auth.account.isStaff) {
    return next(new AppError(403, 'Espace réservé à l’équipe d’administration.', 'FORBIDDEN'));
  }
  next(staffSessionProblem(auth) ?? undefined);
};

/** Pouvoirs non délégables : changer un rôle, attribuer des privilèges. */
export const requireAdminRole: RequestHandler = (req, _res, next) => {
  const auth = req.auth;
  if (!auth) return next(authRequired());
  if (auth.account.user.role !== 'admin') {
    return next(new AppError(403, 'Action réservée aux administrateurs.', 'FORBIDDEN'));
  }
  next(staffSessionProblem(auth) ?? undefined);
};

export function requireFeature(feature: FeatureId): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(authRequired());
    if (!auth.account.features[feature]) {
      return next(
        new AppError(
          403,
          `« ${FEATURES[feature]} » n’est pas inclus dans votre palier ${auth.account.plan.label}. Passez à un palier supérieur ou contactez l’administrateur.`,
          'FEATURE_LOCKED',
          { feature },
        ),
      );
    }
    next();
  };
}
