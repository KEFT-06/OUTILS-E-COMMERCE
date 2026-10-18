import { and, asc, eq, isNotNull, isNull, lt, max, or, sql } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { spiedAds, spiedPages } from '@server/db/schema';
import { env } from '@server/env';
import { recordAudit } from '@server/services/audit';
import { DISCOVERY_AUDIT_ACTION, discoveryQueries, ingestDiscoveryItems, type DiscoveryOutcome } from '@server/services/radar/discovery';

/**
 * Collecteur maison : la bibliothèque publicitaire publique, lue par un navigateur piloté
 * (dossier `collecteur/`, Crawlee + Playwright) au lieu d'être achetée au résultat.
 *
 * Mesuré le 04/10/2026 depuis un poste ordinaire : 128 annonces en 40 secondes, sans compte et
 * sans frais, là où la collecte payante en ramène 200 pour un dollar. Le navigateur ne peut pas
 * tourner dans une fonction de l'hébergeur : il tourne ailleurs (poste du propriétaire, tâche
 * planifiée) et VERSE ce qu'il lit par l'adresse `/api/cron/collecte`, protégée par le secret
 * du planificateur. Le reste du chemin est celui de la collecte payante, à l'identique.
 */

const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

/**
 * La bibliothèque nomme ses champs en « snake_case » (`ad_archive_id`, `link_url`) ; la lecture
 * des annonces attend la forme « camelCase » que rend la collecte payante. Mêmes champs, autre
 * écriture : on convertit les clés, sans toucher aux valeurs.
 */
export function fromLibraryRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromLibraryRecord);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [camel(key), fromLibraryRecord(entry)]));
}

/** Verse un lot d'annonces lues par le collecteur. `country` : pays de la recherche, ou null. */
export async function ingestLibraryRecords(records: unknown[], country: string | null, now = new Date()): Promise<DiscoveryOutcome> {
  return ingestDiscoveryItems(records.map(fromLibraryRecord), now, country);
}

/**
 * Inscrit le passage du collecteur au journal, comme une collecte payante : la collecte payante
 * hebdomadaire n'a plus lieu d'être tant que le collecteur passe, et sa date sert à l'écran.
 */
export async function recordCollectorRun(details: Record<string, unknown>): Promise<void> {
  await recordAudit({
    actor: { id: null, email: 'collecteur@maison' },
    action: DISCOVERY_AUDIT_ACTION,
    details: { source: 'collecteur', ...details },
    client: { ipAddress: null, userAgent: null },
  });
}

const JOUR_MS = 86_400_000;
/** Annonceurs remis au plus par plan : bien au-delà de ce qu'un mois de crédits Firecrawl peut lire. */
const ADVERTISERS_MAX = 3_000;
/** Une page d'annonceur lue n'est pas remise au collecteur avant ce délai. */
const PAGE_REREAD_DAYS = 15;

/** Retient qu'une page d'annonceur vient d'être lue en entier : elle sort du plan pour quinze jours. */
export async function markPageRead(pageId: string, ads: number, now = new Date()): Promise<void> {
  await getDb()
    .insert(spiedPages)
    .values({ pageId, readAt: now, ads })
    .onConflictDoUpdate({ target: spiedPages.pageId, set: { readAt: now, ads } });
}

/**
 * Ce que le collecteur doit faire à son prochain passage : mots-clés, pays, et annonces
 * installées à contrôler une à une (en cours depuis longtemps, mais pas revues récemment) —
 * c'est ce contrôle qui permet de dire qu'une publicité s'est ARRÊTÉE, au lieu de le supposer.
 */
export async function collectorPlan(now = new Date()) {
  const anciennes = await getDb()
    .select({ externalId: spiedAds.externalId })
    .from(spiedAds)
    .where(
      and(
        eq(spiedAds.active, true),
        isNotNull(spiedAds.startedAt),
        lt(spiedAds.startedAt, new Date(now.getTime() - env.ALERT_AD_MIN_DAYS * JOUR_MS)),
        lt(spiedAds.lastSeenAt, new Date(now.getTime() - 2 * JOUR_MS)),
      ),
    )
    .orderBy(asc(spiedAds.lastSeenAt))
    .limit(60);

  /*
    Annonceurs du mur, les plus récemment vus d'abord. Leur page de la bibliothèque montre TOUTES
    leurs publicités, en cours et passées — celles qu'aucune recherche par mot-clé ne fait remonter.
    Mesuré le 18/10/2026 : une page d'annonceur lue par Firecrawl rend 17 annonces, toutes vers sa
    boutique, quand les recherches par mot-clé ne rapportaient plus qu'une annonce nouvelle par crédit.
  */
  /*
    Ordre : jamais lus d'abord, puis lus il y a le plus longtemps ; à égalité, ceux dont on n'a rien
    revu depuis le plus longtemps. Une page lue depuis moins de quinze jours n'est pas remise : ses
    annonces viennent d'entrer au mur, la relire ne rapporterait rien (mesuré le 18/10/2026).
  */
  const relue = new Date(now.getTime() - PAGE_REREAD_DAYS * JOUR_MS);
  const annonceurs = await getDb()
    .select({ pageId: spiedAds.pageId })
    .from(spiedAds)
    .leftJoin(spiedPages, eq(spiedPages.pageId, spiedAds.pageId))
    .where(and(isNotNull(spiedAds.pageId), or(isNull(spiedPages.readAt), lt(spiedPages.readAt, relue))))
    .groupBy(spiedAds.pageId, spiedPages.readAt)
    .orderBy(sql`${spiedPages.readAt} asc nulls first`, asc(max(spiedAds.lastSeenAt)))
    .limit(ADVERTISERS_MAX);

  return {
    queries: discoveryQueries(),
    countries: env.SPY_COLLECT_COUNTRIES,
    maxPerQuery: env.SPY_COLLECT_MAX_PER_QUERY,
    /*
      Boutiques des autres plateformes (Maketou, Shopify). Cherchées seulement dans les pays
      visés : « myshopify » tous pays confondus ramènerait le monde entier. Plafond plus bas,
      pour que le mur reste celui de ces marchés et que ses aperçus tiennent dans le stockage.
    */
    extra: { queries: env.SPY_COLLECT_EXTRA_QUERIES, countries: env.SPY_COLLECT_EXTRA_COUNTRIES, maxPerQuery: env.SPY_COLLECT_EXTRA_MAX },
    toVerify: anciennes.map((row) => row.externalId),
    advertisers: annonceurs.flatMap((row) => (row.pageId ? [row.pageId] : [])),
  };
}
