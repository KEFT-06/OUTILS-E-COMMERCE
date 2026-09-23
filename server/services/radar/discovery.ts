import { desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { discoveredStores, spiedAds } from '@server/db/schema';
import { env, providers } from '@server/env';
import { AppError } from '@server/middleware';
import { readMetaAd } from '@server/services/espionnage/parse';

/**
 * Découverte de boutiques : trouver des concurrents qu'on ne connaît pas encore.
 *
 * C'est la seule chose que la lecture des vitrines ne sait pas faire. Lire une vitrine
 * demande de connaître son adresse ; ici on part du fait que toute publicité d'une boutique
 * Chariow mène à un lien « …mychariow… ». Chercher ce mot dans la bibliothèque publicitaire
 * rend donc la liste des vendeurs de la plateforme qui font de la publicité en ce moment.
 *
 * Trois décisions qui tiennent au coût, parce que ce service-là se paie au résultat :
 *
 *  1. Le résultat est MUTUALISÉ. Chercher les vendeurs d'une plateforme donne la même
 *     réponse pour tout le monde : une table partagée, pas une par compte. La dépense
 *     dépend du rythme de rafraîchissement, jamais du nombre d'utilisateurs.
 *  2. Aucun utilisateur ne déclenche de passage payant. Ils lisent le cache ; seul le
 *     serveur (ou un administrateur) lance une collecte.
 *  3. On n'extrait pas un champ nommé, on cherche les hôtes « …mychariow… » dans tout
 *     l'enregistrement. Un fournisseur qui renomme ses colonnes ne casse donc rien —
 *     et il n'y a rien à deviner sur un format qu'on ne contrôle pas.
 *
 * UN SEUL passage alimente deux écrans : les boutiques repérées ci-dessous, et le mur
 * d'espionnage (`services/espionnage`), qui garde les annonces elles-mêmes. Collecter deux fois
 * les mêmes publicités paierait deux fois la même donnée.
 *
 * Des annonces, on conserve le texte, le titre, l'adresse de destination et l'aperçu du visuel —
 * ce qu'un annonceur diffuse publiquement pour être vu. Ni la vidéo, ni l'image ne sont
 * réhébergées : seules leurs adresses, que chaque passage rafraîchit puisque Meta les signe.
 */

const TIMEOUT_MS = 180_000;
/** Hôtes de vitrine, tels qu'ils apparaissent dans les liens des publicités. */
const STOREFRONT_HOST = /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.mychariow\.(?:com|shop)\b/gi;
/** Sous-domaines techniques de la plateforme : ce ne sont pas des boutiques. */
const NOT_A_STORE = new Set(['www', 'api', 'api-edge', 'app', 'cdn', 'images', 'assets', 'static']);

export interface DiscoveredStore {
  host: string;
  label: string | null;
  adCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface DiscoveryOutcome {
  /** Publicités examinées : c'est CE nombre qui est facturé par le fournisseur. */
  adsExamined: number;
  storesFound: number;
  storesNew: number;
  /** Annonces retenues pour le mur d'espionnage : celles qui mènent vraiment à la plateforme. */
  adsKept: number;
}

const apifyUnavailable = (detail: string) =>
  new AppError(502, `La découverte de boutiques n’a pas abouti (${detail}).`, 'RADAR_DISCOVERY_UNAVAILABLE');

/** Liste mutualisée, du plus vu au moins vu. Gratuite : c'est du cache. */
export async function listDiscoveredStores(limit = 100): Promise<DiscoveredStore[]> {
  const rows = await getDb()
    .select()
    .from(discoveredStores)
    .orderBy(desc(discoveredStores.adCount), desc(discoveredStores.lastSeenAt))
    .limit(Math.min(Math.max(limit, 1), 300));

  return rows.map((row) => ({
    host: row.host,
    label: row.label,
    adCount: row.adCount,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }));
}

/** Date de la dernière collecte, pour savoir si une nouvelle est due. */
export async function lastDiscoveryAt(): Promise<Date | null> {
  const [row] = await getDb()
    .select({ at: sql<Date | null>`max(${discoveredStores.lastSeenAt})` })
    .from(discoveredStores);
  return row?.at ? new Date(row.at) : null;
}

/**
 * Adresse de recherche de la bibliothèque publicitaire. `country=ALL` et `ad_type=all` :
 * l'API officielle de Meta ne rend les publicités commerciales que pour l'Union européenne
 * et le Royaume-Uni — c'est justement pourquoi on passe par une collecte de la page publique.
 */
function adLibraryUrl(query: string): string {
  const params = new URLSearchParams({
    active_status: 'active',
    ad_type: 'all',
    country: 'ALL',
    q: query,
    search_type: 'keyword_unordered',
    media_type: 'all',
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

const datasetItemSchema = z.array(z.unknown());

/**
 * Lance une collecte et met la liste à jour. À n'appeler que depuis le planificateur ou une
 * route d'administration : chaque passage engage de l'argent réel.
 */
export async function runDiscovery(now = new Date()): Promise<DiscoveryOutcome> {
  if (!providers.apify) {
    throw new AppError(
      503,
      'La découverte de boutiques n’est pas configurée sur ce serveur (jeton Apify absent).',
      'RADAR_DISCOVERY_NOT_CONFIGURED',
    );
  }

  const url =
    `${env.APIFY_API_URL.replace(/\/+$/, '')}/acts/${env.APIFY_ADS_ACTOR}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(env.APIFY_TOKEN!)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        startUrls: [{ url: adLibraryUrl(env.RADAR_DISCOVERY_QUERY) }],
        // Plafond facturé : la borne du coût, pas une préférence d'affichage.
        resultsLimit: env.RADAR_DISCOVERY_LIMIT,
        activeStatus: 'active',
        /*
          « total_impressions » et non « most recent » : mesuré le 23/09/2026, l'acteur REFUSE
          toute autre valeur que "", "total_impressions" ou "relevancy_monthly_grouped", et
          répond 400 « Input is not valid ». Chaque collecte échouait donc en silence.
          Trier par impressions sert aussi le propos : les plus gros annonceurs d'abord.
        */
        sorting: 'total_impressions',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw apifyUnavailable(error instanceof Error && error.name === 'TimeoutError' ? 'délai dépassé' : 'réseau');
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError(502, 'Le jeton Apify est refusé : vérifiez-le dans la configuration.', 'RADAR_DISCOVERY_DENIED');
  }
  if (response.status === 402) {
    throw new AppError(
      503,
      'La réserve mensuelle Apify est épuisée : la découverte reprendra au prochain cycle, ou après un rechargement.',
      'RADAR_DISCOVERY_OUT_OF_CREDIT',
    );
  }
  if (!response.ok) throw apifyUnavailable(`réponse ${response.status}`);

  let items: unknown[];
  try {
    items = datasetItemSchema.parse(await response.json());
  } catch {
    throw apifyUnavailable('réponse illisible');
  }

  // On ne lit aucun champ nommé : on cherche les hôtes de vitrine dans l'enregistrement
  // entier. Le fournisseur peut renommer ses colonnes sans rien casser ici.
  const comptes = new Map<string, number>();
  for (const item of items) {
    const texte = JSON.stringify(item);
    const vus = new Set<string>();
    for (const match of texte.matchAll(STOREFRONT_HOST)) {
      const sous = (match[1] ?? '').toLowerCase();
      if (NOT_A_STORE.has(sous)) continue;
      // `.shop` et `.com` désignent la même boutique : on retient une seule forme.
      vus.add(`${sous}.mychariow.com`);
    }
    // Une publicité qui cite deux fois la même boutique ne compte qu'une fois.
    for (const host of vus) comptes.set(host, (comptes.get(host) ?? 0) + 1);
  }

  let storesNew = 0;
  for (const [host, adCount] of comptes) {
    const [row] = await getDb()
      .insert(discoveredStores)
      .values({ host, adCount, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: discoveredStores.host,
        set: { adCount, lastSeenAt: now },
      })
      .returning({ firstSeenAt: discoveredStores.firstSeenAt });
    if (row && row.firstSeenAt.getTime() === now.getTime()) storesNew += 1;
  }

  /*
    Le même passage alimente les deux écrans : les boutiques repérées du Radar et le mur
    d'espionnage. Une seconde collecte pour les mêmes annonces paierait deux fois la même donnée.
  */
  let adsKept = 0;
  for (const item of items) {
    const annonce = readMetaAd(item, now);
    if (!annonce) continue;
    await getDb()
      .insert(spiedAds)
      .values(annonce)
      .onConflictDoUpdate({
        target: spiedAds.externalId,
        // Les adresses de visuel signées par Meta expirent : chaque passage les rafraîchit.
        set: {
          storeHost: annonce.storeHost,
          landingUrl: annonce.landingUrl,
          title: annonce.title,
          bodyText: annonce.bodyText,
          advertiser: annonce.advertiser,
          mediaUrl: annonce.mediaUrl,
          mediaKind: annonce.mediaKind,
          startedAt: annonce.startedAt,
          variants: annonce.variants,
          platforms: annonce.platforms,
          active: annonce.active,
          lastSeenAt: now,
        },
      });
    adsKept += 1;
  }

  return { adsExamined: items.length, storesFound: comptes.size, storesNew, adsKept };
}

/** Vrai si une collecte est due, selon le rythme configuré. */
export async function discoveryIsDue(now = new Date()): Promise<boolean> {
  if (!providers.apify) return false;
  const dernier = await lastDiscoveryAt();
  if (dernier === null) return true;
  return now.getTime() - dernier.getTime() >= env.RADAR_DISCOVERY_INTERVAL_HOURS * 3_600_000;
}
