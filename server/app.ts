import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { env, isProd } from '@server/env';
import { apiLimiter, corsMiddleware, errorHandler, httpsRedirect, ipCeilingLimiter, notFoundHandler } from '@server/middleware';
import { api } from '@server/routes';
import { mountClient, mountSeoRoutes } from '@server/services/seo';

export interface CreateAppOptions {
  /**
   * Dossier du site construit. Par défaut `client/`, à côté du serveur construit
   * (`dist/server.js` + `dist/client/`). En hébergement sans serveur, le serveur est
   * empaqueté ailleurs que le site : le chemin est alors donné explicitement.
   */
  clientDir?: string;
  /**
   * Sert les fichiers du site (scripts, images, polices) depuis ce serveur. Faux quand
   * l'hébergeur les distribue lui-même par son réseau de diffusion : Vercel ignore de
   * toute façon `express.static`, et le HTML reste rendu ici pour garder ses balises
   * de référencement propres à chaque adresse.
   */
  serveStaticFiles?: boolean;
}

/**
 * Application Express, sans démarrage : le serveur (server/index.ts) l'écoute sur
 * un port, l'hébergement sans serveur (server/vercel.ts) l'appelle par requête, et
 * les tests l'interrogent directement.
 */
export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  /* ------------------------------------------------------------------------ */
  /*  Sécurité                                                                 */
  /* ------------------------------------------------------------------------ */

  // Express annonce sa présence par défaut ; c'est une information gratuite
  // offerte à un attaquant qui cherche des versions vulnérables.
  app.disable('x-powered-by');

  // Derrière un reverse proxy, la limitation de débit doit voir la vraie IP cliente et non
  // celle du proxy. Sans proxy, faire confiance à X-Forwarded-For laisserait chacun choisir
  // son adresse : en développement, seule la boucle locale (proxy de Vite) est crue.
  app.set('trust proxy', env.TRUST_PROXY ?? (isProd ? 1 : 'loopback'));

  // En production, jamais de page servie en clair : le protocole est lu derrière le proxy de l'hébergeur.
  if (isProd) app.use(httpsRedirect(env.APP_URL));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Pas de 'unsafe-inline' sur les scripts : c'est la directive qui
          // neutralise réellement le XSS injecté.
          scriptSrc: ["'self'"],
          // Tailwind injecte des styles au runtime ; inline reste nécessaire ici.
          styleSrc: ["'self'", "'unsafe-inline'"],
          // Polices servies par le site (paquets @fontsource), jamais par un serveur tiers.
          fontSrc: ["'self'", 'data:'],
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

  /* ------------------------------------------------------------------------ */
  /*  API                                                                      */
  /* ------------------------------------------------------------------------ */

  app.use('/api', ipCeilingLimiter, apiLimiter, api);

  /* ------------------------------------------------------------------------ */
  /*  Client statique en production                                            */
  /* ------------------------------------------------------------------------ */

  if (isProd) {
    const here = dirname(fileURLToPath(import.meta.url));
    mountClient(app, options.clientDir ?? join(here, 'client'), env.APP_URL, {
      serveStaticFiles: options.serveStaticFiles ?? true,
    });
  } else {
    mountSeoRoutes(app, env.APP_URL, new Date().toISOString().slice(0, 10));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
