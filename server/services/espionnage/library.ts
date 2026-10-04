import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { spiedAds } from '@server/db/schema';
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

  return {
    queries: discoveryQueries(),
    countries: env.SPY_COLLECT_COUNTRIES,
    maxPerQuery: env.SPY_COLLECT_MAX_PER_QUERY,
    toVerify: anciennes.map((row) => row.externalId),
  };
}
