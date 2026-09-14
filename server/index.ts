import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { env, isProd, listenHost, providers } from '@server/env';
import { apiLimiter, corsMiddleware, errorHandler, notFoundHandler } from '@server/middleware';
import { api } from '@server/routes';

const app = express();

/* -------------------------------------------------------------------------- */
/*  Sécurité                                                                   */
/* -------------------------------------------------------------------------- */

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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

/* -------------------------------------------------------------------------- */
/*  API                                                                        */
/* -------------------------------------------------------------------------- */

app.use('/api', apiLimiter, api);

/* -------------------------------------------------------------------------- */
/*  Client statique en production                                              */
/* -------------------------------------------------------------------------- */

if (isProd) {
  const here = dirname(fileURLToPath(import.meta.url));
  const clientDir = join(here, 'client');

  app.use(
    express.static(clientDir, {
      maxAge: '1y',
      index: false,
      setHeaders(res, path) {
        // Le HTML ne doit jamais être mis en cache longtemps : c'est lui qui
        // référence les bundles versionnés.
        if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(clientDir, 'index.html'));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

/* -------------------------------------------------------------------------- */
/*  Démarrage                                                                  */
/* -------------------------------------------------------------------------- */

const server = app.listen(env.PORT, listenHost, () => {
  const configured = Object.entries(providers)
    .filter(([, ok]) => ok)
    .map(([name]) => name);

  console.log(`\n  Smart Creator — API sur http://${listenHost}:${env.PORT}`);
  console.log(`  Environnement : ${env.NODE_ENV}`);
  console.log(
    `  Fournisseurs configurés : ${configured.length > 0 ? configured.join(', ') : 'aucun'}`,
  );
  if (configured.length === 0) {
    console.log('  → Les routes de génération répondront 503 tant qu’aucune clé n’est fournie.');
  }
  console.log('');
});

// Arrêt propre : sans cela, un déploiement coupe les requêtes en cours.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`\n  ${signal} reçu, arrêt en cours…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
