import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { discoveredStores, spiedAds, users, watches } from '@server/db/schema';
import { indexStoreCatalog, normalHost } from '@server/services/market';
import { applyObservations } from '@server/services/radar/sweep';
import type { RadarObservation } from '@server/services/radar/types';

/**
 * Relevés des vitrines faits HORS du serveur, par le collecteur (collecteur/vitrines.mjs), qui lit
 * les pages par Firecrawl et les verse ici.
 *
 * Depuis le 11/10/2026, la plateforme Chariow refuse le serveur du site : plus aucune vente
 * relevée, plus aucune alerte de vente, et les surveillances des clients se sont mises en pause
 * l'une après l'autre (cinq échecs de suite). Le propriétaire a décidé le 18/10/2026 de lire les
 * vitrines par Firecrawl. Le serveur le fait de lui-même quand la clé lui est donnée ; le
 * collecteur, lui, permet un grand passage d'un coup, depuis un poste, sur les crédits du mois.
 *
 * Ce qui est versé est traité exactement comme un relevé du serveur : index du marché (ventes du
 * jour, lancements, arrêts), puis chaque surveillance de la boutique (événements du radar).
 */

const JOUR_MS = 86_400_000;
/** Une boutique relevée depuis moins longtemps n'est pas remise au plan. */
const REREAD_AFTER_MS = 20 * 3_600_000;

export type PlanReason = 'surveillance' | 'publicite' | 'index';

export interface StorefrontPlanEntry {
  /** Identifiant « store_… », ou null : il se lit sur la page de la boutique. */
  externalId: string | null;
  host: string;
  label: string | null;
  /** Pourquoi elle est au plan : un client la surveille, elle fait de la publicité en ce moment, ou son tour est venu. */
  reason: PlanReason;
  /** Publicités en cours vues ces trois derniers jours. */
  activeAds: number;
  /** Dernier relevé connu de son catalogue. */
  readAt: string | null;
}

/**
 * Les boutiques à relever, dans l'ordre où le crédit rapporte le plus :
 *   1. celles que des clients surveillent — c'est ce qu'ils paient ;
 *   2. celles qui font de la publicité en ce moment, les plus actives d'abord — elles vendent
 *      maintenant, et ce sont leurs ventes que montrent le mur et la concurrence d'une niche ;
 *   3. les autres, les plus anciennement relevées d'abord.
 * Une boutique relevée il y a moins de vingt heures n'y est pas.
 */
export async function storefrontPlan(now = new Date(), limit = 500): Promise<StorefrontPlanEntry[]> {
  const db = getDb();
  const seuil = new Date(now.getTime() - REREAD_AFTER_MS);
  const recent = new Date(now.getTime() - 3 * JOUR_MS).toISOString();

  /*
    Surveillances de comptes actifs : en cours, ou mises en pause par les refus de la plateforme.
    Une boutique suivie par plusieurs comptes est due dès que L'UNE de ses surveillances l'est : le
    plus ancien passage compte, pas le plus récent.
  */
  const surveillees = await db
    .select({
      externalId: watches.externalId,
      url: sql<string | null>`max(${watches.url})`,
      label: sql<string>`max(${watches.label})`,
      sweptAt: sql<Date | string | null>`min(${watches.lastSweptAt})`,
      jamais: sql<boolean>`bool_or(${watches.lastSweptAt} is null)`,
    })
    .from(watches)
    .innerJoin(users, eq(users.id, watches.userId))
    .where(and(eq(watches.source, 'chariow_store'), eq(users.status, 'active')))
    .groupBy(watches.externalId);

  const plan: StorefrontPlanEntry[] = [];
  const hotes = new Set<string>();
  for (const row of surveillees) {
    const sweptAt = row.jamais || !row.sweptAt ? null : new Date(row.sweptAt);
    if (sweptAt && sweptAt >= seuil) continue;
    const host = row.url ? normalHost(row.url) : null;
    if (!host) continue;
    hotes.add(host);
    plan.push({ externalId: row.externalId, host, label: row.label, reason: 'surveillance', activeAds: 0, readAt: sweptAt?.toISOString() ?? null });
  }

  const pubs = db
    .select({ host: spiedAds.storeHost, actives: sql<number>`count(*) filter (where ${spiedAds.active} and ${spiedAds.lastSeenAt} >= ${recent}::timestamptz)`.as('actives') })
    .from(spiedAds)
    .groupBy(spiedAds.storeHost)
    .as('pubs');
  const actives = sql<number>`coalesce(${pubs.actives}, 0)`;
  const reperees = await db
    .select({ store: discoveredStores, actives })
    .from(discoveredStores)
    .leftJoin(pubs, eq(pubs.host, discoveredStores.host))
    .where(or(isNull(discoveredStores.indexedAt), lt(discoveredStores.indexedAt, seuil)))
    .orderBy(sql`case when ${actives} > 0 then 0 else 1 end`, desc(actives), sql`${discoveredStores.indexedAt} asc nulls first`, desc(discoveredStores.lastSeenAt))
    .limit(limit);

  for (const { store, actives: enCours } of reperees) {
    const host = normalHost(store.host);
    if (hotes.has(host) || !/\.mychariow\.com$/.test(host)) continue;
    hotes.add(host);
    const activeAds = Number(enCours);
    plan.push({ externalId: store.storeExternalId, host, label: store.label, reason: activeAds > 0 ? 'publicite' : 'index', activeAds, readAt: store.indexedAt?.toISOString() ?? null });
  }
  return plan.slice(0, limit);
}

export interface StorefrontIngestOutcome {
  products: number;
  launched: number;
  /** Surveillances de clients mises à jour par ce relevé. */
  watches: number;
  /** Surveillances remises en route : elles s'étaient mises en pause sur les refus de la plateforme. */
  resumed: number;
  /** Événements écrits au fil du radar de ces surveillances (nouveautés, arrêts, prix, ventes). */
  events: number;
}

/**
 * Verse le relevé COMPLET d'une boutique (toutes les pages de son catalogue) : un catalogue à
 * moitié lu ferait passer pour arrêtés les produits des pages manquantes.
 */
export async function ingestStorefrontReading(
  store: { externalId: string; host: string; label: string | null },
  observations: RadarObservation[],
  now = new Date(),
): Promise<StorefrontIngestOutcome> {
  const db = getDb();
  const host = normalHost(store.host);
  const externalId = store.externalId.toLowerCase();
  const { launched } = await indexStoreCatalog({ externalId, host, label: store.label }, observations, now);
  await db.update(discoveredStores).set({ storeExternalId: externalId, indexedAt: now }).where(eq(discoveredStores.host, host));

  const suivies = await db
    .select({ watch: watches })
    .from(watches)
    .innerJoin(users, eq(users.id, watches.userId))
    .where(and(eq(watches.source, 'chariow_store'), eq(watches.externalId, externalId), eq(users.status, 'active')));

  const outcome: StorefrontIngestOutcome = { products: observations.length, launched, watches: 0, resumed: 0, events: 0 };
  for (const { watch } of suivies) {
    const result = await applyObservations(watch, observations, now);
    outcome.watches += 1;
    outcome.events += result.appeared + result.disappeared + result.priceChanged + result.salesJumps;
    /*
      Seuls les refus de la plateforme mettent une surveillance en pause (cinq échecs de suite) :
      la boutique répond de nouveau, la surveillance reprend. applyObservations a déjà remis le
      compte des échecs à zéro.
    */
    if (!watch.active) {
      await db.update(watches).set({ active: true }).where(eq(watches.id, watch.id));
      outcome.resumed += 1;
    }
  }
  return outcome;
}
