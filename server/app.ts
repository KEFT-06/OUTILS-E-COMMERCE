import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { env, isProd } from '@server/env';
import { apiLimiter, corsMiddleware, errorHandler, notFoundHandler } from '@server/middleware';
import { api } from '@server/routes';
import { mountClient, mountSeoRoutes } from '@server/services/seo';

/**
 * Application Express, sans démarrage : le serveur (server/index.ts) l'écoute sur
 * un port, les tests l'interrogent directement.
 */
export function createApp() {
  const app = express();

  /* ------------------------------------------------------------------------ */
  /*  Sécurité                                                                 */
  /* ------------------------------------------------------------------------ */

  // Express annonce sa présence par défaut ; c'est une information gratuite
  // offerte à un attaquant qui cherche des versions vulnérables.
  app.disable('x-powered-by');

  // Nécessaire derrière un reverse proxy pour que la limitation de débit voie
  // la vraie IP cliente et non celle du proxy.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Pas de 'unsafe-inline' sur les scripts : c'est la directive qui
          // neutralise réellement le XSS injecté.
          scriptSrc: ["'self'"],
          // Tailwind injecte des styles au runtime ; inline reste nécessaire ici.
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'blob:', 'https:'],
          connectSrc: ["'self'", ...env.CORS_ORIGINS],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );

  app.use(corsMiddleware);
  app.use(compression());

  // Plafond de charge utile : sans limite, un corps de requête volumineux
  // suffit à saturer la mémoire du processus.
  // Exception unique : les brouillons de produits entièrement rédigés, jusqu'à 4 Mo.
  const workspaceJson = express.json({ limit: '5mb' });
  const defaultJson = express.json({ limit: '1mb' });
  // Webhook Stripe : corps brut, la signature porte sur les octets exacts reçus.
  const webhookBody = express.raw({ type: 'application/json', limit: '1mb' });
  app.use((req, res, next) =>
    (req.path === '/api/billing/webhook' ? webhookBody : req.path.startsWith('/api/workspace/') ? workspaceJson : defaultJson)(req, res, next),
  );
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  /* ------------------------------------------------------------------------ */
  /*  API                                                                      */
  /* ------------------------------------------------------------------------ */

  app.use('/api', apiLimiter, api);

  /* ------------------------------------------------------------------------ */
  /*  Client statique en production                                            */
  /* ------------------------------------------------------------------------ */

  if (isProd) {
    const here = dirname(fileURLToPath(import.meta.url));
    mountClient(app, join(here, 'client'), env.APP_URL);
  } else {
    mountSeoRoutes(app, env.APP_URL, new Date().toISOString().slice(0, 10));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
