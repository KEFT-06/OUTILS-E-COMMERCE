import { and, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { adCollectionRuns, auditLogs, discoveredStores, spiedAds } from '@server/db/schema';
import { env, providers } from '@server/env';
import { AppError } from '@server/middleware';
import { recordAudit } from '@server/services/audit';
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

/** Délai d'un appel à l'API d'Apify (lancer, suivre, lire) : aucun n'attend la fin d'un passage. */
const TIMEOUT_MS = 30_000;
/**
 * Hôtes de vitrine, tels qu'ils apparaissent dans les liens des publicités, quelle que soit
 * l'extension : .com, .shop, mais aussi .store, .online, .market (mesuré le 28/09/2026).
 */
const STOREFRONT_HOST = /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.mychariow\.[a-z]{2,12}\b/gi;
/**
 * Attente de la fin des passages dans la requête qui les lance. Un petit passage finit vite et
 * l'administrateur voit son résultat tout de suite ; un gros est récolté plus tard.
 */
const WAIT_FOR_RUNS_MS = 45_000;
const POLL_EVERY_MS = 5_000;
/** Un passage qui n'a pas fini en six heures est abandonné (l'acteur en prend quelques minutes). */
const RUN_STALE_MS = 6 * 3_600_000;
/** Annonceurs relevés page par page : ceux vus dans les soixante derniers jours. */
const ADVERTISER_WINDOW_MS = 60 * 24 * 3_600_000;
/** Sous-domaines techniques de la plateforme : ce ne sont pas des boutiques. */
const NOT_A_STORE = new Set(['www', 'api', 'api-edge', 'app', 'cdn', 'images', 'assets', 'static']);

export interface DiscoveredStore {
  /** Publicités de la boutique vues en cours au dernier contrôle du mur. */
  activeAds: number;
  adsCheckedAt: string | null;
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
  /** Passages encore en cours chez Apify : leur résultat sera récolté plus tard. */
  pending?: number;
}

const EMPTY_OUTCOME: DiscoveryOutcome = { adsExamined: 0, storesFound: 0, storesNew: 0, adsKept: 0, pending: 0 };

const addOutcomes = (a: DiscoveryOutcome, b: DiscoveryOutcome): DiscoveryOutcome => ({
  adsExamined: a.adsExamined + b.adsExamined,
  storesFound: a.storesFound + b.storesFound,
  storesNew: a.storesNew + b.storesNew,
  adsKept: a.adsKept + b.adsKept,
  pending: b.pending ?? 0,
});

const apifyUnavailable = (detail: string) =>
  new AppError(502, `La découverte de boutiques n’a pas abouti (${detail}).`, 'RADAR_DISCOVERY_UNAVAILABLE');

/** Liste mutualisée, du plus vu au moins vu. Gratuite : c'est du cache. */
export async function listDiscoveredStores(limit = 100): Promise<DiscoveredStore[]> {
  const rows = await getDb()
    .select()
    .from(discoveredStores)
    .orderBy(desc(discoveredStores.adCount), desc(discoveredStores.lastSeenAt))
    .limit(Math.min(Math.max(limit, 1), 300));

  // Publicités réellement en cours, lues sur le mur : `adCount` n'est qu'un cumul d'apparitions.
  const hosts = rows.map((row) => row.host);
  const enCours =
    hosts.length === 0
      ? []
      : await getDb()
          .select({ host: spiedAds.storeHost, total: sql<number>`count(*) filter (where ${spiedAds.active})`, checkedAt: sql<Date | null>`max(${spiedAds.lastSeenAt})` })
          .from(spiedAds)
          .where(inArray(spiedAds.storeHost, hosts))
          .groupBy(spiedAds.storeHost);
  const parBoutique = new Map(enCours.map((row) => [row.host, row]));

  return rows.map((row) => ({
    host: row.host,
    label: row.label,
    adCount: row.adCount,
    activeAds: Number(parBoutique.get(row.host)?.total ?? 0),
    adsCheckedAt: parBoutique.get(row.host)?.checkedAt ? new Date(parBoutique.get(row.host)!.checkedAt!).toISOString() : null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }));
}

/** Action inscrite au journal à chaque collecte lancée, qu'elle rapporte quelque chose ou non. */
const DISCOVERY_AUDIT_ACTION = 'radar.discovery.run';

/** Le planificateur n'est pas une personne : aucune ligne du journal ne doit lui en prêter une. */
const SYSTEM_ACTOR = { id: null, email: 'radar@planificateur' } as const;

/**
 * Date de la dernière collecte LANCÉE — et non de la dernière qui a rapporté quelque chose.
 *
 * La distinction vaut de l'argent. Cette date se lisait auparavant sur le dernier passage
 * ayant écrit une boutique. Une collecte qui ne trouve rien — mot-clé sans résultat, champ
 * renommé chez le fournisseur, acteur interrompu en cours de route — n'écrivait donc aucune
 * date, et la collecte redevenait « due » au réveil suivant. Elle était relancée, et
 * facturée, chaque jour, alors que le rythme voulu est mensuel : trente fois le prix, et
 * précisément le jour où le service ne marche pas.
 *
 * Le journal d'audit tranche, parce qu'un passage payant chez un tiers y a sa place de
 * toute façon : sans lui, une dépense qui ne rapporte rien ne laisse aucune trace.
 *
 * Le repli sur `discoveredStores` sert les serveurs dont l'historique est antérieur à ce
 * correctif : sans lui, ils relanceraient une collecte immédiatement après la mise à jour.
 */
export async function lastDiscoveryAt(): Promise<Date | null> {
  const [journal] = await getDb()
    .select({ at: auditLogs.createdAt })
    .from(auditLogs)
    .where(eq(auditLogs.action, DISCOVERY_AUDIT_ACTION))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  if (journal?.at) return journal.at;

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
export function adLibraryUrl(query: string, country = 'ALL'): string {
  const params = new URLSearchParams({
    active_status: 'active',
    ad_type: 'all',
    country,
    q: query,
    search_type: 'keyword_unordered',
    media_type: 'all',
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

/** Toutes les annonces en cours d'un annonceur, par l'identifiant de sa page Facebook. */
function advertiserPageUrl(pageId: string): string {
  const params = new URLSearchParams({
    active_status: 'active',
    ad_type: 'all',
    country: 'ALL',
    view_all_page_id: pageId,
    search_type: 'page',
    media_type: 'all',
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

/** Mots-clés configurés, sans doublon ni vide ; cinq au plus, chacun étant facturé. */
export function discoveryQueries(): string[] {
  const queries = env.RADAR_DISCOVERY_QUERY.split(',').map((query) => query.trim()).filter((query) => query.length >= 2);
  return [...new Set(queries)].slice(0, 5);
}

/** Les annonceurs les plus actifs du mur ces soixante derniers jours : ceux qu'on relève en entier. */
async function topAdvertiserPages(limit: number, now: Date): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await getDb()
    .select({ pageId: spiedAds.pageId, ads: sql<number>`count(*)` })
    .from(spiedAds)
    .where(and(isNotNull(spiedAds.pageId), gt(spiedAds.lastSeenAt, new Date(now.getTime() - ADVERTISER_WINDOW_MS))))
    .groupBy(spiedAds.pageId)
    .orderBy(desc(sql`count(*)`), desc(sql`max(${spiedAds.lastSeenAt})`))
    .limit(limit);
  return rows.flatMap((row) => (row.pageId && /^\d{5,30}$/.test(row.pageId) ? [row.pageId] : []));
}

export const apifyUrl = (path: string, query = '') =>
  `${env.APIFY_API_URL.replace(/\/+$/, '')}${path}?token=${encodeURIComponent(env.APIFY_TOKEN!)}${query}`;

/** Appel à l'API d'Apify ; les refus de compte deviennent des erreurs lisibles. */
export async function apifyFetch(url: string, init: { method?: string; body?: string } = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(init.body ? { body: init.body } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw apifyUnavailable(error instanceof Error && error.name === 'TimeoutError' ? 'délai dépassé' : 'réseau');
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError(502, 'Le service de collecte publicitaire refuse l’accès du serveur : l’administrateur doit vérifier sa configuration.', 'RADAR_DISCOVERY_DENIED');
  }
  if (response.status === 402) {
    throw new AppError(
      503,
      'La réserve mensuelle de collecte publicitaire est épuisée : elle reprendra au prochain cycle.',
      'RADAR_DISCOVERY_OUT_OF_CREDIT',
    );
  }
  if (!response.ok) throw apifyUnavailable(`réponse ${response.status}`);
  return response;
}

export const runSchema = z.object({ data: z.object({ id: z.string().min(1), defaultDatasetId: z.string().min(1), status: z.string().optional() }) });

/**
 * Lance un passage chez Apify SANS l'attendre, et l'inscrit pour la récolte.
 *
 * Il était lancé en mode synchrone, avec trois minutes de patience. Au-delà — et un passage de
 * plusieurs centaines d'annonces les dépasse —, la requête abandonnait, mais le passage, lui,
 * continuait chez Apify, se facturait, et son résultat était perdu.
 */
async function startRun(kind: 'keywords' | 'pages', urls: string[], resultsLimit: number): Promise<void> {
  const response = await apifyFetch(apifyUrl(`/acts/${env.APIFY_ADS_ACTOR}/runs`), {
    method: 'POST',
    body: JSON.stringify({
      startUrls: urls.map((url) => ({ url })),
      // Plafond facturé, PAR ADRESSE : la borne du coût, pas une préférence d'affichage.
      resultsLimit,
      activeStatus: 'active',
      /*
        « total_impressions » et non « most recent » : mesuré le 23/09/2026, l'acteur REFUSE
        toute autre valeur que "", "total_impressions" ou "relevancy_monthly_grouped", et
        répond 400 « Input is not valid ». Trier par impressions sert aussi le propos : les
        plus gros annonceurs d'abord.
      */
      sorting: 'total_impressions',
    }),
  });
  const parsed = runSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw apifyUnavailable('réponse illisible au lancement');
  await getDb()
    .insert(adCollectionRuns)
    .values({ providerRunId: parsed.data.data.id, datasetId: parsed.data.data.defaultDatasetId, kind, urls: urls.length })
    .onConflictDoNothing();
}

export const runStatusSchema = z.object({ data: z.object({ status: z.string() }) });
export const datasetItemSchema = z.array(z.unknown());
export const FAILED_RUN = new Set(['FAILED', 'ABORTED', 'TIMED-OUT', 'TIMED_OUT']);

/**
 * Récolte les passages terminés : leurs annonces rejoignent le mur, leurs boutiques le radar.
 * Appelée par le planificateur, par l'administration, et par le mur lui-même en arrière-plan :
 * un passage fini apparaît donc sans attendre le lendemain.
 */
export async function harvestCollectionRuns(now = new Date()): Promise<DiscoveryOutcome> {
  if (!providers.apify) return { ...EMPTY_OUTCOME };
  const runs = await getDb()
    .select()
    .from(adCollectionRuns)
    .where(eq(adCollectionRuns.status, 'running'))
    .orderBy(adCollectionRuns.startedAt)
    .limit(10);

  let outcome: DiscoveryOutcome = { ...EMPTY_OUTCOME };
  let pending = 0;
  for (const run of runs) {
    try {
      const state = runStatusSchema.safeParse(
        await (await apifyFetch(apifyUrl(`/actor-runs/${encodeURIComponent(run.providerRunId)}`))).json().catch(() => null),
      );
      const status = state.success ? state.data.data.status.toUpperCase() : 'UNKNOWN';

      if (status === 'SUCCEEDED') {
        // Réservé d'abord : deux récoltes simultanées n'écrivent pas deux fois les mêmes annonces.
        const [claimed] = await getDb()
          .update(adCollectionRuns)
          .set({ status: 'harvesting' })
          .where(and(eq(adCollectionRuns.id, run.id), eq(adCollectionRuns.status, 'running')))
          .returning({ id: adCollectionRuns.id });
        if (!claimed) continue;
        const items = datasetItemSchema.safeParse(
          await (await apifyFetch(apifyUrl(`/datasets/${encodeURIComponent(run.datasetId)}/items`, '&clean=true&format=json'))).json().catch(() => null),
        );
        if (!items.success) throw apifyUnavailable('résultat illisible');
        const harvested = await ingestDiscoveryItems(items.data, now);
        outcome = addOutcomes(outcome, harvested);
        await getDb()
          .update(adCollectionRuns)
          .set({ status: 'harvested', adsExamined: harvested.adsExamined, adsKept: harvested.adsKept, finishedAt: new Date() })
          .where(eq(adCollectionRuns.id, run.id));
      } else if (FAILED_RUN.has(status) || now.getTime() - run.startedAt.getTime() > RUN_STALE_MS) {
        await getDb()
          .update(adCollectionRuns)
          .set({ status: 'failed', error: FAILED_RUN.has(status) ? `passage ${status.toLowerCase()} chez Apify` : 'abandonné après six heures', finishedAt: new Date() })
          .where(eq(adCollectionRuns.id, run.id));
      } else {
        pending += 1;
      }
    } catch (error) {
      // Un passage illisible une fois ne bloque pas les autres ; il sera relu au prochain appel.
      await getDb().update(adCollectionRuns).set({ status: 'running' }).where(and(eq(adCollectionRuns.id, run.id), eq(adCollectionRuns.status, 'harvesting')));
      console.warn('[collecte] récolte impossible :', run.providerRunId, error instanceof Error ? error.message : error);
      pending += 1;
    }
  }
  return { ...outcome, pending };
}

/** Passages encore en cours : l'écran peut annoncer que des annonces arrivent. */
export async function pendingCollectionRuns(): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)` }).from(adCollectionRuns).where(eq(adCollectionRuns.status, 'running'));
  return Number(row?.n ?? 0);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lance une collecte : les mots-clés configurés, puis les annonceurs les plus actifs relevés en
 * entier. À n'appeler que depuis le planificateur ou une route d'administration : chaque passage
 * engage de l'argent réel.
 */
export async function runDiscovery(now = new Date()): Promise<DiscoveryOutcome> {
  if (!providers.apify) {
    throw new AppError(
      503,
      'La découverte de boutiques n’est pas configurée sur ce serveur.',
      'RADAR_DISCOVERY_NOT_CONFIGURED',
    );
  }

  const queries = discoveryQueries();
  const pages = await topAdvertiserPages(env.SPY_PAGES_MAX, now);

  /*
    Le passage est inscrit AVANT l'appel, et non après son succès.

    Ce qui décide du rythme, c'est la dépense engagée, pas le résultat obtenu. Inscrire après
    coup laissait une collecte infructueuse redevenir « due » le lendemain, et se refacturer
    tous les jours au lieu d'une fois par semaine.
  */
  await recordAudit({
    actor: SYSTEM_ACTOR,
    action: DISCOVERY_AUDIT_ACTION,
    details: {
      queries,
      resultsLimit: env.RADAR_DISCOVERY_LIMIT,
      pages: pages.length,
      pageAdsLimit: env.SPY_PAGE_ADS_LIMIT,
      actor: env.APIFY_ADS_ACTOR,
    },
    client: { ipAddress: null, userAgent: null },
  });

  await startRun('keywords', queries.map((query) => adLibraryUrl(query)), env.RADAR_DISCOVERY_LIMIT);
  if (pages.length > 0) {
    // Un échec ici ne doit pas annuler la recherche par mots-clés, déjà lancée et payée.
    await startRun('pages', pages.map(advertiserPageUrl), env.SPY_PAGE_ADS_LIMIT).catch((error: unknown) =>
      console.warn('[collecte] relevé des annonceurs non lancé :', error instanceof Error ? error.message : error),
    );
  }

  let outcome = await harvestCollectionRuns(now);
  const deadline = Date.now() + WAIT_FOR_RUNS_MS;
  while ((outcome.pending ?? 0) > 0 && Date.now() + POLL_EVERY_MS < deadline) {
    await sleep(POLL_EVERY_MS);
    outcome = addOutcomes(outcome, await harvestCollectionRuns(now));
  }
  return outcome;
}

/**
 * Écrit dans la base ce qu'un passage a rapporté : boutiques repérées et mur d'espionnage.
 *
 * Séparé de l'appel au fournisseur pour une raison pratique : une collecte est PAYÉE, et il
 * faut pouvoir en reverser le résultat dans une autre base — ou simplement le rejouer après
 * une erreur d'écriture — sans la repayer. `server/scripts/collect-ads.ts --from` emprunte ce
 * chemin, et c'est le MÊME que celui de la collecte réelle : rien n'y est simulé.
 */
/**
 * `country` : pays de la recherche qui a rapporté ces annonces (ISO, ou null pour tous pays). La
 * bibliothèque ne publie les pays de diffusion que pour l'Union européenne ; ailleurs, le seul
 * moyen de savoir où une annonce tourne est de l'avoir trouvée en cherchant dans ce pays.
 */
export async function ingestDiscoveryItems(items: unknown[], now = new Date(), country: string | null = null): Promise<DiscoveryOutcome> {
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

  /*
    Les nouvelles boutiques se comptent en comparant à ce qui existait AVANT l'écriture.

    Le compte se déduisait auparavant de l'égalité entre `firstSeenAt` relu et l'instant du
    passage. PostgreSQL garde les horodatages à la microseconde quand JavaScript s'arrête à la
    milliseconde : un arrondi au retour, et toute boutique nouvelle passait pour ancienne. Un
    chiffre de compte rendu ne doit pas dépendre de la précision d'un type.

    Une lecture avant écriture dit la même chose sans rien supposer.
  */
  const hotes = [...comptes.keys()];
  const connus = new Set(
    hotes.length === 0
      ? []
      : (await getDb().select({ host: discoveredStores.host }).from(discoveredStores).where(inArray(discoveredStores.host, hotes))).map(
          (row) => row.host,
        ),
  );
  const storesNew = hotes.filter((host) => !connus.has(host)).length;

  // Une seule écriture pour toutes les boutiques du passage, au lieu d'une par boutique.
  if (hotes.length > 0) {
    await getDb()
      .insert(discoveredStores)
      .values(hotes.map((host) => ({ host, adCount: comptes.get(host)!, firstSeenAt: now, lastSeenAt: now })))
      .onConflictDoUpdate({
        target: discoveredStores.host,
        // `excluded` désigne la ligne qu'on tentait d'insérer : en écriture groupée, une
        // valeur figée donnerait à toutes les boutiques le compte de la dernière.
        set: { adCount: sql`excluded.ad_count`, lastSeenAt: now },
      });
  }

  /*
    Le même passage alimente les deux écrans : les boutiques repérées du Radar et le mur
    d'espionnage. Une seconde collecte pour les mêmes annonces paierait deux fois la même donnée.
  */
  const pays = country && /^[A-Z]{2}$/.test(country) ? [country] : [];
  const annonces = items
    .map((item) => readMetaAd(item, now))
    .filter((annonce) => annonce !== null)
    .map((annonce) => ({ ...annonce, countries: pays }));

  /*
    Les annonces s'écrivent par paquets, et non une par une.

    Une collecte en rapporte jusqu'à `RADAR_DISCOVERY_LIMIT` — deux cents par défaut. Autant
    d'allers-retours attendus l'un après l'autre coûtaient plusieurs secondes du budget que
    le relevé des boutiques partage avec cette collecte sur un hébergement sans serveur.

    Le paquet reste modeste : une requête qui porte deux cents lignes, chacune avec le texte
    d'une publicité, dépasse ce qu'un pilote accepte de préparer d'un coup.
  */
  const PAQUET = 50;
  for (let debut = 0; debut < annonces.length; debut += PAQUET) {
    await getDb()
      .insert(spiedAds)
      .values(annonces.slice(debut, debut + PAQUET))
      .onConflictDoUpdate({
        target: spiedAds.externalId,
        // Les adresses de visuel signées par Meta expirent : chaque passage les rafraîchit.
        // `excluded` désigne la ligne qu'on tentait d'insérer — indispensable en écriture
        // groupée, où une valeur figée écraserait toutes les lignes par la même.
        set: {
          storeHost: sql`excluded.store_host`,
          landingUrl: sql`excluded.landing_url`,
          title: sql`excluded.title`,
          bodyText: sql`excluded.body_text`,
          advertiser: sql`excluded.advertiser`,
          mediaUrl: sql`excluded.media_url`,
          mediaKind: sql`excluded.media_kind`,
          downloadUrl: sql`coalesce(excluded.download_url, ${spiedAds.downloadUrl})`,
          // Les pays s'ajoutent d'une collecte à l'autre, sans doublon.
          countries: sql`(select coalesce(jsonb_agg(distinct pays), '[]'::jsonb) from jsonb_array_elements_text(${spiedAds.countries} || excluded.countries) as pays)`,
          startedAt: sql`excluded.started_at`,
          variants: sql`excluded.variants`,
          platforms: sql`excluded.platforms`,
          active: sql`excluded.active`,
          // L'arrêt se date au passage qui le constate ; une annonce relancée efface cette date.
          stoppedAt: sql`case when excluded.active then null when ${spiedAds.active} then ${now.toISOString()}::timestamptz else ${spiedAds.stoppedAt} end`,
          lastSeenAt: now,
          pageId: sql`coalesce(excluded.page_id, ${spiedAds.pageId})`,
          pageUrl: sql`coalesce(excluded.page_url, ${spiedAds.pageUrl})`,
          ctaText: sql`excluded.cta_text`,
          displayFormat: sql`excluded.display_format`,
          linkCaption: sql`excluded.link_caption`,
          linkDescription: sql`excluded.link_description`,
          cards: sql`excluded.cards`,
          pageAvatarUrl: sql`coalesce(excluded.page_avatar_url, ${spiedAds.pageAvatarUrl})`,
          impressionsText: sql`excluded.impressions_text`,
          // Nouvelle adresse de visuel : la copie de l'aperçu a de nouveau sa chance.
          thumbnailFailedAt: sql`case when excluded.media_url is distinct from ${spiedAds.mediaUrl} then null else ${spiedAds.thumbnailFailedAt} end`,
        },
      });
  }
  const adsKept = annonces.length;

  return { adsExamined: items.length, storesFound: comptes.size, storesNew, adsKept };
}

/** Vrai si une collecte est due, selon le rythme configuré. */
export async function discoveryIsDue(now = new Date()): Promise<boolean> {
  if (!providers.apify) return false;
  const dernier = await lastDiscoveryAt();
  if (dernier === null) return true;
  return now.getTime() - dernier.getTime() >= env.RADAR_DISCOVERY_INTERVAL_HOURS * 3_600_000;
}
