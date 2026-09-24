import { desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { auditLogs, discoveredStores, spiedAds } from '@server/db/schema';
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

  /*
    Le passage est inscrit AVANT l'appel, et non après son succès.

    Ce qui décide du rythme, c'est la dépense engagée, pas le résultat obtenu. Inscrire après
    coup laissait une collecte infructueuse redevenir « due » le lendemain, et se refacturer
    tous les jours au lieu d'une fois par mois.

    Le risque retenu en échange est assumé et bien moindre : si l'appel échoue avant d'avoir
    rien coûté — panne réseau, jeton refusé — le rythme aura tout de même avancé, et la
    prochaine collecte attendra son tour. On perd un passage ; l'inverse perdait de l'argent.
  */
  await recordAudit({
    actor: SYSTEM_ACTOR,
    action: DISCOVERY_AUDIT_ACTION,
    details: { query: env.RADAR_DISCOVERY_QUERY, resultsLimit: env.RADAR_DISCOVERY_LIMIT, actor: env.APIFY_ADS_ACTOR },
    client: { ipAddress: null, userAgent: null },
  });

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
  const annonces = items.map((item) => readMetaAd(item, now)).filter((annonce) => annonce !== null);

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
          startedAt: sql`excluded.started_at`,
          variants: sql`excluded.variants`,
          platforms: sql`excluded.platforms`,
          active: sql`excluded.active`,
          lastSeenAt: now,
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
