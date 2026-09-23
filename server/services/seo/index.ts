import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';

import { PUBLIC_PAGES, SITE_NAME, findPublicPage } from '@server/shared/publicPages';

/**
 * Référencement du site public : robots.txt, plan du site et balises de partage.
 *
 * Seules les pages publiques sont proposées aux moteurs de recherche. L'espace de
 * travail, l'API, les pages d'impression et les liens à usage unique en sont exclus :
 * ils n'ont rien à apporter à une recherche et ne doivent pas apparaître dans ses
 * résultats.
 */

const base = (appUrl: string) => appUrl.replace(/\/+$/, '');

export function robotsTxt(appUrl: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /app/',
    'Disallow: /api/',
    'Disallow: /imprimer/',
    'Disallow: /mot-de-passe',
    'Disallow: /verifier-email',
    '',
    `Sitemap: ${base(appUrl)}/sitemap.xml`,
    '',
  ].join('\n');
}

function escapeMarkup(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function sitemapXml(appUrl: string, lastModified: string): string {
  const urls = PUBLIC_PAGES.map(
    (page) =>
      `  <url><loc>${escapeMarkup(`${base(appUrl)}${page.path}`)}</loc><lastmod>${lastModified}</lastmod><changefreq>${page.changefreq}</changefreq><priority>${page.priority}</priority></url>`,
  );
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Page HTML servie selon l'adresse                                           */
/* -------------------------------------------------------------------------- */

/** Adresses de l'espace de travail et des liens personnels : servies, jamais indexées. */
const PRIVATE_PATHS = [/^\/app(\/|$)/, /^\/imprimer(\/|$)/, /^\/mot-de-passe(-oublie)?\/?$/, /^\/verifier-email\/?$/];

export type PathKind = 'public' | 'private' | 'unknown';

export function classifyPath(path: string): PathKind {
  if (findPublicPage(path)) return 'public';
  if (PRIVATE_PATHS.some((pattern) => pattern.test(path))) return 'private';
  return 'unknown';
}

const SEO_BLOCK = /<!--seo-->[\s\S]*?<!--\/seo-->/;

/**
 * index.html avec les balises de la page demandée. Les robots et les aperçus de liens
 * (messageries, réseaux sociaux) lisent ces balises sans exécuter le JavaScript.
 * Une adresse inconnue répond 404 : sinon chaque faute de frappe deviendrait une page
 * « trouvée » aux yeux des moteurs de recherche.
 */
export function renderIndexHtml(template: string, appUrl: string, path: string): { status: number; html: string; indexable: boolean } {
  const kind = classifyPath(path);
  const page = findPublicPage(path);
  const home = PUBLIC_PAGES[0]!;
  const url = base(appUrl);
  const title = page?.title ?? (kind === 'unknown' ? `Page introuvable · ${SITE_NAME}` : SITE_NAME);
  const description = page?.description ?? home.description;

  const tags = [
    `<title>${escapeMarkup(title)}</title>`,
    `<meta name="description" content="${escapeMarkup(description)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${escapeMarkup(title)}" />`,
    `<meta property="og:description" content="${escapeMarkup(description)}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:locale" content="fr_FR" />',
    `<meta property="og:image" content="${escapeMarkup(url)}/marque-smart-creator.jpg" />`,
    '<meta property="og:image:width" content="1222" />',
    '<meta property="og:image:height" content="864" />',
    '<meta property="og:image:alt" content="Smart Creator : lire le marché, produire le bon produit digital, le vendre." />',
    '<meta name="twitter:card" content="summary_large_image" />',
    page
      ? `<link rel="canonical" href="${escapeMarkup(url + page.path)}" /><meta property="og:url" content="${escapeMarkup(url + page.path)}" />`
      : '<meta name="robots" content="noindex, nofollow" />',
  ];

  const html = template.replace(SEO_BLOCK, `<!--seo-->\n    ${tags.join('\n    ')}\n    <!--/seo-->`).replaceAll('__APP_URL__', escapeMarkup(url));
  return { status: kind === 'unknown' ? 404 : 200, html, indexable: kind === 'public' };
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                     */
/* -------------------------------------------------------------------------- */

export function mountSeoRoutes(app: Express, appUrl: string, lastModified: string): void {
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600').send(robotsTxt(appUrl));
  });
  app.get('/sitemap.xml', (_req, res) => {
    res.type('application/xml').setHeader('Cache-Control', 'public, max-age=3600').send(sitemapXml(appUrl, lastModified));
  });
}

/**
 * Client construit (dist/client) : fichiers versionnés en cache long, index.html
 * réécrit pour chaque adresse. Le modèle brut n'est jamais servi tel quel.
 */
export function mountClient(
  app: Express,
  clientDir: string,
  appUrl: string,
  options: { serveStaticFiles?: boolean } = {},
): void {
  const templatePath = join(clientDir, 'index.html');
  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : null;
  const lastModified = (template ? statSync(templatePath).mtime : new Date()).toISOString().slice(0, 10);

  mountSeoRoutes(app, appUrl, lastModified);
  app.get('/index.html', (_req, res) => res.redirect(301, '/'));

  // Chez un hébergeur qui distribue lui-même les fichiers (Vercel), cette couche n'est
  // jamais atteinte : seul le HTML ci-dessous est rendu ici, pour ses balises par adresse.
  if (options.serveStaticFiles ?? true) {
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
  }

  app.get('*', (req, res, next) => {
    // Un fichier absent (ancien bundle, image supprimée) reste une vraie 404 :
    // lui renvoyer la page HTML masquerait l'erreur au navigateur.
    if (!template || req.path.startsWith('/api') || /\.[a-z0-9]+$/i.test(req.path)) return next();
    const { status, html, indexable } = renderIndexHtml(template, appUrl, req.path);
    res.status(status).setHeader('Cache-Control', 'no-cache');
    if (!indexable) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.type('html').send(html);
  });
}
