import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z, type ZodType } from 'zod';
import { env, isProd } from '@server/env';

/* -------------------------------------------------------------------------- */
/*  Erreurs                                                                    */
/* -------------------------------------------------------------------------- */

export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** 503 explicite quand une clé de fournisseur manque — jamais un échec muet. */
export const providerUnavailable = (provider: string) =>
  new AppError(
    503,
    `Le fournisseur « ${provider} » n'est pas configuré sur ce serveur.`,
    'PROVIDER_NOT_CONFIGURED',
    { provider },
  );

/**
 * Gestionnaire d'erreurs terminal.
 * En production, ne divulgue ni pile d'appels ni message interne : ce sont des
 * informations exploitables par un attaquant.
 */
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  console.error('[erreur non gérée]', err);

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProd
        ? 'Une erreur interne est survenue.'
        : err instanceof Error
          ? err.message
          : String(err),
    },
  });
};

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route inconnue.' } });
};

/** Enveloppe un handler async : sans cela, un rejet de promesse échappe à Express 4. */
export const asyncRoute =
  <T extends RequestHandler>(handler: T): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };

/* -------------------------------------------------------------------------- */
/*  Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Valide le corps de requête contre un schéma zod et le REMPLACE par la version
 * analysée. Toute propriété non déclarée est écartée : une entrée non validée
 * qui atteint la logique métier est une faille, pas une commodité.
 */
export const validateBody =
  <T>(schema: ZodType<T>): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        new AppError(400, 'Requête invalide.', 'VALIDATION_ERROR', {
          issues: result.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        }),
      );
      return;
    }
    req.body = result.data;
    next();
  };

/* -------------------------------------------------------------------------- */
/*  Limitation de débit                                                        */
/* -------------------------------------------------------------------------- */

const limiterMessage = {
  error: {
    code: 'RATE_LIMITED',
    message: 'Trop de requêtes. Réessayez dans quelques instants.',
  },
};

/** Limite générale sur toute l'API. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limiterMessage,
});

/**
 * Limite resserrée sur les routes qui consomment des research points.
 * Une génération IA coûte de l'argent réel : la protéger n'est pas optionnel.
 */
export const aiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limiterMessage,
});

/* -------------------------------------------------------------------------- */
/*  CORS — liste blanche stricte                                               */
/* -------------------------------------------------------------------------- */

export const corsMiddleware: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;

  if (origin && env.CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(origin && env.CORS_ORIGINS.includes(origin) ? 204 : 403);
    return;
  }

  next();
};

/* -------------------------------------------------------------------------- */
/*  Schémas partagés                                                           */
/* -------------------------------------------------------------------------- */

/** Une requête de niche : bornée en longueur et nettoyée des caractères de contrôle. */
export const nicheQuerySchema = z
  .string()
  .trim()
  .min(2, 'La requête doit contenir au moins 2 caractères.')
  .max(200, 'La requête ne peut pas dépasser 200 caractères.')
  // Refus des caractères de contrôle (C0 et DEL). Vérifié par code de point
  // plutôt que par expression régulière : une regex contenant des caractères
  // de contrôle littéraux rend le fichier source illisible et fragile.
  .refine(
    (value) => {
      for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return false;
      }
      return true;
    },
    { message: 'Caractères de contrôle interdits.' },
  );

/** Les 15+ marchés d'Afrique francophone du cahier des charges, §6.1. */
export const marketSchema = z
  .enum([
    'CI', 'SN', 'CM', 'BJ', 'TG', 'BF', 'ML', 'NE', 'GN',
    'CD', 'CG', 'GA', 'TD', 'MG', 'MA', 'TN', 'DZ',
  ])
  .describe('Code ISO 3166-1 alpha-2 du marché analysé');
