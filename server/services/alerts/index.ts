import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from '@server/db/client';
import { alerts, marketProducts, marketSalesDaily, spiedAds, users, type ALERT_KINDS, type ALERT_LEVELS } from '@server/db/schema';
import { env } from '@server/env';
import { dayOf, nicheKeywords } from '@server/services/market';

/**
 * Alertes : ce que le croisement de l'index du marché et du mur publicitaire a remarqué.
 *
 * Sept règles, écrites pour ne dire que ce qui a été observé.
 *
 * Quatre se lisent en VENTES PAR JOUR — la différence entre deux relevés de jours consécutifs.
 * Sans relevé la veille, il n'y a pas de « ventes du jour » : la règle ne se déclenche pas,
 * plutôt que d'annoncer un chiffre reconstitué.
 *
 *   · PREMIER SIGNAL (info) — un produit passe la barre des 5 ventes dans la journée.
 *   · PRESSION CONCURRENTIELLE (opportunité) — 10 ventes et plus dans la journée.
 *   · SCALE ÉCLAIR (majeur) — 25 ventes et plus aujourd'hui, 5 au plus la veille. Il remplace la
 *     règle précédente pour ce produit ce jour-là : une seule alerte par constat.
 *   · CHUTE BRUTALE (majeur) — 15 ventes et plus la veille, aucune aujourd'hui, alors qu'une
 *     publicité de la boutique tourne encore : rupture probable.
 *
 * Trois autres :
 *
 *   · LANCEMENT FLASH (opportunité) — un produit LANCÉ sous nos yeux (apparu dans une boutique
 *     déjà relevée) qui atteint 30 ventes dans ses 3 premiers jours. Un produit déjà là au premier
 *     relevé de sa boutique n'a pas de date de lancement connue : il n'est jamais déclaré.
 *   · PLACE LIBÉRÉE (majeur) — une publicité qui tournait depuis 80 à 110 jours est déclarée
 *     arrêtée. Une publicité simplement absente d'une collecte n'est PAS arrêtée : seul un
 *     contrôle qui la dit inactive compte.
 *   · TENDANCE DE NICHE (info) — plusieurs boutiques différentes lancent, dans la même fenêtre,
 *     un produit qui porte le même mot distinctif.
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
const pluriel = (nombre: number) => (nombre > 1 ? 's' : '');

export interface NewAlert {
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

/** Ce qu'une carte d'alerte sait d'un produit : de quoi ouvrir sa boutique, ou en partir dans le Studio. */
const produitPayload = (row: typeof marketProducts.$inferSelect) => ({
  storeHost: row.storeHost,
  storeLabel: row.storeLabel ?? row.storeHost,
  productName: row.name,
  category: row.category,
  price: row.priceValue,
  currency: row.currency,
  sales: row.salesCount,
});

/**
 * Les quatre règles en ventes par jour. Trois points sont lus pour chaque produit relevé
 * aujourd'hui : aujourd'hui, hier, avant-hier — soit les ventes du jour et celles de la veille.
 */
async function dailyRules(now: Date): Promise<NewAlert[]> {
  const jour = dayOf(now);
  const hierJour = dayOf(new Date(now.getTime() - JOUR_MS));
  const avantHierJour = dayOf(new Date(now.getTime() - 2 * JOUR_MS));
  const hier = alias(marketSalesDaily, 'hier');
  const avantHier = alias(marketSalesDaily, 'avant_hier');

  const rows = await getDb()
    .select({ product: marketProducts, c0: marketSalesDaily.salesCount, c1: hier.salesCount, c2: avantHier.salesCount })
    .from(marketSalesDaily)
    .innerJoin(marketProducts, eq(marketProducts.id, marketSalesDaily.productId))
    .innerJoin(hier, and(eq(hier.productId, marketSalesDaily.productId), eq(hier.day, hierJour)))
    .leftJoin(avantHier, and(eq(avantHier.productId, marketSalesDaily.productId), eq(avantHier.day, avantHierJour)))
    .where(and(eq(marketSalesDaily.day, jour), isNull(marketProducts.endedAt)));

  // Un compteur qui recule (remboursements, correction de la boutique) n'est pas une vente négative.
  const mesures = rows.map((row) => ({
    product: row.product,
    today: Math.max(0, row.c0 - row.c1),
    yesterday: row.c2 === null ? null : Math.max(0, row.c1 - row.c2),
  }));

  // « Publicité active » : la boutique en a au moins une en cours au dernier contrôle.
  const candidatesChute = mesures.filter((mesure) => mesure.today === 0 && (mesure.yesterday ?? 0) >= env.ALERT_STOCKOUT_BEFORE);
  const hotes = [...new Set(candidatesChute.map((mesure) => mesure.product.storeHost))];
  const actives =
    hotes.length === 0
      ? []
      : await getDb()
          .select({ host: spiedAds.storeHost, total: count() })
          .from(spiedAds)
          .where(and(inArray(spiedAds.storeHost, hotes), eq(spiedAds.active, true)))
          .groupBy(spiedAds.storeHost);
  const pubsActives = new Map(actives.map((row) => [row.host, Number(row.total)]));

  const found: NewAlert[] = [];
  for (const { product, today, yesterday } of mesures) {
    const boutique = product.storeLabel ?? product.storeHost;
    const base = { ...produitPayload(product), salesToday: today, salesYesterday: yesterday };
    const cle = `${product.storeExternalId}:${product.externalId}:${jour}`;

    if (today >= env.ALERT_FLASH_SALES && yesterday !== null && yesterday <= env.ALERT_FLASH_BEFORE) {
      found.push({
        kind: 'flash_scale',
        level: 'major',
        title: 'Scale éclair',
        body: `« ${product.name} », de la boutique ${boutique}, est passé de ${yesterday} à ${today} ventes en une journée. Le concurrent injecte du budget publicitaire.`,
        payload: base,
        dedupeKey: `flash:${cle}`,
      });
    } else if (today >= env.ALERT_SCALE_SALES) {
      found.push({
        kind: 'daily_scale',
        level: 'opportunity',
        title: 'Pression concurrentielle',
        body: `« ${product.name} », de la boutique ${boutique}, enregistre ${today} ventes aujourd’hui. Le concurrent accélère : c’est le moment de lancer une offre proche, ou une alternative.`,
        payload: base,
        dedupeKey: `scale:${cle}`,
      });
    } else if (today >= env.ALERT_TRACTION_SALES) {
      found.push({
        kind: 'first_traction',
        level: 'info',
        title: 'Premier signal',
        body: `« ${product.name} », de la boutique ${boutique}, vient de passer la barre des ${env.ALERT_TRACTION_SALES} ventes dans la journée (${today} aujourd’hui). À surveiller de très près pour se positionner.`,
        payload: base,
        dedupeKey: `traction:${cle}`,
      });
    } else if (today === 0 && (yesterday ?? 0) >= env.ALERT_STOCKOUT_BEFORE && (pubsActives.get(product.storeHost) ?? 0) > 0) {
      found.push({
        kind: 'stockout',
        level: 'major',
        title: 'Chute brutale',
        body: `« ${product.name} », de la boutique ${boutique}, est tombé à 0 vente aujourd’hui après ${yesterday} la veille, alors que sa publicité tourne encore. Rupture ou incident probable chez le concurrent : la place est à prendre.`,
        payload: { ...base, activeAds: pubsActives.get(product.storeHost) },
        dedupeKey: `stockout:${cle}`,
      });
    }
  }
  return found;
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
      title: 'Lancement flash',
      body: `« ${row.name} », de la boutique ${boutique}, cumule déjà ${row.salesCount} ventes en ${duree} jour${pluriel(duree)}. Fort engouement immédiat sur le marché.`,
      payload: { ...produitPayload(row), days: duree },
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
    // Trop courte : un essai abandonné. Trop longue : une campagne de fond, pas une place qui se libère.
    if (duree < env.ALERT_AD_MIN_DAYS || duree > Math.max(env.ALERT_AD_MAX_DAYS, env.ALERT_AD_MIN_DAYS)) return [];
    const annonceur = row.advertiser ?? row.storeHost;
    return [
      {
        kind: 'ad_stopped' as const,
        level: 'major' as const,
        title: 'Place libérée',
        body: `La publicité installée de ${annonceur}, active depuis ${duree} jours, vient d’être désactivée. Son angle a fait ses preuves : la place est à reprendre.`,
        payload: { storeHost: row.storeHost, storeLabel: annonceur, advertiser: annonceur, adId: row.id, pageId: row.pageId, days: duree, title: row.title, productName: row.title },
        dedupeKey: `ad_stopped:${row.externalId}`,
      },
    ];
  });
}

/** Applique les règles et enregistre ce qui est nouveau. Renvoie les alertes créées à ce passage. */
export async function detectNewAlerts(now = new Date()): Promise<(NewAlert & { id: string })[]> {
  const found = [...(await dailyRules(now)), ...(await winners(now)), ...(await nicheTrends(now)), ...(await stoppedAds(now))];
  if (found.length === 0) return [];
  const created = await getDb()
    .insert(alerts)
    .values(found.map((alert) => ({ ...alert, occurredAt: now })))
    .onConflictDoNothing({ target: alerts.dedupeKey })
    .returning({ id: alerts.id, dedupeKey: alerts.dedupeKey });
  const ids = new Map(created.map((row) => [row.dedupeKey, row.id]));
  return found.flatMap((alert) => (ids.has(alert.dedupeKey) ? [{ ...alert, id: ids.get(alert.dedupeKey)! }] : []));
}

/** Applique les règles ; renvoie le nombre d'alertes créées. */
export async function detectAlerts(now = new Date()): Promise<number> {
  return (await detectNewAlerts(now)).length;
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
