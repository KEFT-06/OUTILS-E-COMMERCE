/**
 * Collecteur Firecrawl : la bibliothèque publicitaire publique de Meta, lue par le service Firecrawl.
 *
 * Mesuré le 18/10/2026 : une recherche lue par Firecrawl coûte UN crédit et rend les trente
 * premières annonces, complètes (lien de la boutique, texte, visuels, dates) — exactement ce que
 * lit le collecteur maison. Faire défiler la page n'en ajoute aucune : la suite arrive par des
 * requêtes que Firecrawl ne rend pas. Pour récolter beaucoup d'annonces DIFFÉRENTES, ce collecteur
 * multiplie donc les recherches que le collecteur maison ne fait pas : annonces arrêtées, images
 * seules, vidéos seules, pays en plus, niches, Maketou, Shopify.
 *
 * Chaque crédit doit rapporter : une famille de recherches qui ne ramène plus d'annonces nouvelles
 * est abandonnée. « Nouvelle » se lit dans la réponse du site (annonces que le mur n'avait jamais
 * vues) ; pendant un essai, faute de site, dans ce que le passage a déjà lu.
 *
 * Il ne contourne rien : lecture ordinaire (« proxy basic »), jamais le mode furtif. Si Meta ne
 * rend plus d'annonces, le passage s'arrête.
 *
 *   node firecrawl.mjs --essai --credits=6      lit sans rien verser (les crédits sont dépensés quand même)
 *   node firecrawl.mjs                          dépense les crédits jusqu'au bout et verse au site
 *   node firecrawl.mjs --credits=200 --nouvelles=5000 --concurrence=2
 *
 * Réglages (environnement, ou fichier .env à la racine du dépôt) :
 *   FIRECRAWL_API_KEY  clé du compte Firecrawl
 *   CRON_SECRET        secret du planificateur du site : sans lui, essai seulement
 *   COLLECTE_SITE      adresse du site (défaut : https://www.smartcreatorcm.com)
 */
import { clientDuSite, harvestPage, lireReglages, searchUrl, slim } from './annonces.mjs';

lireReglages(/^(CRON_SECRET|COLLECTE_[A-Z_]+|FIRECRAWL_API_KEY)$/);

const option = (name, fallback = null) => {
  const found = process.argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (!found) return fallback;
  return found.includes('=') ? found.slice(found.indexOf('=') + 1) : true;
};

const SITE = String(option('site', process.env.COLLECTE_SITE ?? 'https://www.smartcreatorcm.com')).replace(/\/+$/, '');
const SECRET = process.env.CRON_SECRET ?? '';
const CLE = process.env.FIRECRAWL_API_KEY ?? '';
const ESSAI = option('essai', false) === true || !SECRET;
const PLAFOND_CREDITS = Number(option('credits', Number.POSITIVE_INFINITY)) || Number.POSITIVE_INFINITY;
const PLAFOND_NOUVELLES = Number(option('nouvelles', Number.POSITIVE_INFINITY)) || Number.POSITIVE_INFINITY;
const CONCURRENCE = Math.max(1, Math.min(5, Number(option('concurrence', 2)) || 2));
const FIRECRAWL = 'https://api.firecrawl.dev/v2';
const LOT = 40;

if (!CLE) {
  console.error('FIRECRAWL_API_KEY est absent : ajoutez la clé du compte Firecrawl au fichier .env (ou à l’environnement).');
  process.exit(1);
}

const site = clientDuSite(SITE, SECRET);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const heure = () => new Date().toLocaleTimeString('fr-FR');

/* -------------------------------------------------------------------------- */
/*  Firecrawl                                                                 */
/* -------------------------------------------------------------------------- */

async function creditsRestants() {
  const response = await fetch(`${FIRECRAWL}/team/credit-usage`, { headers: { Authorization: `Bearer ${CLE}` }, signal: AbortSignal.timeout(30_000) });
  if (response.status === 401) throw new Error('clé Firecrawl refusée');
  const body = await response.json().catch(() => null);
  return Number(body?.data?.remainingCredits ?? Number.NaN);
}

/** Une page lue par Firecrawl, ou null après trois essais. Lève quand les crédits sont épuisés ou la clé refusée. */
async function lirePage(url) {
  for (let essai = 1; essai <= 3; essai += 1) {
    const response = await fetch(`${FIRECRAWL}/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CLE}`, 'Content-Type': 'application/json' },
      // maxAge 0 : une page fraîche, dont les adresses de visuels n'ont pas encore expiré.
      body: JSON.stringify({ url, formats: ['rawHtml'], onlyMainContent: false, proxy: 'basic', maxAge: 0, waitFor: 4_000, timeout: 90_000 }),
      signal: AbortSignal.timeout(150_000),
    }).catch(() => null);
    if (!response) {
      await pause(5_000 * essai);
      continue;
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.success) return { html: String(body.data?.rawHtml ?? ''), credits: Number(body.data?.metadata?.creditsUsed ?? 1) };
    if (response.status === 402) throw Object.assign(new Error('crédits Firecrawl épuisés'), { arret: true });
    if (response.status === 401) throw Object.assign(new Error('clé Firecrawl refusée'), { arret: true });
    // Trop de demandes à la fois : on attend ce que Firecrawl demande, sinon vingt secondes.
    if (response.status === 429) {
      await pause((Number(response.headers.get('retry-after')) || 20) * 1_000);
      continue;
    }
    console.warn(`${heure()} Firecrawl a répondu ${response.status} : ${String(body?.error ?? '').slice(0, 160)}`);
    await pause(5_000 * essai);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Ce que l'on cherche                                                       */
/* -------------------------------------------------------------------------- */

/** Pays où vendent les boutiques suivies, au-delà de ceux que parcourt déjà le collecteur maison. */
const PAYS_EN_PLUS = ['GN', 'NE', 'TD', 'MG', 'CF', 'BI', 'RW', 'DJ', 'MR', 'MA', 'TN', 'DZ', 'BE', 'CA', 'CH', 'HT', 'LU', 'KM', 'GQ', 'CV'];
/** Niches des produits numériques vendus sur ces boutiques : chaque mot donne d'autres trente premières annonces. */
const NICHES = [
  'formation', 'ebook', 'business', 'argent', 'coaching', 'recette', 'beauté', 'santé', 'amour', 'couple',
  'anglais', 'excel', 'trading', 'crypto', 'bourse', 'élevage', 'agriculture', 'couture', 'cuisine', 'pâtisserie',
  'prière', 'marketing', 'tiktok', 'facebook', 'dropshipping', 'immobilier', 'enfants', 'mariage', 'perte de poids', 'cheveux',
  'savon', 'parfum', 'canva', 'montage', 'chatgpt', 'intelligence artificielle', 'développement personnel', 'sport', 'musique', 'permis',
];
const PAYS_DES_NICHES = ['ALL', 'CM', 'CI', 'SN', 'BJ', 'TG', 'BF', 'CD', 'GA'];

const recherches = (mots, pays, reglage = {}) => mots.flatMap((q) => pays.map((country) => ({ q, country, reglage })));

function familles(paysDuSite, paysCibles) {
  const tous = ['ALL', ...paysDuSite.filter((code) => code !== 'ALL')];
  return [
    { nom: 'chariow · annonces arrêtées', liste: recherches(['mychariow', 'chariow'], tous, { statut: 'inactive' }) },
    { nom: 'chariow · images', liste: recherches(['mychariow'], tous, { media: 'image' }) },
    { nom: 'chariow · vidéos', liste: recherches(['mychariow'], tous, { media: 'video' }) },
    { nom: 'chariow · autres pays', liste: recherches(['mychariow', 'chariow'], PAYS_EN_PLUS) },
    { nom: 'chariow · niches', liste: NICHES.flatMap((mot) => PAYS_DES_NICHES.map((country) => ({ q: `mychariow ${mot}`, country, reglage: {} }))) },
    { nom: 'maketou', liste: [...recherches(['mymaketou', 'maketou'], paysCibles), ...recherches(['mymaketou'], paysCibles, { statut: 'inactive' })] },
    { nom: 'shopify', liste: [...recherches(['myshopify'], paysCibles, { media: 'image' }), ...recherches(['myshopify'], paysCibles, { media: 'video' }), ...recherches(['myshopify'], paysCibles, { statut: 'inactive' })] },
  ].map((famille) => ({ ...famille, prochaine: 0, recentes: [], abandonnee: false, credits: 0, nouvelles: 0 }));
}

/** Une famille est abandonnée quand ses quatre dernières recherches ont rapporté moins de quatre annonces nouvelles. */
const FENETRE = 4;
function noter(famille, nouvelles) {
  famille.recentes.push(nouvelles);
  if (famille.recentes.length > FENETRE) famille.recentes.shift();
  if (famille.recentes.length === FENETRE && famille.recentes.reduce((a, b) => a + b, 0) < FENETRE) famille.abandonnee = true;
}

/* -------------------------------------------------------------------------- */
/*  Le passage                                                                */
/* -------------------------------------------------------------------------- */

const BOUTIQUE = /\.(?:mychariow|mymaketou)\.[a-z]{2,12}\b|\.myshopify\.com\b/i;
const totaux = { credits: 0, recherches: 0, lues: 0, versees: 0, gardees: 0, nouvelles: 0, boutiquesNouvelles: 0, apercus: 0, vides: 0, demandes: 0 };
const dejaLues = new Set();
let pagesVidesDeSuite = 0;
let arret = null;

/** Verse les annonces d'une recherche ; rend le nombre d'annonces nouvelles pour le mur. */
async function verser(annonces, country, recherche = null) {
  if (ESSAI) return annonces.filter((ad) => BOUTIQUE.test(JSON.stringify(ad.snapshot ?? {}))).length;
  // Rien de neuf à verser : seule une recherche de client doit apprendre qu’elle est lue, même vide.
  if (annonces.length === 0 && !recherche) return 0;
  let nouvelles = 0;
  for (let debut = 0; debut === 0 || debut < annonces.length; debut += LOT) {
    const lot = annonces.slice(debut, debut + LOT);
    const outcome = await site('/api/cron/collecte', {
      method: 'POST',
      body: JSON.stringify({
        country,
        items: lot,
        apercus: true,
        ...(recherche ? { search: { id: recherche, first: debut === 0, done: debut + LOT >= annonces.length } } : {}),
      }),
    });
    totaux.versees += lot.length;
    totaux.gardees += outcome.adsKept ?? 0;
    totaux.boutiquesNouvelles += outcome.storesNew ?? 0;
    totaux.apercus += outcome.thumbnails?.stored ?? 0;
    nouvelles += outcome.adsNew ?? 0;
    if (annonces.length === 0) break;
  }
  return nouvelles;
}

async function traiter({ q, country, reglage, famille, demande }) {
  const page = await lirePage(searchUrl(q, country, reglage));
  totaux.recherches += 1;
  if (!page) {
    console.warn(`${heure()} « ${q} » · ${country} : abandon après trois essais.`);
    return;
  }
  totaux.credits += page.credits;
  const trouvees = new Map();
  harvestPage(page.html, trouvees);
  // Rien du tout dans une page : la bibliothèque ne répond plus normalement. Six de suite : on s'arrête.
  pagesVidesDeSuite = trouvees.size === 0 ? pagesVidesDeSuite + 1 : 0;
  if (trouvees.size === 0) totaux.vides += 1;
  if (pagesVidesDeSuite >= 6) arret ??= 'la bibliothèque ne rend plus d’annonces (six pages vides de suite) : arrêt sans insister';

  // Une annonce déjà lue pendant ce passage n'est pas reversée (une recherche de client, si : elle la complète).
  const annonces = [...trouvees.values()].filter((ad) => demande || !dejaLues.has(String(ad.ad_archive_id))).map(slim);
  for (const ad of annonces) dejaLues.add(String(ad.ad_archive_id));
  totaux.lues += trouvees.size;
  if (demande) totaux.demandes += 1;
  const nouvelles = await verser(annonces, country, demande ?? null);
  totaux.nouvelles += nouvelles;
  if (famille) {
    famille.credits += page.credits;
    famille.nouvelles += nouvelles;
    noter(famille, nouvelles);
  }
  const reglageLu = [reglage?.statut === 'inactive' ? 'arrêtées' : null, reglage?.media && reglage.media !== 'all' ? reglage.media : null].filter(Boolean).join(', ');
  console.log(`${heure()} « ${q} » · ${country}${reglageLu ? ` (${reglageLu})` : ''} : ${trouvees.size} lues, ${nouvelles} nouvelles${famille ? ` — ${famille.nom}` : ' — recherche d’un client'}`);
}

/** Plan : pays du site et recherches de clients en attente. Le site absent (essai), un plan par défaut. */
async function plan() {
  const defaut = { countries: ['ALL', 'CM', 'CI', 'SN', 'BJ', 'TG', 'BF', 'ML', 'CD', 'GA', 'CG', 'FR'], extra: { countries: ['CM', 'CI', 'SN', 'BJ', 'TG', 'BF', 'ML', 'CD', 'GA', 'CG'] }, searches: [] };
  // Un essai ne touche pas au site, pas même pour lire son plan.
  if (!SECRET || ESSAI) return defaut;
  try {
    return { ...defaut, ...(await site('/api/cron/collecte')) };
  } catch (error) {
    console.warn(`Plan du site indisponible (${error.message}) : plan par défaut.`);
    return defaut;
  }
}

const programme = await plan();
const restantes = await creditsRestants();
const budget = Math.min(PLAFOND_CREDITS, Number.isFinite(restantes) ? restantes : PLAFOND_CREDITS);
const lesFamilles = familles(programme.countries ?? [], programme.extra?.countries ?? []);
const demandes = (programme.searches ?? []).map((search) => ({ q: search.query, country: search.country, reglage: {}, demande: search.id }));
console.log(
  `${ESSAI ? 'ESSAI (rien n’est versé)' : `Versement vers ${SITE}`} — ${restantes} crédit(s) Firecrawl restant(s), ${budget === Number.POSITIVE_INFINITY ? 'tous' : budget} à dépenser` +
    `${Number.isFinite(PLAFOND_NOUVELLES) ? `, arrêt à ${PLAFOND_NOUVELLES} annonces nouvelles` : ''} ; ${demandes.length} recherche(s) de clients en attente ; ` +
    `${lesFamilles.reduce((total, famille) => total + famille.liste.length, 0)} recherches possibles en ${lesFamilles.length} familles.`,
);

/** Prochaine recherche : les clients d'abord, puis chaque famille encore productive à tour de rôle. */
let tour = 0;
function suivante() {
  if (demandes.length > 0) return demandes.shift();
  const vivantes = lesFamilles.filter((famille) => !famille.abandonnee && famille.prochaine < famille.liste.length);
  if (vivantes.length === 0) return null;
  const famille = vivantes[tour++ % vivantes.length];
  return { ...famille.liste[famille.prochaine++], famille };
}

const debut = Date.now();
let enCours = 0;
async function ouvrier() {
  for (;;) {
    if (arret) return;
    if (totaux.credits + enCours >= budget) return;
    if (totaux.nouvelles >= PLAFOND_NOUVELLES) return;
    const recherche = suivante();
    if (!recherche) return;
    enCours += 1;
    try {
      await traiter(recherche);
    } catch (error) {
      if (error.arret) arret ??= error.message;
      else console.warn(`${heure()} « ${recherche.q} » · ${recherche.country} : ${error.message}`);
    } finally {
      enCours -= 1;
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCE }, ouvrier));

const duree = Math.round((Date.now() - debut) / 1000);
const parFamille = lesFamilles
  .filter((famille) => famille.credits > 0)
  .map((famille) => ({ famille: famille.nom, credits: famille.credits, nouvelles: famille.nouvelles, abandonnee: famille.abandonnee }));
// Dernier versement, vide : il inscrit le passage au journal du site et recalcule les alertes.
if (!ESSAI) {
  await site('/api/cron/collecte', {
    method: 'POST',
    body: JSON.stringify({ country: 'ALL', items: [], done: true, summary: { source: 'firecrawl', ...totaux, dureeSecondes: duree, familles: parFamille } }),
  }).catch((error) => console.warn(`Clôture du passage refusée : ${error.message}`));
}
const apres = await creditsRestants().catch(() => Number.NaN);

console.log(
  `\nTerminé en ${duree} s — ${totaux.credits} crédit(s) dépensé(s), ${totaux.recherches} recherche(s), ${totaux.lues} annonces lues, ` +
    (ESSAI
      ? `${totaux.nouvelles} menant à une boutique suivie et jamais lues pendant ce passage (essai : rien n’a été versé).`
      : `${totaux.nouvelles} nouvelles sur le mur, ${totaux.gardees} gardées en tout, ${totaux.boutiquesNouvelles} boutique(s) nouvelle(s), ${totaux.apercus} aperçu(s) copié(s).`) +
    ` Crédits restants : ${apres}.` +
    (arret ? `\nArrêt : ${arret}.` : ''),
);
for (const ligne of parFamille) console.log(`  ${ligne.famille} : ${ligne.credits} crédit(s), ${ligne.nouvelles} nouvelles${ligne.abandonnee ? ' (abandonnée : ne rapportait plus)' : ''}`);
if (totaux.demandes > 0) console.log(`${totaux.demandes} recherche(s) de clients lue(s).`);
process.exit(arret && !/épuisés/.test(arret) ? 1 : 0);
