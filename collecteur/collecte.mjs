/**
 * Collecteur maison de la bibliothèque publicitaire publique — Crawlee + Playwright.
 *
 * La bibliothèque publicitaire de Meta est publique : n'importe qui peut y chercher « mychariow »
 * et faire défiler les annonces en cours. Ce programme fait exactement cela avec un navigateur
 * piloté, lit les annonces au passage, puis les VERSE au site, qui les range dans le mur
 * d'espionnage comme celles de la collecte payante.
 *
 * Il ne peut pas tourner chez l'hébergeur du site (pas de navigateur dans une fonction) : il
 * tourne sur un poste ou dans une tâche planifiée.
 *
 *   node collecte.mjs                    passage complet : mots-clés × pays, autres plateformes (Maketou, Shopify)
 *                                        dans les pays visés, puis contrôle des annonces anciennes
 *   node collecte.mjs --essai            lit sans rien verser, et dit ce qu'il a trouvé
 *   node collecte.mjs --mots=mychariow --pays=CM,CI --max=300
 *
 * Réglages (variables d'environnement, ou fichier .env à la racine du dépôt) :
 *   COLLECTE_SITE   adresse du site (défaut : https://www.smartcreatorcm.com)
 *   CRON_SECRET     secret du planificateur du site : sans lui, le collecteur ne fait qu'un essai
 *   COLLECTE_NAVIGATEUR  msedge (défaut sous Windows), chrome, ou chromium (après « npx playwright install chromium »)
 */
import { Configuration, PlaywrightCrawler, log } from '@crawlee/playwright';

// Sous Windows, Crawlee mesure la mémoire par PowerShell : certains terminaux ne l'ont pas dans leur chemin.
if (process.platform === 'win32') {
  const dossier = [process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0'].join('\\');
  if (!(process.env.PATH ?? '').toLowerCase().includes(dossier.toLowerCase())) process.env.PATH = `${process.env.PATH ?? ''};${dossier}`;
}

const option = (name, fallback = null) => {
  const found = process.argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (!found) return fallback;
  return found.includes('=') ? found.slice(found.indexOf('=') + 1) : true;
};

const SITE = String(option('site', process.env.COLLECTE_SITE ?? 'https://www.smartcreatorcm.com')).replace(/\/+$/, '');
const SECRET = process.env.CRON_SECRET ?? '';
const ESSAI = option('essai', false) === true || !SECRET;
const NAVIGATEUR = String(option('navigateur', process.env.COLLECTE_NAVIGATEUR ?? (process.platform === 'win32' ? 'msedge' : 'chromium')));
const LOT = 40;

/**
 * Demande au site, avec le secret du planificateur. Trois essais : sur une connexion instable,
 * un lot d'annonces ou la clôture du passage se perdait à la première coupure (passage du
 * 04/10/2026 : la clôture n'est jamais arrivée, les alertes n'ont pas été recalculées).
 */
async function site(path, init = {}) {
  let failure;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${SITE}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${SECRET}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(60_000),
      });
      // Un refus du site (secret, lot illisible) ne se réessaie pas : il se répéterait à l'identique.
      if (response.status >= 400 && response.status < 500) throw Object.assign(new Error(`${path} a répondu ${response.status}`), { definitive: true });
      if (!response.ok) throw new Error(`${path} a répondu ${response.status}`);
      return await response.json();
    } catch (error) {
      failure = error;
      if (error.definitive || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    }
  }
  throw failure;
}

/** Plan du passage : celui du site quand on a son secret, sinon un plan d'essai. */
async function plan() {
  const defaut = { queries: ['mychariow', 'chariow'], countries: ['ALL'], maxPerQuery: 600, toVerify: [] };
  let fromSite = defaut;
  if (SECRET) {
    try {
      fromSite = await site('/api/cron/collecte');
    } catch (error) {
      log.warning(`Plan du site indisponible (${error.message}) : plan par défaut.`);
    }
  }
  const list = (value) => (typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : null);
  // Des mots ou des pays donnés à la main décrivent tout le passage : les recherches du site ne s'y ajoutent pas.
  const aLaMain = list(option('mots')) !== null || list(option('pays')) !== null;
  const extra = fromSite.extra ?? { queries: [], countries: [], maxPerQuery: 150 };
  return {
    queries: list(option('mots')) ?? fromSite.queries,
    countries: (list(option('pays')) ?? fromSite.countries).map((code) => code.toUpperCase()),
    maxPerQuery: Number(option('max', fromSite.maxPerQuery)) || 600,
    extra: aLaMain ? { queries: [], countries: [], maxPerQuery: 0 } : extra,
    toVerify: option('sans-controle', false) ? [] : fromSite.toVerify,
  };
}

const searchUrl = (query, country) =>
  `https://www.facebook.com/ads/library/?${new URLSearchParams({ active_status: 'active', ad_type: 'all', country, q: query, search_type: 'keyword_unordered', media_type: 'all' })}`;
const adUrl = (id) => `https://www.facebook.com/ads/library/?${new URLSearchParams({ active_status: 'all', ad_type: 'all', country: 'ALL', id })}`;

/** Ne garde d'une annonce que ce que le site lit : dix fois moins lourd à verser. */
function slim(ad) {
  const media = (item) => ({
    original_image_url: item?.original_image_url ?? null,
    resized_image_url: item?.resized_image_url ?? null,
    video_preview_image_url: item?.video_preview_image_url ?? null,
    video_hd_url: item?.video_hd_url ?? null,
    video_sd_url: item?.video_sd_url ?? null,
  });
  const snapshot = ad.snapshot ?? {};
  return {
    ad_archive_id: ad.ad_archive_id,
    is_active: ad.is_active,
    start_date: ad.start_date,
    end_date: ad.end_date,
    collation_count: ad.collation_count,
    publisher_platform: ad.publisher_platform,
    page_id: ad.page_id,
    page_name: ad.page_name,
    impressions_with_index: ad.impressions_with_index,
    snapshot: {
      link_url: snapshot.link_url,
      caption: snapshot.caption,
      title: snapshot.title,
      body: snapshot.body ? { text: snapshot.body.text } : null,
      images: (snapshot.images ?? []).slice(0, 4).map(media),
      videos: (snapshot.videos ?? []).slice(0, 2).map(media),
      cards: (snapshot.cards ?? []).slice(0, 10).map((card) => ({ ...media(card), title: card.title, body: card.body, link_url: card.link_url, cta_text: card.cta_text })),
      page_name: snapshot.page_name,
      page_profile_uri: snapshot.page_profile_uri,
      page_profile_picture_url: snapshot.page_profile_picture_url,
      cta_text: snapshot.cta_text,
      display_format: snapshot.display_format,
      link_description: snapshot.link_description,
    },
  };
}

/** Relève les annonces contenues dans un texte de réponse (une ligne JSON par lot). */
function harvest(text, into) {
  for (const line of text.split('\n')) {
    if (!line.includes('ad_archive_id')) continue;
    let json;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      if (node.ad_archive_id && node.snapshot) into.set(String(node.ad_archive_id), node);
      Object.values(node).forEach(visit);
    };
    visit(json);
  }
}

const totals = { lues: 0, versees: 0, gardees: 0, boutiquesNouvelles: 0, controlees: 0, arretees: 0, echecs: 0 };

/** Où mènent les annonces lues, par famille d'adresses (« *.mychariow.shop ») : le compte rendu d'un essai. */
const destinations = new Map();
function noteDestination(ad) {
  let host = String(ad.snapshot?.caption ?? '').toLowerCase();
  try {
    host = new URL(ad.snapshot.link_url).hostname.toLowerCase();
  } catch {
    // Pas de lien lisible : la légende tient lieu d'adresse.
  }
  const labels = host.replace(/^www\./, '').split('.').filter(Boolean);
  const family = labels.length > 2 ? `*.${labels.slice(1).join('.')}` : labels.join('.') || '(sans lien)';
  destinations.set(family, (destinations.get(family) ?? 0) + 1);
}

/** Verse un lot au site, ou le compte seulement pendant un essai. */
async function verser(items, country, done = false, summary = undefined) {
  if (ESSAI) return;
  for (let start = 0; start < items.length || (done && start === 0); start += LOT) {
    const last = done && start + LOT >= items.length;
    const outcome = await site('/api/cron/collecte', {
      method: 'POST',
      body: JSON.stringify({ country, items: items.slice(start, start + LOT), done: last, ...(last && summary ? { summary } : {}) }),
    });
    totals.versees += Math.min(LOT, items.length - start);
    totals.gardees += outcome.adsKept ?? 0;
    totals.boutiquesNouvelles += outcome.storesNew ?? 0;
    if (items.length === 0) break;
  }
}

const programme = await plan();
log.info(
  `${ESSAI ? 'ESSAI (rien n’est versé)' : `Versement vers ${SITE}`} — ${programme.queries.length} mot(s)-clé(s) × ${programme.countries.length} pays, ` +
    `${programme.maxPerQuery} annonces au plus par recherche` +
    (programme.extra.queries.length > 0
      ? ` ; autres plateformes : ${programme.extra.queries.length} mot(s) × ${programme.extra.countries.length} pays, ${programme.extra.maxPerQuery} au plus`
      : '') +
    ` ; ${programme.toVerify.length} annonce(s) ancienne(s) à contrôler.`,
);

// Rien n'est gardé sur le disque : ni file d'attente, ni captures.
Configuration.getGlobalConfig().set('persistStorage', false);

const crawler = new PlaywrightCrawler({
  maxConcurrency: 1,
  maxRequestRetries: 2,
  navigationTimeoutSecs: 90,
  requestHandlerTimeoutSecs: 600,
  launchContext: { launchOptions: { headless: true, ...(NAVIGATEUR === 'chromium' ? {} : { channel: NAVIGATEUR }) } },
  browserPoolOptions: { useFingerprints: false },
  // La bibliothèque répond 403 au document tout en servant la page : ce n'est pas un blocage.
  sessionPoolOptions: { blockedStatusCodes: [] },
  preNavigationHooks: [
    async ({ page, request }, gotoOptions) => {
      // La page n'atteint jamais le repos du réseau : on reprend la main dès que le document est là.
      if (gotoOptions) gotoOptions.waitUntil = 'domcontentloaded';
      const found = new Map();
      request.userData.found = found;
      // Les résultats arrivent par lots JSON, au chargement puis à chaque défilement : on les lit au passage.
      page.on('response', async (response) => {
        if (!/\/api\/graphql|ads\/library/.test(response.url())) return;
        try {
          const text = await response.text();
          if (text.includes('ad_archive_id')) harvest(text, found);
        } catch {
          // Réponse sans corps lisible (redirection, flux coupé) : rien à en tirer.
        }
      });
    },
  ],
  async requestHandler({ page, request }) {
    const { kind, country, query, max, id } = request.userData;
    const found = request.userData.found;
    await page.waitForSelector('body', { state: 'attached', timeout: 60_000 });
    await page.waitForTimeout(6_000);
    // Les premières annonces sont aussi dans la page elle-même.
    harvest((await page.content()).replace(/<script[^>]*>/g, '\n').replace(/<\/script>/g, '\n'), found);

    if (kind === 'controle') {
      const ad = found.get(String(id));
      totals.controlees += 1;
      if (ad && ad.is_active === false) {
        totals.arretees += 1;
        await verser([slim(ad)], 'ALL');
      } else if (ad) {
        // Toujours en cours : la date de dernière vue avance, elle ne sera pas recontrôlée demain.
        await verser([slim(ad)], 'ALL');
      }
      return;
    }

    // Défilement : la page charge la suite à chaque fois, jusqu'au plafond ou jusqu'à ce que plus rien n'arrive.
    let stalled = 0;
    while (found.size < max && stalled < 4) {
      const before = found.size;
      await page.mouse.wheel(0, 8_000);
      await page.waitForTimeout(1_800);
      stalled = found.size === before ? stalled + 1 : 0;
    }
    const ads = [...found.values()].slice(0, max).map(slim);
    /*
      Une recherche revenue vide est refaite une fois, en fin de passage. Le 04/10/2026, sur une
      connexion instable, « mychariow » tous pays confondus est revenu à zéro annonce alors
      qu'il en rend des centaines : une page chargée à moitié ne se distingue pas d'une page vide.
    */
    if (ads.length === 0 && !request.userData.second) {
      await crawler.addRequests([{ url: request.url, uniqueKey: `${request.uniqueKey}:bis`, userData: { ...request.userData, found: undefined, second: true } }]);
      log.info(`« ${query} » · ${country} : rien lu, recherche remise en fin de passage.`);
      return;
    }
    ads.forEach(noteDestination);
    totals.lues += ads.length;
    log.info(`« ${query} » · ${country} : ${ads.length} annonce(s) lue(s).`);
    await verser(ads, country);
  },
  failedRequestHandler({ request }, error) {
    totals.echecs += 1;
    log.warning(`Abandon : ${request.url.slice(0, 110)} — ${error.message.slice(0, 160)}`);
  },
});

const requetes = [
  ...programme.queries.flatMap((query) =>
    programme.countries.map((country) => ({
      url: searchUrl(query, country),
      uniqueKey: `recherche:${query}:${country}`,
      userData: { kind: 'recherche', query, country, max: programme.maxPerQuery },
    })),
  ),
  // Boutiques des autres plateformes : jamais tous pays confondus, et avec leur propre plafond.
  ...programme.extra.queries.flatMap((query) =>
    programme.extra.countries.map((country) => ({
      url: searchUrl(query, country),
      uniqueKey: `recherche:${query}:${country}`,
      userData: { kind: 'recherche', query, country, max: programme.extra.maxPerQuery },
    })),
  ),
  ...programme.toVerify.map((id) => ({ url: adUrl(id), uniqueKey: `controle:${id}`, userData: { kind: 'controle', id } })),
];

const debut = Date.now();
await crawler.run(requetes);
const duree = Math.round((Date.now() - debut) / 1000);

// Dernier versement, vide : il inscrit le passage au journal du site et recalcule les alertes.
if (!ESSAI) await verser([], 'ALL', true, { ...totals, dureeSecondes: duree, pays: programme.countries, mots: programme.queries });

console.log(
  `\nTerminé en ${duree} s — ${totals.lues} annonces lues` +
    (ESSAI
      ? ' (essai : rien n’a été versé).'
      : `, ${totals.gardees} gardées sur le mur, ${totals.boutiquesNouvelles} boutique(s) nouvelle(s), ${totals.controlees} ancienne(s) contrôlée(s) dont ${totals.arretees} arrêtée(s).`) +
    (totals.echecs ? ` ${totals.echecs} recherche(s) abandonnée(s).` : ''),
);
if (ESSAI && destinations.size > 0) {
  const top = [...destinations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`Destinations : ${top.map(([family, count]) => `${family} × ${count}`).join(', ')}.`);
}
process.exit(totals.lues === 0 && totals.controlees === 0 ? 1 : 0);
