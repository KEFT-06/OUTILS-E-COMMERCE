import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';

import { LANDING_COMMITMENTS, LANDING_FAQ, LANDING_GROUPS, LANDING_HERO } from '@server/shared/landingContent';
import { PUBLIC_PAGES, SITE_NAME, type PublicPage, findPublicPage } from '@server/shared/publicPages';

/**
 * Référencement du site public : robots.txt, plan du site, balises, données structurées et
 * contenu lisible sans JavaScript.
 *
 * Seules les pages publiques sont proposées aux moteurs de recherche. L'espace de
 * travail, l'API, les pages d'impression et les liens à usage unique en sont exclus :
 * ils n'ont rien à apporter à une recherche et ne doivent pas apparaître dans ses
 * résultats.
 *
 * Constaté le 04/10/2026, le site étant introuvable sur un moteur de recherche même en tapant
 * son adresse :
 *  · le plan du site datait toutes les pages du 20 octobre 2018 — la date des fichiers chez
 *    l'hébergeur, pas celle de la mise en ligne : un moteur en concluait que rien n'avait changé
 *    depuis des années ;
 *  · le corps de la page était vide sans JavaScript : un moteur qui ne l'exécute pas ne lisait
 *    que le titre ;
 *  · rien ne signalait le site aux moteurs, et aucune balise ne permettait au propriétaire de
 *    le faire valider dans leurs outils.
 */

/** Date de construction, inscrite par l'assemblage du serveur (server/scripts/build-serverless.mjs). */
declare const __BUILD_DATE__: string | undefined;
const BUILD_DATE = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : null;

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

/**
 * Date à annoncer aux moteurs : celle de la construction quand elle est connue. La date du
 * fichier ne vaut que si elle est plausible — chez un hébergeur sans serveur, les fichiers
 * portent une date fixe, vieille de plusieurs années.
 */
export function lastModifiedOf(fileDate: Date | null, now = new Date()): string {
  if (BUILD_DATE) return BUILD_DATE;
  const plausible = fileDate && fileDate.getTime() > now.getTime() - 365 * 86_400_000 && fileDate.getTime() <= now.getTime();
  return (plausible ? fileDate : now).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/*  Données structurées                                                        */
/* -------------------------------------------------------------------------- */

/** JSON posé dans la page : un « < » y est écrit en échappement, pour ne jamais fermer la balise. */
const jsonForHtml = (value: unknown) => JSON.stringify(value).replace(/</g, () => `${String.fromCharCode(92)}u003c`);

export function structuredData(page: PublicPage, appUrl: string): Record<string, unknown>[] {
  const url = base(appUrl);
  const site = { '@type': 'WebSite', name: SITE_NAME, url: `${url}/`, inLanguage: 'fr', description: PUBLIC_PAGES[0]!.description };
  if (page.path !== '/') {
    return [{ '@context': 'https://schema.org', '@type': 'WebPage', name: page.title, description: page.description, url: `${url}${page.path}`, inLanguage: 'fr', isPartOf: site }];
  }
  return [
    { '@context': 'https://schema.org', ...site },
    { '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: `${url}/`, logo: `${url}/icon-512.png` },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      url: `${url}/`,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'fr',
      description: LANDING_HERO.intro,
      featureList: LANDING_GROUPS.flatMap((group) => [...group.features]),
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', description: LANDING_HERO.reassurance },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: LANDING_FAQ.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })),
    },
  ];
}

/* -------------------------------------------------------------------------- */
/*  Contenu lisible sans JavaScript                                            */
/* -------------------------------------------------------------------------- */

const FOOTER_LINKS = PUBLIC_PAGES.filter((page) => page.path !== '/').map((page) => ({ href: page.path, label: page.title.split(' · ')[0]! }));

const linksLine = (links: { href: string; label: string }[]) =>
  `<p class="text-sm text-muted-foreground">${links.map((link) => `<a class="underline underline-offset-4" href="${escapeMarkup(link.href)}">${escapeMarkup(link.label)}</a>`).join(' · ')}</p>`;

/**
 * Texte de la page, posé dans le HTML servi : c'est ce que lit un moteur de recherche qui
 * n'exécute pas le JavaScript, et ce que voit un visiteur pendant que l'application se charge.
 * L'application le remplace dès qu'elle démarre. Même texte que la page elle-même — il vient de
 * la même source — et mêmes classes que la page d'accueil, pour qu'il s'affiche proprement.
 */
export function staticContent(page: PublicPage): string {
  const h2 = (text: string) => `<h2 class="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">${escapeMarkup(text)}</h2>`;
  const h3 = (text: string) => `<h3 class="mt-2 text-lg font-semibold">${escapeMarkup(text)}</h3>`;
  const p = (text: string) => `<p class="leading-relaxed text-muted-foreground">${escapeMarkup(text)}</p>`;

  if (page.path !== '/') {
    return [
      '<main class="mx-auto max-w-6xl space-y-6 px-4 py-16 sm:px-6">',
      `<h1 class="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">${escapeMarkup(page.title.split(' · ')[0]!)}</h1>`,
      `<p class="max-w-xl text-lg leading-relaxed text-muted-foreground">${escapeMarkup(page.description)}</p>`,
      linksLine([{ href: '/', label: SITE_NAME }, ...FOOTER_LINKS.filter((link) => link.href !== page.path)]),
      '</main>',
    ].join('');
  }

  return [
    '<main class="mx-auto max-w-6xl space-y-12 px-4 py-16 sm:px-6">',
    '<header class="space-y-6">',
    `<p class="text-sm text-muted-foreground">${escapeMarkup(LANDING_HERO.badge)}</p>`,
    `<h1 class="font-display text-4xl leading-[1.05] font-black tracking-tight sm:text-5xl lg:text-6xl">${escapeMarkup(LANDING_HERO.title)}</h1>`,
    `<p class="max-w-xl text-lg leading-relaxed text-muted-foreground">${escapeMarkup(LANDING_HERO.intro)}</p>`,
    `<p class="text-sm text-muted-foreground">${escapeMarkup(LANDING_HERO.reassurance)} <a class="font-medium underline underline-offset-4" href="/connexion">Créer un compte ou se connecter</a></p>`,
    '</header>',
    '<section class="space-y-4">',
    h2('Voir, créer, vendre'),
    ...LANDING_GROUPS.map((group) => `${h3(`${group.title} — ${group.pitch}`)}<ul class="space-y-2 text-sm leading-relaxed">${group.features.map((feature) => `<li>${escapeMarkup(feature)}</li>`).join('')}</ul>`),
    '</section>',
    '<section class="space-y-4">',
    h2('Nos engagements'),
    ...LANDING_COMMITMENTS.map((commitment) => `${h3(commitment.title)}${p(commitment.body)}`),
    '</section>',
    '<section class="space-y-4">',
    h2('Questions fréquentes'),
    ...LANDING_FAQ.map((item) => `${h3(item.question)}${p(item.answer)}`),
    '</section>',
    `<footer>${linksLine(FOOTER_LINKS)}</footer>`,
    '</main>',
  ].join('');
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
const EMPTY_ROOT = '<div id="root"></div>';

export interface SeoExtras {
  /**
   * Codes de validation donnés par les outils des moteurs de recherche (Google Search Console,
   * Bing Webmaster Tools) : posés sur l'accueil, ils prouvent que le site appartient à celui
   * qui le déclare.
   */
  verification?: { google?: string | undefined; bing?: string | undefined };
}

/**
 * index.html avec les balises de la page demandée. Les robots et les aperçus de liens
 * (messageries, réseaux sociaux) lisent ces balises sans exécuter le JavaScript.
 * Une adresse inconnue répond 404 : sinon chaque faute de frappe deviendrait une page
 * « trouvée » aux yeux des moteurs de recherche.
 */
export function renderIndexHtml(
  template: string,
  appUrl: string,
  path: string,
  extras: SeoExtras = {},
): { status: number; html: string; indexable: boolean } {
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
    `<meta property="og:image" content="${escapeMarkup(url)}/og-image.png" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="Smart Creator : lire le marché, produire le bon produit digital, le vendre." />',
    '<meta name="twitter:card" content="summary_large_image" />',
    ...(page
      ? [
          `<link rel="canonical" href="${escapeMarkup(url + page.path)}" /><meta property="og:url" content="${escapeMarkup(url + page.path)}" />`,
          `<link rel="alternate" hreflang="fr" href="${escapeMarkup(url + page.path)}" /><link rel="alternate" hreflang="x-default" href="${escapeMarkup(url + page.path)}" />`,
          '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />',
          ...structuredData(page, appUrl).map((entry) => `<script type="application/ld+json">${jsonForHtml(entry)}</script>`),
        ]
      : ['<meta name="robots" content="noindex, nofollow" />']),
    ...(page?.path === '/' && extras.verification?.google
      ? [`<meta name="google-site-verification" content="${escapeMarkup(extras.verification.google)}" />`]
      : []),
    ...(page?.path === '/' && extras.verification?.bing ? [`<meta name="msvalidate.01" content="${escapeMarkup(extras.verification.bing)}" />`] : []),
  ];

  const html = template
    .replace(SEO_BLOCK, () => `<!--seo-->\n    ${tags.join('\n    ')}\n    <!--/seo-->`)
    .replace(EMPTY_ROOT, () => (page ? `<div id="root">${staticContent(page)}</div>` : EMPTY_ROOT))
    .replaceAll('__APP_URL__', escapeMarkup(url));
  return { status: kind === 'unknown' ? 404 : 200, html, indexable: kind === 'public' };
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                     */
/* -------------------------------------------------------------------------- */

export interface SeoRouteOptions {
  /** Clé de déclaration aux moteurs (IndexNow) : servie à « /<clé>.txt », où ils viennent la vérifier. */
  indexNowKey?: string | null;
}

export function mountSeoRoutes(app: Express, appUrl: string, lastModified: string, options: SeoRouteOptions = {}): void {
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600').send(robotsTxt(appUrl));
  });
  app.get('/sitemap.xml', (_req, res) => {
    res.type('application/xml').setHeader('Cache-Control', 'public, max-age=3600').send(sitemapXml(appUrl, lastModified));
  });
  const key = options.indexNowKey;
  if (key) {
    app.get(`/${key}.txt`, (_req, res) => {
      res.type('text/plain').setHeader('Cache-Control', 'public, max-age=86400').send(key);
    });
  }
}

/**
 * Client construit (dist/client) : fichiers versionnés en cache long, index.html
 * réécrit pour chaque adresse. Le modèle brut n'est jamais servi tel quel.
 */
export function mountClient(
  app: Express,
  clientDir: string,
  appUrl: string,
  options: { serveStaticFiles?: boolean } & SeoExtras & SeoRouteOptions = {},
): void {
  const templatePath = join(clientDir, 'index.html');
  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : null;
  const lastModified = lastModifiedOf(template ? statSync(templatePath).mtime : null);

  mountSeoRoutes(app, appUrl, lastModified, options);
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
    const { status, html, indexable } = renderIndexHtml(template, appUrl, req.path, options);
    res.status(status).setHeader('Cache-Control', 'no-cache');
    /*
      Le navigateur revalide toujours (no-cache), mais le réseau de l'hébergeur garde la page :
      elle est identique pour tous les visiteurs (aucune donnée de compte, aucun cookie) et ne
      change qu'avec un déploiement, qui vide ce cache. Sans cela, chaque ouverture de page
      faisait l'aller-retour jusqu'à la fonction de Washington : 0,6 à 1,1 s avant le premier
      octet, mesuré depuis l'Afrique centrale.
    */
    res.setHeader('Vercel-CDN-Cache-Control', 'max-age=3600, stale-while-revalidate=86400');
    if (!indexable) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.type('html').send(html);
  });
}
