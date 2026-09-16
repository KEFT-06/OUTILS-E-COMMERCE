import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z, type ZodType } from 'zod';
import { env, isProd } from '@server/env';
import { SESSION_COOKIE, readCookie } from '@server/lib/cookies';
import { isCountryCode } from '@server/shared/countries';

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
  // Erreurs de lecture du corps de la requête : réponses claires plutôt qu'une erreur interne.
  const bodyError = typeof err === 'object' && err !== null ? (err as { type?: unknown }).type : undefined;
  if (bodyError === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Envoi trop volumineux.' } });
    return;
  }
  if (bodyError === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Requête illisible.' } });
    return;
  }

  if (err instanceof AppError) {
    const retryAfter = (err.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
    if (typeof retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter));
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

/**
 * Les limiteurs en mémoire sont des filets de sécurité par adresse IP. Ils sont
 * coupés pendant les tests automatisés, qui enchaînent des centaines de requêtes
 * depuis la même adresse ; la protection des connexions, elle, vit en base et
 * reste testée (server/services/auth/throttle.ts).
 */
const skipDuringTests = () => env.NODE_ENV === 'test';

/** Limiteur de route : `limit` requêtes par adresse IP sur `windowMinutes` minutes. */
export function routeLimiter(windowMinutes: number, limit: number) {
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: skipDuringTests,
    message: limiterMessage,
  });
}

/**
 * Limite générale sur toute l'API, comptée par session pour un visiteur connecté et par adresse
 * IP sinon. Les opérateurs mobiles font souvent partager une même adresse IP publique à de
 * nombreux abonnés : comptée par adresse, la limite atteinte par l'un bloquerait ses voisins.
 */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  keyGenerator: (req) => {
    const session = readCookie(req, SESSION_COOKIE);
    return session ? `session:${createHash('sha256').update(session).digest('hex')}` : `ip:${req.ip}`;
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipDuringTests,
  message: limiterMessage,
});

/**
 * Plafond par adresse IP, large pour les réseaux partagés : il borne ce qu'obtiendrait un poste
 * qui changerait de cookie de session à chaque requête pour échapper à la limite générale.
 */
export const ipCeilingLimiter = rateLimit({
  windowMs: 60_000,
  limit: 1_200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipDuringTests,
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
  skip: skipDuringTests,
  message: limiterMessage,
});

/* -------------------------------------------------------------------------- */
/*  HTTPS obligatoire                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Redirige toute requête arrivée en HTTP vers la même page en HTTPS. L'en-tête HSTS ne protège
 * qu'à partir de la deuxième visite : la toute première doit aussi basculer en HTTPS.
 *
 * - La destination est bâtie sur l'adresse publique (APP_URL), jamais sur l'en-tête Host envoyé
 *   par le visiteur : sinon n'importe qui fabriquerait un lien qui redirige vers son propre site.
 * - 308 garde la méthode et le corps (un POST reste un POST).
 * - La sonde de santé de l'hébergeur, souvent en HTTP interne, n'est pas redirigée.
 * - Sans adresse publique en https (essai local de la version de production), rien ne change.
 */
export function httpsRedirect(appUrl: string): RequestHandler {
  const publicUrl = new URL(appUrl);
  return (req, res, next) => {
    if (publicUrl.protocol !== 'https:' || req.secure || req.path === '/api/health') {
      next();
      return;
    }
    res.redirect(308, `https://${publicUrl.host}${req.originalUrl}`);
  };
}

/* -------------------------------------------------------------------------- */
/*  CORS — liste blanche stricte                                               */
/* -------------------------------------------------------------------------- */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const corsMiddleware: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  const allowed = Boolean(origin && env.CORS_ORIGINS.includes(origin));

  // Garde anti-CSRF : un formulaire posté depuis un site tiers part sans
  // pré-vérification CORS, et express.urlencoded l'analyserait. Sans ce refus,
  // une page piégée ouverte dans le navigateur pourrait lancer une génération
  // payée. Les appels sans en-tête Origin (serveur à serveur) ne sont pas visés.
  if (
    origin &&
    !allowed &&
    !SAFE_METHODS.has(req.method) &&
    origin !== `${req.protocol}://${req.get('host')}`
  ) {
    res.status(403).json({ error: { code: 'ORIGIN_REFUSED', message: 'Origine non autorisée.' } });
    return;
  }

  if (origin && allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
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
/** Pays au format ISO 3166-1 alpha-2 : tous les pays, l'outil est international. */
export const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCountryCode, 'Pays inconnu : code ISO 3166-1 alpha-2 attendu (ex. CM).');

export const marketSchema = countrySchema.describe('Code ISO 3166-1 alpha-2 du marché analysé');
