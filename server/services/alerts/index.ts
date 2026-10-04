import { and, count, desc, eq, gt, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { alerts, marketProducts, spiedAds, users, type ALERT_KINDS, type ALERT_LEVELS } from '@server/db/schema';
import { env } from '@server/env';
import { nicheKeywords } from '@server/services/market';

/**
 * Alertes : ce que le croisement de l'index du marché et du mur publicitaire a remarqué.
 *
 * Trois règles, écrites pour ne dire que ce qui a été observé :
 *
 *   · PRODUIT GAGNANT — un produit LANCÉ sous nos yeux (apparu dans une boutique déjà relevée)
 *     qui atteint le seuil de ventes dans ses premiers jours. Un produit déjà là au premier
 *     relevé de sa boutique n'a pas de date de lancement connue : il n'est jamais déclaré gagnant.
 *   · TENDANCE DE NICHE — plusieurs boutiques différentes lancent, dans la même fenêtre, un
 *     produit qui porte le même mot distinctif.
 *   · ARRÊT D'UNE PUBLICITÉ INSTALLÉE — une publicité qui tournait depuis longtemps est déclarée
 *     arrêtée. Une publicité simplement absente d'une collecte n'est PAS arrêtée : seul un
 *     contrôle qui la dit inactive compte.
 *
 * Une alerte par constatation : `dedupeKey` empêche qu'un second passage la répète.
 */

type AlertKind = (typeof ALERT_KINDS)[number];
type AlertLevel = (typeof ALERT_LEVELS)[number];

export interface AlertView {
  id: string;
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  /** Arrivée depuis la dernière ouverture du fil par ce compte. */
  unread: boolean;
}

const JOUR_MS = 86_400_000;
const jours = (from: Date, to: Date) => Math.max(1, Math.round((to.getTime() - from.getTime()) / JOUR_MS));

interface NewAlert {
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

/** Produits lancés récemment qui ont déjà atteint le seuil de ventes. */
async function winners(now: Date): Promise<NewAlert[]> {
  // Demi-journée de marge : le relevé est quotidien, celui du troisième jour tombe rarement à l'heure exacte.
  const depuis = new Date(now.getTime() - (env.ALERT_WINNER_DAYS + 0.5) * JOUR_MS);
  const rows = await getDb()
    .select()
    .from(marketProducts)
    .where(and(isNotNull(marketProducts.launchedAt), gte(marketProducts.launchedAt, depuis), gte(marketProducts.salesCount, env.ALERT_WINNER_SALES), isNull(marketProducts.endedAt)));

  return rows.map((row) => {
    const duree = jours(row.launchedAt!, now);
    const boutique = row.storeLabel ?? row.storeHost;
    return {
      kind: 'winner',
      level: 'opportunity',
      title: 'Produit gagnant détecté',
      body: `« ${row.name} », de la boutique ${boutique}, a enregistré ${row.salesCount} ventes en ${duree} jour${duree > 1 ? 's' : ''}.`,
      payload: {
        storeHost: row.storeHost,
        storeLabel: boutique,
        productName: row.name,
        category: row.category,
        sales: row.salesCount,
        days: duree,
        price: row.priceValue,
        currency: row.currency,
      },
      dedupeKey: `winner:${row.storeExternalId}:${row.externalId}`,
    };
  });
}

/** Mots distinctifs partagés par les lancements récents de plusieurs boutiques différentes. */
async function nicheTrends(now: Date): Promise<NewAlert[]> {
  const depuis = new Date(now.getTime() - env.ALERT_TREND_HOURS * 3_600_000);
  const rows = await getDb()
    .select({ name: marketProducts.name, store: marketProducts.storeExternalId, host: marketProducts.storeHost, label: marketProducts.storeLabel })
    .from(marketProducts)
    .where(and(isNotNull(marketProducts.launchedAt), gte(marketProducts.launchedAt, depuis)));

  const parMot = new Map<string, { stores: Map<string, string>; products: string[] }>();
  for (const row of rows) {
    for (const mot of nicheKeywords(row.name)) {
      const groupe = parMot.get(mot) ?? { stores: new Map<string, string>(), products: [] };
      groupe.stores.set(row.store, row.label ?? row.host);
      groupe.products.push(row.name);
      parMot.set(mot, groupe);
    }
  }

  // Une alerte par mot et par fenêtre : le même élan ne se signale pas chaque nuit.
  const fenetre = Math.floor(now.getTime() / (env.ALERT_TREND_HOURS * 3_600_000));
  return [...parMot.entries()]
    .filter(([, groupe]) => groupe.stores.size >= env.ALERT_TREND_STORES)
    .map(([mot, groupe]) => ({
      kind: 'niche_trend' as const,
      level: 'info' as const,
      title: 'Tendance de niche',
      body: `${groupe.stores.size} boutiques ont lancé un produit sur « ${mot} » ces ${Math.round(env.ALERT_TREND_HOURS / 24)} derniers jours.`,
      payload: { keyword: mot, stores: [...groupe.stores.values()].slice(0, 8), products: [...new Set(groupe.products)].slice(0, 8) },
      dedupeKey: `trend:${mot}:${fenetre}`,
    }));
}

/** Publicités installées qu'un contrôle vient de déclarer arrêtées. */
async function stoppedAds(now: Date): Promise<NewAlert[]> {
  const recent = new Date(now.getTime() - 10 * JOUR_MS);
  const rows = await getDb()
    .select()
    .from(spiedAds)
    .where(and(eq(spiedAds.active, false), isNotNull(spiedAds.stoppedAt), gte(spiedAds.stoppedAt, recent), isNotNull(spiedAds.startedAt)));

  return rows.flatMap((row) => {
    const duree = jours(row.startedAt!, row.stoppedAt!);
    if (duree < env.ALERT_AD_MIN_DAYS) return [];
    const annonceur = row.advertiser ?? row.storeHost;
    return [
      {
        kind: 'ad_stopped' as const,
        level: 'major' as const,
        title: 'Arrêt d’une publicité installée',
        body: `La publicité de ${annonceur}, en diffusion depuis ${duree} jours, vient d’être arrêtée.`,
        payload: { storeHost: row.storeHost, advertiser: annonceur, adId: row.id, pageId: row.pageId, days: duree, title: row.title },
        dedupeKey: `ad_stopped:${row.externalId}`,
      },
    ];
  });
}

/** Applique les trois règles et enregistre ce qui est nouveau. Renvoie le nombre d'alertes créées. */
export async function detectAlerts(now = new Date()): Promise<number> {
  const found = [...(await winners(now)), ...(await nicheTrends(now)), ...(await stoppedAds(now))];
  if (found.length === 0) return 0;
  const created = await getDb()
    .insert(alerts)
    .values(found.map((alert) => ({ ...alert, occurredAt: now })))
    .onConflictDoNothing({ target: alerts.dedupeKey })
    .returning({ id: alerts.id });
  return created.length;
}

/** Fil des alertes, les plus récentes d'abord, avec ce que ce compte n'a pas encore vu. */
export async function listAlerts(userId: string, limit = 60): Promise<AlertView[]> {
  const [user] = await getDb().select({ seenAt: users.alertsSeenAt }).from(users).where(eq(users.id, userId)).limit(1);
  const seenAt = user?.seenAt ?? null;
  const rows = await getDb().select().from(alerts).orderBy(desc(alerts.occurredAt)).limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    level: row.level,
    title: row.title,
    body: row.body,
    payload: row.payload,
    occurredAt: row.occurredAt.toISOString(),
    unread: seenAt === null || row.occurredAt > seenAt,
  }));
}

/** Alertes arrivées depuis la dernière ouverture du fil : le chiffre de la cloche. */
export async function countUnreadAlerts(userId: string): Promise<number> {
  const [user] = await getDb().select({ seenAt: users.alertsSeenAt }).from(users).where(eq(users.id, userId)).limit(1);
  const [row] = await getDb()
    .select({ total: count() })
    .from(alerts)
    .where(user?.seenAt ? gt(alerts.occurredAt, user.seenAt) : sql`true`);
  return Number(row?.total ?? 0);
}

export async function markAlertsSeen(userId: string, now = new Date()): Promise<void> {
  await getDb().update(users).set({ alertsSeenAt: now }).where(eq(users.id, userId));
}
