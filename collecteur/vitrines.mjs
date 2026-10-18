/**
 * Collecteur des vitrines : le catalogue et les ventes de chaque boutique Chariow, lus par Firecrawl
 * et versés au site.
 *
 * Depuis le 11/10/2026, la plateforme refuse le serveur du site : le radar ne relève plus aucune
 * vente, les alertes de vente se taisent, et les surveillances des clients se mettent en pause.
 * Mesuré le 18/10/2026 : lue par Firecrawl (lecture ordinaire), la même vitrine répond — page de la
 * boutique, catalogue et fiche de chaque produit.
 *
 * Coût : une page = un crédit. Une boutique, c'est son catalogue (une page par tranche de produits)
 * plus une fiche par produit, celle qui porte le nombre de ventes — 8 crédits en moyenne. Les
 * crédits vont d'abord aux boutiques surveillées par des clients, puis à celles qui font de la
 * publicité en ce moment, les plus actives d'abord (ordre donné par le site).
 *
 * Il ne contourne rien : lecture ordinaire (« proxy basic »), jamais le mode furtif. Si la
 * plateforme refuse aussi Firecrawl (cinq boutiques de suite), le passage s'arrête et le dit.
 *
 * Rien n'est écrit au journal qui nomme une boutique : ce journal peut être celui d'un atelier public.
 *
 *   node vitrines.mjs --essai --credits=10    lit sans rien verser (les crédits sont dépensés quand même)
 *   node vitrines.mjs --credits=220           lit et verse au site, jusqu'à 220 crédits
 *   node vitrines.mjs --credits=220 --fiches=40 --concurrence=2
 *
 * Réglages (environnement, ou fichier .env à la racine du dépôt) :
 *   FIRECRAWL_API_KEY  clé du compte Firecrawl
 *   CRON_SECRET        secret du planificateur du site : sans lui, essai seulement
 *   COLLECTE_SITE      adresse du site (défaut : https://www.smartcreatorcm.com)
 */
import { clientDuSite, lireReglages } from './annonces.mjs';

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
const PLAFOND_CREDITS = Number(option('credits', 0)) || 0;
/** Fiches lues au plus par boutique : une très grande boutique ne prend pas les crédits de toutes les autres. */
const FICHES_MAX = Math.max(0, Number(option('fiches', 40)) || 40);
const CONCURRENCE = Math.max(1, Math.min(4, Number(option('concurrence', 2)) || 2));
const DEVISE = String(option('devise', 'XAF')).toUpperCase();
/** Crédits laissés au compte quoi qu'il arrive. */
const RESERVE = 5;
const FIRECRAWL = 'https://api.firecrawl.dev/v2';
const VITRINES = 'https://api-edge.chariow.com';
/** Boutiques refusées de suite au-delà desquelles c'est la plateforme qui refuse : on s'arrête. */
const REFUS_AVANT_ARRET = 5;

if (!CLE) {
  console.error('FIRECRAWL_API_KEY est absent : ajoutez la clé du compte Firecrawl au fichier .env (ou à l’environnement).');
  process.exit(1);
}
if (!PLAFOND_CREDITS) {
  console.error('Indiquez les crédits à dépenser : --credits=N (une boutique en coûte 8 en moyenne).');
  process.exit(1);
}

const site = clientDuSite(SITE, SECRET);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const heure = () => new Date().toLocaleTimeString('fr-FR');

/* -------------------------------------------------------------------------- */
/*  Firecrawl                                                                 */
/* -------------------------------------------------------------------------- */

const totaux = { credits: 0, boutiques: 0, versees: 0, echecs: 0, produits: 0, fiches: 0, fichesAvecVentes: 0, ventes: 0, surveillances: 0, reprises: 0, evenements: 0, lancements: 0 };
const motifs = {};
let budget = 0;
let arret = null;
let refusDeSuite = 0;

async function creditsRestants() {
  const response = await fetch(`${FIRECRAWL}/team/credit-usage`, { headers: { Authorization: `Bearer ${CLE}` }, signal: AbortSignal.timeout(30_000) });
  if (response.status === 401) throw new Error('clé Firecrawl refusée');
  const body = await response.json().catch(() => null);
  return Number(body?.data?.remainingCredits ?? Number.NaN);
}

/** Réserve un crédit du passage ; faux quand il n'en reste plus. */
function prendreCredit() {
  if (arret || totaux.credits >= budget) return false;
  totaux.credits += 1;
  return true;
}

/**
 * Une page lue par Firecrawl : { statut, corps } — le statut est celui de la page chez la
 * plateforme ; 0 quand Firecrawl n'a rien pu rendre. null : plus de crédit pour ce passage.
 */
async function lire(url) {
  if (!prendreCredit()) return null;
  for (let essai = 1; essai <= 2; essai += 1) {
    const response = await fetch(`${FIRECRAWL}/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CLE}`, 'Content-Type': 'application/json' },
      // maxAge 0 : les ventes d'aujourd'hui, pas celles d'un cache.
      body: JSON.stringify({ url, formats: ['rawHtml'], onlyMainContent: false, proxy: 'basic', maxAge: 0, timeout: 45_000 }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    if (!response) {
      await pause(4_000 * essai);
      continue;
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.success) return { statut: Number(body.data?.metadata?.statusCode ?? 200), corps: String(body.data?.rawHtml ?? '') };
    if (response.status === 402) {
      arret = 'crédits Firecrawl épuisés';
      return null;
    }
    if (response.status === 401) {
      arret = 'clé Firecrawl refusée';
      return null;
    }
    if (response.status === 429) {
      await pause((Number(response.headers.get('retry-after')) || 20) * 1_000);
      continue;
    }
    console.warn(`${heure()} Firecrawl a répondu ${response.status}`);
    await pause(4_000 * essai);
  }
  return { statut: 0, corps: '' };
}

/** Le JSON d'une réponse d'API, tel que Firecrawl le rend : brut, ou dans un « pre ». */
function json(corps) {
  const brut = corps.trim();
  const texte = brut.startsWith('<')
    ? (/<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(brut)?.[1] ?? '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    : brut;
  try {
    return JSON.parse(texte);
  } catch {
    return null;
  }
}

class Refus extends Error {}

/** Une page JSON de la vitrine, ou une erreur qui dit pourquoi. */
async function lireJson(url) {
  const page = await lire(url);
  if (page === null) return null;
  if (page.statut === 404) throw new Error('boutique fermée (404)');
  if (page.statut < 200 || page.statut >= 300) throw new Refus(page.statut ? `réponse ${page.statut}` : 'Firecrawl sans réponse');
  const donnees = json(page.corps);
  if (!donnees) throw new Error('réponse illisible');
  return donnees;
}

const avecDevise = (adresse) => {
  const url = new URL(adresse);
  url.searchParams.set('currency', DEVISE);
  return url.toString();
};

/* -------------------------------------------------------------------------- */
/*  Une boutique                                                              */
/* -------------------------------------------------------------------------- */

/** Ce que le site lit d'un produit du catalogue : rien d'autre ne part. */
const produitAllege = (p) => ({ id: p.id, name: p.name, slug: p.slug ?? null, type: p.type ?? null, status: p.status ?? null, pricing: p.pricing ?? null, sales_count: p.sales_count ?? null, store: p.store ? { name: p.store.name ?? null, url: p.store.url ?? null } : null });

/** Relève une boutique ; rend le relevé, ou null quand les crédits ont manqué avant la fin du catalogue. */
async function releverBoutique(boutique) {
  let externalId = boutique.externalId;
  if (!externalId) {
    const accueil = await lire(`https://${boutique.host}/`);
    if (accueil === null) return null;
    if (accueil.statut === 404) throw new Error('boutique fermée (404)');
    if (accueil.statut < 200 || accueil.statut >= 300) throw new Refus(accueil.statut ? `réponse ${accueil.statut}` : 'Firecrawl sans réponse');
    externalId = /store_[a-z0-9]{6,24}/i.exec(accueil.corps)?.[0]?.toLowerCase();
    if (!externalId) throw new Error('page sans catalogue');
  }

  // Le catalogue en entier, ou rien : une page manquante ferait passer ses produits pour arrêtés.
  const catalogue = [];
  let suivante = `${VITRINES}/storefront/${encodeURIComponent(externalId)}/products`;
  for (let page = 0; suivante && page < 20; page += 1) {
    const donnees = await lireJson(avecDevise(suivante));
    if (donnees === null) return null;
    catalogue.push(...(Array.isArray(donnees.data) ? donnees.data : []).map(produitAllege));
    const next = donnees.pagination?.next_page_url ?? null;
    suivante = typeof next === 'string' && next.startsWith(VITRINES) ? next : null;
  }

  // Les fiches : c'est là que sont les ventes. Les produits en vente seulement, dans la limite fixée.
  const enVente = catalogue.filter((p) => !p.status || p.status === 'published');
  const fiches = {};
  const file = enVente.slice(0, FICHES_MAX).map((p) => p.id);
  let lues = 0;
  let avecVentes = 0;
  let plusDeCredit = false;
  const lireFiche = async (id) => {
    try {
      const fiche = await lireJson(avecDevise(`${VITRINES}/storefront/${encodeURIComponent(externalId)}/products/${encodeURIComponent(id)}`));
      if (fiche === null) {
        plusDeCredit = true;
        return;
      }
      const d = fiche.data ?? fiche;
      lues += 1;
      if (typeof d.sales_count?.value === 'number') avecVentes += 1;
      fiches[id] = { sales_count: d.sales_count ?? null, category: d.category ?? null };
    } catch {
      // Une fiche illisible est passée : la boutique est quand même relevée, ce produit garde son dernier compte.
    }
  };
  // Les premières une à une : deux fiches sans ventes, la boutique les masque (réglage de toute la
  // boutique) — les suivantes ne les donneraient pas, et chaque fiche coûte un crédit.
  while (file.length && !plusDeCredit && avecVentes === 0 && lues < 2) await lireFiche(file.shift());
  if (avecVentes > 0 || lues < 2) {
    const ouvrier = async () => {
      for (let id = file.shift(); id && !plusDeCredit; id = file.shift()) await lireFiche(id);
    };
    await Promise.all(Array.from({ length: 2 }, ouvrier));
  }
  return { externalId, label: boutique.label ?? catalogue[0]?.store?.name ?? null, catalogue, fiches, enVente: enVente.length };
}

async function traiter(boutique, rang) {
  const debut = Date.now();
  try {
    const releve = await releverBoutique(boutique);
    if (releve === null) return;
    refusDeSuite = 0;
    totaux.boutiques += 1;
    const lues = Object.values(releve.fiches);
    // Une boutique peut masquer ses ventes : sa fiche les rend vides. Elles ne comptent pas pour zéro.
    const publiees = lues.filter((fiche) => typeof fiche.sales_count?.value === 'number');
    const ventes = publiees.reduce((somme, fiche) => somme + fiche.sales_count.value, 0);
    totaux.produits += releve.enVente;
    totaux.fiches += lues.length;
    totaux.fichesAvecVentes += publiees.length;
    totaux.ventes += ventes;
    let verse = '';
    if (!ESSAI) {
      const reponse = await site('/api/cron/vitrines', {
        method: 'POST',
        body: JSON.stringify({ store: { externalId: releve.externalId, host: boutique.host, label: releve.label }, catalog: releve.catalogue, details: releve.fiches }),
      });
      totaux.versees += 1;
      totaux.surveillances += reponse.watches ?? 0;
      totaux.reprises += reponse.resumed ?? 0;
      totaux.evenements += reponse.events ?? 0;
      totaux.lancements += reponse.launched ?? 0;
      verse = ` · versée${reponse.watches ? ` (${reponse.watches} surveillance${reponse.watches > 1 ? 's' : ''}, ${reponse.events} événement${reponse.events > 1 ? 's' : ''})` : ''}`;
    }
    const ventesLues = publiees.length ? `${ventes} ventes cumulées sur ${publiees.length}` : 'ventes masquées par la boutique';
    console.log(`${heure()} #${rang + 1} ${boutique.reason} · ${releve.enVente} produit(s) en vente · ${lues.length} fiche(s), ${ventesLues}${verse} · ${Math.round((Date.now() - debut) / 1000)} s · ${totaux.credits}/${budget} crédits`);
  } catch (error) {
    totaux.echecs += 1;
    const motif = String(error instanceof Error ? error.message : error).slice(0, 80);
    motifs[motif] = (motifs[motif] ?? 0) + 1;
    console.warn(`${heure()} #${rang + 1} ${boutique.reason} · non relevée : ${motif}`);
    if (error instanceof Refus) {
      refusDeSuite += 1;
      if (refusDeSuite >= REFUS_AVANT_ARRET) arret = `la plateforme refuse aussi Firecrawl (${REFUS_AVANT_ARRET} boutiques de suite : ${motif})`;
    } else {
      refusDeSuite = 0;
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Le passage                                                                */
/* -------------------------------------------------------------------------- */

const restants = await creditsRestants();
budget = Math.max(0, Math.min(PLAFOND_CREDITS, (Number.isFinite(restants) ? restants : PLAFOND_CREDITS + RESERVE) - RESERVE));
console.log(`${heure()} ${ESSAI ? 'ESSAI (rien n’est versé) · ' : ''}crédits restants : ${Number.isFinite(restants) ? restants : '?'} · ce passage : ${budget}`);

/** --raisons=surveillance : seulement les boutiques que des clients surveillent (après un ajout, par exemple). */
const RAISONS = option('raisons', null);
const plan = await site('/api/cron/vitrines?limite=1000');
const stores = RAISONS ? plan.stores.filter((s) => String(RAISONS).split(',').includes(s.reason)) : plan.stores;
const parRaison = stores.reduce((compte, s) => ({ ...compte, [s.reason]: (compte[s.reason] ?? 0) + 1 }), {});
console.log(`${heure()} plan : ${stores.length} boutique(s) · ${Object.entries(parRaison).map(([r, n]) => `${n} ${r}`).join(' · ')}`);

let suivant = 0;
const ouvrierDeBoutiques = async () => {
  // Une boutique ne s'entame que s'il reste de quoi lire au moins son catalogue et une fiche.
  while (!arret && suivant < stores.length && budget - totaux.credits >= 2) {
    const rang = suivant;
    suivant += 1;
    await traiter(stores[rang], rang);
  }
};
await Promise.all(Array.from({ length: CONCURRENCE }, ouvrierDeBoutiques));

const resteAuPlan = Math.max(0, stores.length - suivant);
if (!ESSAI) {
  const fin = await site('/api/cron/vitrines', {
    method: 'POST',
    body: JSON.stringify({ done: true, summary: { indexed: totaux.versees, failed: totaux.echecs, remaining: resteAuPlan, reasons: motifs } }),
  }).catch((error) => {
    console.warn(`${heure()} clôture non reçue : ${error instanceof Error ? error.message : error}`);
    return null;
  });
  if (fin) console.log(`${heure()} alertes créées à la clôture : ${fin.alertes ?? '?'}`);
}

console.log(
  `${heure()} FIN${arret ? ` (${arret})` : ''} · ${totaux.boutiques} boutique(s) relevée(s), ${totaux.versees} versée(s), ${totaux.echecs} en échec, ${resteAuPlan} au plan · ` +
    `${totaux.produits} produits en vente, ${totaux.fiches} fiches lues dont ${totaux.fichesAvecVentes} avec ventes publiées (${totaux.ventes} ventes cumulées) · ` +
    `${totaux.surveillances} surveillance(s) mise(s) à jour, ${totaux.reprises} reprise(s), ${totaux.evenements} événement(s), ${totaux.lancements} lancement(s) · ${totaux.credits} crédits`,
);
if (Object.keys(motifs).length) console.log(`${heure()} motifs : ${JSON.stringify(motifs)}`);
