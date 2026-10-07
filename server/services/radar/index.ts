import { and, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, isUniqueViolation } from '@server/db/client';
import { spiedAds, users, watchEvents, watchItems, watches, type WatchRow } from '@server/db/schema';
import { AppError } from '@server/middleware';
import { adsOfProduct, loadStoreAds, productUrl } from '@server/services/market/productAds';
import { sourceFor } from '@server/services/radar/sources';
import { sweepWatch, type SweepOutcome } from '@server/services/radar/sweep';

/**
 * Radar — surveillances d'un compte.
 *
 * Ce module ne fait pas d'analyse : il tient la liste des cibles, déclenche les relevés et
 * sert ce que le moteur de comparaison a constaté. Le raisonnement reste à l'analyse
 * stratégique, qui est un document daté ; le radar, lui, ne s'arrête jamais et n'écrit
 * jamais dans un rapport déjà remis.
 */

export { applyObservations, sweepWatch } from '@server/services/radar/sweep';
export type { SweepOutcome } from '@server/services/radar/sweep';

export interface WatchSummary {
  id: string;
  label: string;
  url: string | null;
  source: WatchRow['source'];
  active: boolean;
  createdAt: string;
  lastSweptAt: string | null;
  lastError: string | null;
  /** Jours écoulés depuis la mise sous surveillance : l'ancienneté de l'observation. */
  trackedDays: number;
  liveItems: number;
  endedItems: number;
  /** Ventes cumulées de tout ce qui est encore en vente, depuis la création des produits. */
  totalSales: number;
  /** Ventes faites depuis la mise sous surveillance (ou depuis le premier compte lu). */
  trackedSales: number;
  /** Produits en vente dont la source publie le compte de ventes. Zéro : rien à additionner. */
  itemsWithSales: number;
  /** Publicités de cette boutique vues en cours à la dernière collecte du mur. */
  activeAds: number;
  /** Début de la plus ancienne publicité connue de la boutique. null : aucune repérée. */
  firstAdAt: string | null;
  /** Dernier passage de la collecte qui a vu une de ses publicités. */
  adsCheckedAt: string | null;
  unreadEvents: number;
}

/** Hôte d'une vitrine, sous la forme gardée par le mur d'espionnage (toujours en .com). */
export function storeHostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.mychariow\.shop$/, '.mychariow.com');
  } catch {
    return null;
  }
}

interface StoreAds {
  activeAds: number;
  firstAdAt: Date | null;
  checkedAt: Date | null;
}

/** Publicités connues du mur pour ces boutiques : en cours, plus ancienne, dernier contrôle. */
async function adsByStore(hosts: string[]): Promise<Map<string, StoreAds>> {
  if (hosts.length === 0) return new Map();
  const rows = await getDb()
    .select({
      host: spiedAds.storeHost,
      activeAds: sql<number>`count(*) filter (where ${spiedAds.active})`,
      firstAdAt: sql<Date | null>`min(${spiedAds.startedAt})`,
      checkedAt: sql<Date | null>`max(${spiedAds.lastSeenAt})`,
    })
    .from(spiedAds)
    .where(inArray(spiedAds.storeHost, hosts))
    .groupBy(spiedAds.storeHost);
  return new Map(
    rows.map((row) => [
      row.host,
      { activeAds: Number(row.activeAds), firstAdAt: row.firstAdAt ? new Date(row.firstAdAt) : null, checkedAt: row.checkedAt ? new Date(row.checkedAt) : null },
    ]),
  );
}

export interface WatchEventView {
  id: string;
  watchId: string;
  watchLabel: string;
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  read: boolean;
}

const jours = (from: Date, to = new Date()) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));

function ownedWatch(userId: string, watchId: string) {
  return getDb()
    .select()
    .from(watches)
    .where(and(eq(watches.id, watchId), eq(watches.userId, userId)))
    .limit(1);
}

async function requireWatch(userId: string, watchId: string): Promise<WatchRow> {
  const [row] = await ownedWatch(userId, watchId);
  if (!row) throw new AppError(404, 'Cette surveillance n’existe pas sur votre compte.', 'WATCH_NOT_FOUND');
  return row;
}

/**
 * Met une boutique sous surveillance. Le premier relevé part tout de suite : sans lui
 * l'écran resterait vide jusqu'au lendemain, et l'utilisateur croirait à une panne.
 */
export async function addWatch(
  userId: string,
  input: string,
  limit: number | null,
): Promise<{ watch: WatchSummary; firstSweep: SweepOutcome | null }> {
  if (limit === 0) {
    throw new AppError(
      403,
      'Votre palier ne donne pas accès au radar. Passez à un palier supérieur pour surveiller une boutique.',
      'WATCH_LIMIT_REACHED',
      { limit },
    );
  }

  const target = await sourceFor('chariow_store').resolve(input);

  const inserted = await getDb().transaction(async (tx) => {
    if (limit !== null) {
      // Verrou sur le compte, comme pour les niches : sans lui, deux ajouts simultanés
      // comptaient chacun sous la limite et la dépassaient ensemble.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      const [{ total }] = await tx
        .select({ total: count() })
        .from(watches)
        .where(and(eq(watches.userId, userId), eq(watches.active, true)));
      if (Number(total) >= limit) {
        throw new AppError(
          403,
          `Votre palier permet de surveiller ${limit} boutique${limit > 1 ? 's' : ''}. Retirez-en une, ou passez à un palier supérieur.`,
          'WATCH_LIMIT_REACHED',
          { limit },
        );
      }
    }
    try {
      const [row] = await tx
        .insert(watches)
        .values({
          userId,
          source: target.source,
          externalId: target.externalId,
          label: target.label,
          url: target.url,
        })
        .returning();
      return row!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'Vous surveillez déjà cette boutique.', 'WATCH_ALREADY_EXISTS');
      }
      throw error;
    }
  });

  // Le premier relevé ne doit pas faire échouer l'ajout : la surveillance existe, elle
  // portera ses fruits au prochain passage même si la vitrine répond mal maintenant.
  let firstSweep: SweepOutcome | null = null;
  try {
    firstSweep = await sweepWatch(inserted);
  } catch (error) {
    console.warn('[radar] premier relevé impossible :', inserted.label, error instanceof Error ? error.message : error);
  }

  const [summary] = await listWatches(userId, inserted.id);
  return { watch: summary!, firstSweep };
}

/** Surveillances du compte, avec leurs compteurs. Une seule requête, pas une par surveillance. */
export async function listWatches(userId: string, onlyId?: string): Promise<WatchSummary[]> {
  const where = onlyId ? and(eq(watches.userId, userId), eq(watches.id, onlyId)) : eq(watches.userId, userId);

  const rows = await getDb()
    .select({
      id: watches.id,
      label: watches.label,
      url: watches.url,
      source: watches.source,
      active: watches.active,
      createdAt: watches.createdAt,
      lastSweptAt: watches.lastSweptAt,
      lastError: watches.lastError,
      liveItems: sql<number>`count(distinct case when ${watchItems.endedAt} is null then ${watchItems.id} end)`,
      endedItems: sql<number>`count(distinct case when ${watchItems.endedAt} is not null then ${watchItems.id} end)`,
      totalSales: sql<number>`coalesce(sum(case when ${watchItems.endedAt} is null then ${watchItems.salesCount} else 0 end), 0)`,
      trackedSales: sql<number>`coalesce(sum(case when ${watchItems.endedAt} is null then greatest(${watchItems.salesCount} - ${watchItems.salesAtFirstSeen}, 0) else 0 end), 0)`,
      itemsWithSales: sql<number>`count(distinct case when ${watchItems.endedAt} is null and ${watchItems.salesCount} is not null then ${watchItems.id} end)`,
    })
    .from(watches)
    .leftJoin(watchItems, eq(watchItems.watchId, watches.id))
    .where(where)
    .groupBy(watches.id)
    .orderBy(desc(watches.createdAt));

  const unread = await getDb()
    .select({ watchId: watchEvents.watchId, total: count() })
    .from(watchEvents)
    .innerJoin(watches, eq(watches.id, watchEvents.watchId))
    .where(and(eq(watches.userId, userId), isNull(watchEvents.readAt)))
    .groupBy(watchEvents.watchId);
  const unreadByWatch = new Map(unread.map((row) => [row.watchId, Number(row.total)]));
  const ads = await adsByStore(rows.flatMap((row) => storeHostOf(row.url) ?? []));
  const adsOf = (url: string | null) => ads.get(storeHostOf(url) ?? '') ?? null;

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    url: row.url,
    source: row.source,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    lastSweptAt: row.lastSweptAt?.toISOString() ?? null,
    lastError: row.lastError,
    trackedDays: jours(row.createdAt),
    liveItems: Number(row.liveItems),
    endedItems: Number(row.endedItems),
    totalSales: Number(row.totalSales),
    trackedSales: Number(row.trackedSales),
    itemsWithSales: Number(row.itemsWithSales),
    activeAds: adsOf(row.url)?.activeAds ?? 0,
    firstAdAt: adsOf(row.url)?.firstAdAt?.toISOString() ?? null,
    adsCheckedAt: adsOf(row.url)?.checkedAt?.toISOString() ?? null,
    unreadEvents: unreadByWatch.get(row.id) ?? 0,
  }));
}

export async function removeWatch(userId: string, watchId: string): Promise<void> {
  const watch = await requireWatch(userId, watchId);
  // Les articles et les événements partent avec la surveillance (cascade) : l'utilisateur
  // qui retire une boutique ne veut pas en garder l'historique.
  await getDb().delete(watches).where(eq(watches.id, watch.id));
}

/** Fil d'événements du compte, le plus récent d'abord. */
export async function listEvents(userId: string, options: { limit?: number; watchId?: string } = {}): Promise<WatchEventView[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const where = options.watchId
    ? and(eq(watches.userId, userId), eq(watchEvents.watchId, options.watchId))
    : eq(watches.userId, userId);

  const rows = await getDb()
    .select({
      id: watchEvents.id,
      watchId: watchEvents.watchId,
      watchLabel: watches.label,
      kind: watchEvents.kind,
      summary: watchEvents.summary,
      payload: watchEvents.payload,
      occurredAt: watchEvents.occurredAt,
      readAt: watchEvents.readAt,
    })
    .from(watchEvents)
    .innerJoin(watches, eq(watches.id, watchEvents.watchId))
    .where(where)
    .orderBy(desc(watchEvents.occurredAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    watchId: row.watchId,
    watchLabel: row.watchLabel,
    kind: row.kind,
    summary: row.summary,
    payload: row.payload,
    occurredAt: row.occurredAt.toISOString(),
    read: row.readAt !== null,
  }));
}

/** Marque tout le fil comme lu : la pastille de la barre latérale s'éteint. */
export async function markEventsRead(userId: string, now = new Date()): Promise<number> {
  // Sous-requête plutôt que liste d'identifiants : le compte peut avoir des milliers
  // d'événements, et la base sait faire la jointure mieux que nous.
  const siennes = getDb().select({ id: watches.id }).from(watches).where(eq(watches.userId, userId));
  const updated = await getDb()
    .update(watchEvents)
    .set({ readAt: now })
    .where(and(inArray(watchEvents.watchId, siennes), isNull(watchEvents.readAt)))
    .returning({ id: watchEvents.id });
  return updated.length;
}

/** Relevé demandé à la main. Réservé aux cas où l'utilisateur ne veut pas attendre la nuit. */
export async function sweepNow(userId: string, watchId: string): Promise<SweepOutcome> {
  const watch = await requireWatch(userId, watchId);
  if (!watch.active) {
    throw new AppError(
      409,
      'Cette surveillance est en pause après plusieurs relevés en échec. Retirez-la et ajoutez-la de nouveau.',
      'WATCH_PAUSED',
    );
  }
  return sweepWatch(watch);
}

/** Articles d'une surveillance : ce qui est en vente, puis ce qui s'est arrêté. */
export async function watchItemsOf(userId: string, watchId: string) {
  const watch = await requireWatch(userId, watchId);
  const rows = await getDb()
    .select()
    .from(watchItems)
    .where(eq(watchItems.watchId, watchId))
    .orderBy(sql`${watchItems.salesCount} desc nulls last`);

  // Publicités de chaque produit : voir services/market/productAds.ts, la règle commune du Radar.
  const host = storeHostOf(watch.url);
  const ads = host ? (await loadStoreAds([host])).get(host) : undefined;
  const adsOf = (slug: string | null, externalId: string) => adsOfProduct(ads, slug, externalId);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    /** De quoi ouvrir la page du produit, et retrouver ses annonces sur le mur. */
    slug: row.slug,
    externalId: row.externalId,
    url: host ? productUrl(host, row.slug) : watch.url,
    kind: row.kind,
    category: row.category,
    price: row.priceValue,
    currency: row.currency,
    sales: row.salesCount,
    /** Ventes faites depuis le premier compte lu. null : la source ne publie pas le compte. */
    salesTracked: row.salesCount !== null && row.salesAtFirstSeen !== null ? Math.max(0, row.salesCount - row.salesAtFirstSeen) : null,
    firstAdAt: adsOf(row.slug, row.externalId).firstAdAt?.toISOString() ?? null,
    activeAds: adsOf(row.slug, row.externalId).activeAds,
    totalAds: adsOf(row.slug, row.externalId).totalAds,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    trackedDays: jours(row.firstSeenAt, row.endedAt ?? new Date()),
  }));
}

/** Événements non lus du compte. Sert la pastille de la barre latérale : réponse d'un entier. */
export async function countUnreadEvents(userId: string): Promise<number> {
  const siennes = getDb().select({ id: watches.id }).from(watches).where(eq(watches.userId, userId));
  const [row] = await getDb()
    .select({ total: count() })
    .from(watchEvents)
    .where(and(inArray(watchEvents.watchId, siennes), isNull(watchEvents.readAt)));
  return Number(row?.total ?? 0);
}

/** Active ou coupe le résumé par e-mail. */
export async function setRadarAlerts(userId: string, enabled: boolean): Promise<void> {
  await getDb().update(users).set({ radarAlertsEnabled: enabled, updatedAt: new Date() }).where(eq(users.id, userId));
}

/** Événements du compte sur une période, pour les compteurs de l'écran. */
export async function eventCountsSince(userId: string, since: Date) {
  const rows = await getDb()
    .select({ kind: watchEvents.kind, total: count() })
    .from(watchEvents)
    .innerJoin(watches, eq(watches.id, watchEvents.watchId))
    .where(and(eq(watches.userId, userId), gte(watchEvents.occurredAt, since)))
    .groupBy(watchEvents.kind);

  return Object.fromEntries(rows.map((row) => [row.kind, Number(row.total)])) as Record<string, number>;
}
