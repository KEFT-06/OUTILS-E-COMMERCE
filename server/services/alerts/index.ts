import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
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
 * Deux enfin se lisent sur le mur publicitaire seul. Les ventes d'une boutique ne se relèvent
 * que si sa vitrine répond ; ses publicités, elles, sont publiques et relevées en continu. Ces
 * règles tiennent donc le fil vivant même quand un relevé de ventes manque :
 *
 *   · PUBLICITÉ QUI DURE (signal à 30 jours, opportunité à 60 et 90) — une annonce encore active
 *     passe un cap de diffusion. Personne ne paie deux mois une annonce qui ne rapporte pas.
 *   · MONTÉE EN PUISSANCE (opportunité) — une boutique lance quatre publicités nouvelles ou plus
 *     en trois jours : elle teste, ou elle a trouvé ce qui se vend.
 *
 * L'une comme l'autre ne parlent que d'annonces VUES ces trois derniers jours : un mur qui n'a
 * pas été relevé ne déclenche rien.
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

/** Caps de diffusion signalés, du plus long au plus court : une annonce qui en passe deux d'un coup ne dit que le plus long. */
const LONGEVITY_DAYS = [90, 60, 30] as const;
/** Fenêtre autour d'un cap : le relevé passe plusieurs fois par jour, mais une panne d'une journée ne doit pas faire manquer le cap. */
const LONGEVITY_WINDOW_MS = 36 * 3_600_000;
/** Au plus tant d'alertes par cap et par passage, les annonces aux plus nombreuses versions d'abord : le fil signale, il n'inventorie pas. */
const LONGEVITY_PER_STEP = 6;
/** Publicités nouvelles en trois jours à partir desquelles une boutique « monte en puissance ». */
const RAMP_NEW_ADS = 4;
const RAMP_STORES_PER_RUN = 6;
/** Une annonce n'est tenue pour vue que si une collecte l'a relevée ces derniers jours. */
const SEEN_WITHIN_MS = 3 * JOUR_MS;

/** Publicités encore actives qui passent un cap de diffusion. */
async function longRunningAds(now: Date): Promise<NewAlert[]> {
  const seenSince = new Date(now.getTime() - SEEN_WITHIN_MS);
  const found: NewAlert[] = [];
  const told = new Set<string>();
  for (const days of LONGEVITY_DAYS) {
    const cap = new Date(now.getTime() - days * JOUR_MS);
    const rows = await getDb()
      .select()
      .from(spiedAds)
      .where(and(eq(spiedAds.active, true), gte(spiedAds.lastSeenAt, seenSince), isNotNull(spiedAds.startedAt), gte(spiedAds.startedAt, new Date(cap.getTime() - LONGEVITY_WINDOW_MS)), lte(spiedAds.startedAt, cap)))
      .orderBy(desc(spiedAds.variants), asc(spiedAds.startedAt))
      .limit(LONGEVITY_PER_STEP);
    for (const row of rows) {
      if (told.has(row.externalId)) continue;
      told.add(row.externalId);
      const annonceur = row.advertiser ?? row.storeHost;
      const versions = row.variants > 1 ? `, en ${row.variants} versions` : '';
      const sujet = row.title?.trim() ? ` : « ${row.title.trim().slice(0, 90)} »` : '';
      found.push({
        kind: 'ad_longevity',
        level: days >= 60 ? 'opportunity' : 'info',
        title: 'Publicité qui dure',
        body: `${annonceur} diffuse la même publicité depuis ${days} jours${versions}${sujet}. Une annonce payée aussi longtemps est une annonce qui rapporte.`,
        payload: { storeHost: row.storeHost, storeLabel: annonceur, advertiser: annonceur, adId: row.id, pageId: row.pageId, days, title: row.title, productName: row.title },
        dedupeKey: `ad_longevity:${row.externalId}:${days}`,
      });
    }
  }
  return found;
}

/** Boutiques qui lancent plusieurs publicités nouvelles en trois jours. */
async function rampingStores(now: Date): Promise<NewAlert[]> {
  const seenSince = new Date(now.getTime() - SEEN_WITHIN_MS);
  const recent = new Date(now.getTime() - 3 * JOUR_MS).toISOString();
  const fresh = sql<number>`count(*) filter (where ${spiedAds.startedAt} >= ${recent}::timestamptz)`;
  const rows = await getDb()
    .select({
      host: spiedAds.storeHost,
      advertiser: sql<string | null>`max(${spiedAds.advertiser})`,
      fresh,
      running: sql<number>`count(*) filter (where ${spiedAds.startedAt} < ${recent}::timestamptz)`,
    })
    .from(spiedAds)
    .where(and(eq(spiedAds.active, true), gte(spiedAds.lastSeenAt, seenSince), isNotNull(spiedAds.startedAt)))
    .groupBy(spiedAds.storeHost)
    .having(sql`${fresh} >= ${RAMP_NEW_ADS}`)
    .orderBy(desc(fresh))
    .limit(RAMP_STORES_PER_RUN);

  // Une alerte par boutique et par semaine : le même élan ne se signale pas à chaque passage.
  const semaine = Math.floor(now.getTime() / (7 * JOUR_MS));
  return rows.map((row) => {
    const lancees = Number(row.fresh);
    const installees = Number(row.running);
    const boutique = row.advertiser ?? row.host;
    return {
      kind: 'store_ramp' as const,
      level: 'opportunity' as const,
      title: 'Montée en puissance',
      body: `${boutique} a lancé ${lancees} publicités nouvelles en trois jours${installees > 0 ? `, en plus de ${installees} déjà en cours` : ''}. Un vendeur qui multiplie ses annonces teste — ou a trouvé — ce qui se vend.`,
      payload: { storeHost: row.host, storeLabel: boutique, advertiser: boutique, newAds: lancees, runningAds: installees },
      dedupeKey: `store_ramp:${row.host}:${semaine}`,
    };
  });
}

/** Applique les règles et enregistre ce qui est nouveau. Renvoie les alertes créées à ce passage. */
export async function detectNewAlerts(now = new Date()): Promise<(NewAlert & { id: string })[]> {
  const found = [
    ...(await dailyRules(now)),
    ...(await winners(now)),
    ...(await nicheTrends(now)),
    ...(await stoppedAds(now)),
    ...(await longRunningAds(now)),
    ...(await rampingStores(now)),
  ];
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
/** Ce qui alimente le fil : les boutiques dont les ventes sont relevées, et quand elles l'ont été. */
export interface AlertWatch {
  /** Boutiques de l'index du marché. */
  stores: number;
  /** Jours récents où des ventes ont été relevées, du plus récent au plus ancien, avec le nombre de boutiques lues. */
  readings: { day: string; stores: number }[];
}

/**
 * État de la veille, lu sur les relevés eux-mêmes — pas sur le passage du réveil : un passage
 * qui n'a rien lu ne compte pas. Les alertes se calculent d'un jour sur l'autre ; « aucune
 * alerte » ne veut dire « rien ne bouge » que si les boutiques ont bien été relevées.
 */
export async function alertWatch(now = new Date()): Promise<AlertWatch> {
  const [index] = await getDb().select({ stores: sql<number>`count(distinct ${marketProducts.storeHost})` }).from(marketProducts);
  const since = dayOf(new Date(now.getTime() - 13 * JOUR_MS));
  const days = await getDb()
    .select({ day: marketSalesDaily.day, stores: sql<number>`count(distinct ${marketProducts.storeHost})` })
    .from(marketSalesDaily)
    .innerJoin(marketProducts, eq(marketProducts.id, marketSalesDaily.productId))
    .where(gte(marketSalesDaily.day, since))
    .groupBy(marketSalesDaily.day)
    .orderBy(desc(marketSalesDaily.day));
  return { stores: Number(index?.stores ?? 0), readings: days.map((entry) => ({ day: entry.day, stores: Number(entry.stores) })) };
}

/**
 * État de la veille en quelques chiffres, pour le compte rendu d'un passage : rien qui nomme une
 * boutique ou un compte. Lu par l'atelier de veille, qui l'affiche.
 */
export async function watchState(now = new Date()): Promise<{
  boutiques: number;
  boutiquesReleveesAujourdhui: number;
  dernierReleveDeVentes: string | null;
  annonces: number;
  annoncesVuesDepuis24h: number;
  derniereAnnonceVue: string | null;
  alertesAuFil: number;
  alertesDepuis24h: number;
}> {
  // L'une après l'autre : une instance n'a qu'une connexion, et chaque lecture se mesure ainsi à part.
  return { ...(await salesWatchState(now)), ...(await wallWatchState(now)), ...(await feedWatchState(now)) };
}

/** Ventes : boutiques de l'index, celles relevées aujourd'hui, jour du dernier relevé. */
export async function salesWatchState(now = new Date()): Promise<{ boutiques: number; boutiquesReleveesAujourdhui: number; dernierReleveDeVentes: string | null }> {
  const watch = await alertWatch(now);
  const aujourdhui = watch.readings.find((reading) => reading.day === dayOf(now));
  return { boutiques: watch.stores, boutiquesReleveesAujourdhui: aujourdhui?.stores ?? 0, dernierReleveDeVentes: watch.readings[0]?.day ?? null };
}

/** Publicités : taille du mur, annonces vues depuis vingt-quatre heures, date de la dernière. */
export async function wallWatchState(now = new Date()): Promise<{ annonces: number; annoncesVuesDepuis24h: number; derniereAnnonceVue: string | null }> {
  const hier = new Date(now.getTime() - JOUR_MS);
  const [mur] = await getDb()
    .select({ total: count(), fraiches: sql<number>`count(*) filter (where ${spiedAds.lastSeenAt} >= ${hier.toISOString()}::timestamptz)`, derniere: sql<Date | string | null>`max(${spiedAds.lastSeenAt})` })
    .from(spiedAds);
  return { annonces: Number(mur?.total ?? 0), annoncesVuesDepuis24h: Number(mur?.fraiches ?? 0), derniereAnnonceVue: mur?.derniere ? new Date(mur.derniere).toISOString() : null };
}

/** Alertes : au fil en tout, et depuis vingt-quatre heures. */
export async function feedWatchState(now = new Date()): Promise<{ alertesAuFil: number; alertesDepuis24h: number }> {
  const hier = new Date(now.getTime() - JOUR_MS);
  const [fil] = await getDb()
    .select({ total: count(), recentes: sql<number>`count(*) filter (where ${alerts.occurredAt} >= ${hier.toISOString()}::timestamptz)` })
    .from(alerts);
  return { alertesAuFil: Number(fil?.total ?? 0), alertesDepuis24h: Number(fil?.recentes ?? 0) };
}

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
