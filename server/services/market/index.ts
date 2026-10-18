import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { sansAccents } from '@server/db/search';
import { discoveredStores, marketProducts, marketSalesDaily, spiedAds } from '@server/db/schema';
import { chariowStoreSource, sourceFailureOf } from '@server/services/radar/sources/chariowStore';
import { BUDGET_CODE, asMarketIndexRead } from '@server/services/radar/sources/firecrawl';
import { AppError } from '@server/middleware';
import type { RadarObservation } from '@server/services/radar/types';
import { type AdvertisedOffer, advertisedOffers } from '@server/services/market/adProducts';
import { adsOfProduct, loadStoreAds, productUrl } from '@server/services/market/productAds';
import { recordAudit } from '@server/services/audit';
import { runInBackground } from '@server/shared/backgroundWork';

/**
 * Index du marché : les produits des boutiques connues, relevés dans leur catalogue public.
 *
 * Deux portes d'entrée, une seule table :
 *   · chaque relevé d'une boutique surveillée par un compte y verse son catalogue ;
 *   · les boutiques repérées par leurs publicités y sont relevées à tour de rôle.
 *
 * C'est ce qui répond, depuis l'analyse d'une niche, à « qui vend déjà cela, à quel prix et
 * combien » — et ce qui permet de voir un produit décoller chez un concurrent que personne ne
 * surveille encore.
 */

export interface MarketStoreRef {
  /** Identifiant « store_… » de la boutique. */
  externalId: string;
  host: string;
  label: string | null;
}

const JOUR_MS = 86_400_000;
/** Pause entre deux boutiques : ce sont des sous-domaines d'une même plateforme, pas des serveurs différents. */
const PAUSE_MS = 400;
/** Une boutique repérée est relevée au plus une fois par jour. */
const REINDEX_AFTER_MS = 20 * 3_600_000;

/**
 * Temps accordé au relevé d'UNE boutique. La vitrine est celle d'un tiers : une qui traîne (vingt
 * pages de catalogue à vingt secondes chacune au pire) ne doit pas emporter le relevé de toutes
 * les autres. Au-delà, elle est comptée en échec et la file avance.
 */
const STORE_CAP_MS = 45_000;
/** En dessous de ce reste de temps, on n'entame pas une boutique de plus : elle attend le maillon suivant. */
const STORE_MIN_MS = 15_000;
/**
 * Vitrines sans réponse à la suite au-delà desquelles le passage s'arrête. Ce n'est plus une
 * boutique en panne, c'est la plateforme qui refuse : insister sur les deux cents suivantes ne
 * relèverait rien et ressemblerait à une attaque. Le passage suivant réessaiera.
 */
const REFUSALS_BEFORE_HALT = 5;
/**
 * Écart au-delà duquel un produit nouveau n'est plus daté comme lancé. Un produit absent du relevé
 * d'hier et présent aujourd'hui a été mis en ligne entre les deux ; si le relevé précédent date de
 * douze jours (la plateforme a refusé le serveur du 11 au 18/10/2026), il a pu l'être n'importe
 * quand dans ces douze jours. « Lancé aujourd'hui » serait faux, et une alerte « N ventes en
 * 0 jour » aussi : il est seulement vu pour la première fois.
 */
const LAUNCH_DATING_MS = 48 * 3_600_000;
/** Marge laissée, dans le délai d'une boutique, à la fiche en cours de lecture. */
const DETAIL_MARGIN_MS = 6_000;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Le résultat, ou un échec si le travail n'a pas fini dans le délai. */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`relevé trop long (plus de ${Math.round(ms / 1000)} s)`)), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Jour d'un instant en temps universel, « 2026-10-07 » : la clé d'un point de ventes quotidien. */
export const dayOf = (date: Date) => date.toISOString().slice(0, 10);

/** Nom plié : minuscules, sans accents, espaces réduits. */
export const nameKeyOf = (name: string) => sansAccents(name).toLowerCase().replace(/\s+/g, ' ').trim();

/** Hôte normalisé en .com, la forme gardée par le mur d'espionnage. */
export const normalHost = (host: string) =>
  host
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.mychariow\.shop$/, '.mychariow.com');

/**
 * Verse un relevé de catalogue dans l'index. Une seule écriture pour tout le catalogue.
 *
 * Un produit absent de l'index alors que sa boutique y était déjà est un LANCEMENT : c'est la
 * seule façon de dater une mise en ligne, la vitrine ne publiant aucune date de création.
 */
export async function indexStoreCatalog(store: MarketStoreRef, observations: RadarObservation[], now = new Date()): Promise<{ launched: number }> {
  const db = getDb();
  const host = normalHost(store.host);
  const known = await db
    .select({ externalId: marketProducts.externalId, lastSeenAt: marketProducts.lastSeenAt })
    .from(marketProducts)
    .where(eq(marketProducts.storeExternalId, store.externalId));
  // Le relevé précédent de la boutique : récent, un produit nouveau est un lancement daté.
  const previousRead = known.reduce((latest, row) => Math.max(latest, row.lastSeenAt.getTime()), 0);
  const storeKnown = known.length > 0 && now.getTime() - previousRead <= LAUNCH_DATING_MS;
  const knownIds = new Set(known.map((row) => row.externalId));
  let launched = 0;

  const rows = observations.map((observation) => {
    const isLaunch = storeKnown && !knownIds.has(observation.externalId);
    if (isLaunch) launched += 1;
    return {
      storeExternalId: store.externalId,
      storeHost: host,
      storeLabel: store.label,
      externalId: observation.externalId,
      name: observation.name,
      nameKey: nameKeyOf(observation.name),
      slug: observation.slug ?? null,
      kind: observation.kind,
      category: observation.category ?? null,
      priceValue: observation.priceValue,
      currency: observation.currency,
      salesCount: observation.salesCount,
      salesAtFirstSeen: observation.salesCount,
      firstSeenAt: now,
      launchedAt: isLaunch ? now : null,
      lastSeenAt: now,
    };
  });

  // Ventes réellement lues à ce passage, par produit : seules elles font un point du jour.
  const lues = new Map(observations.flatMap((observation) => (observation.salesCount === null || observation.salesCount === undefined ? [] : [[observation.externalId, observation.salesCount] as const])));
  const jour = dayOf(now);

  const PAQUET = 100;
  for (let debut = 0; debut < rows.length; debut += PAQUET) {
    const ecrits = await db
      .insert(marketProducts)
      .values(rows.slice(debut, debut + PAQUET))
      .onConflictDoUpdate({
        target: [marketProducts.storeExternalId, marketProducts.externalId],
        // `excluded` : la ligne qu'on tentait d'insérer. Ce qui n'a pas été lu à ce passage
        // (ventes, catégorie) garde sa dernière valeur connue.
        set: {
          storeHost: sql`excluded.store_host`,
          storeLabel: sql`coalesce(excluded.store_label, ${marketProducts.storeLabel})`,
          name: sql`excluded.name`,
          nameKey: sql`excluded.name_key`,
          slug: sql`coalesce(excluded.slug, ${marketProducts.slug})`,
          kind: sql`excluded.kind`,
          category: sql`coalesce(excluded.category, ${marketProducts.category})`,
          priceValue: sql`excluded.price_value`,
          currency: sql`excluded.currency`,
          salesCount: sql`coalesce(excluded.sales_count, ${marketProducts.salesCount})`,
          salesAtFirstSeen: sql`coalesce(${marketProducts.salesAtFirstSeen}, excluded.sales_count)`,
          lastSeenAt: now,
          endedAt: null,
        },
      })
      .returning({ id: marketProducts.id, externalId: marketProducts.externalId });

    /*
      Le point du jour : les ventes cumulées lues aujourd'hui. C'est la différence entre deux
      points consécutifs qui donne les ventes d'une journée, et c'est elle que lisent les alertes.
      Un produit dont la fiche n'a pas répondu n'a PAS de point : reprendre son compte de la veille
      ferait croire à une journée sans vente.
    */
    const points = ecrits.flatMap((ecrit) => {
      const ventes = lues.get(ecrit.externalId);
      return ventes === undefined ? [] : [{ productId: ecrit.id, day: jour, salesCount: ventes }];
    });
    if (points.length > 0) {
      await db
        .insert(marketSalesDaily)
        .values(points)
        .onConflictDoUpdate({ target: [marketSalesDaily.productId, marketSalesDaily.day], set: { salesCount: sql`excluded.sales_count` } });
    }
  }

  // Ce qui était en vente et que ce relevé n'a pas retrouvé : sa date d'arrêt.
  await db
    .update(marketProducts)
    .set({ endedAt: now })
    .where(and(eq(marketProducts.storeExternalId, store.externalId), isNull(marketProducts.endedAt), lt(marketProducts.lastSeenAt, now)));

  return { launched };
}

/** La boutique de cet hôte telle que nos relevés la connaissent (identifiant « store_… » et nom), ou null. */
export async function knownStoreOfHost(host: string): Promise<{ externalId: string; label: string | null } | null> {
  const db = getDb();
  const [discovered] = await db
    .select({ externalId: discoveredStores.storeExternalId, label: discoveredStores.label })
    .from(discoveredStores)
    .where(eq(discoveredStores.host, host))
    .limit(1);
  if (discovered?.externalId) return { externalId: discovered.externalId.toLowerCase(), label: discovered.label?.trim() || null };
  const [indexed] = await db
    .select({ externalId: marketProducts.storeExternalId, label: marketProducts.storeLabel })
    .from(marketProducts)
    .where(eq(marketProducts.storeHost, host))
    .limit(1);
  return indexed ? { externalId: indexed.externalId.toLowerCase(), label: indexed.label?.trim() || null } : null;
}

/**
 * Le dernier relevé de cette boutique dans l'index du marché : sa date, et ses produits en vente
 * tels qu'il les a lus. null quand la boutique n'y est pas.
 */
export async function latestIndexReading(storeExternalId: string): Promise<{ at: Date; observations: RadarObservation[] } | null> {
  const rows = await getDb()
    .select()
    .from(marketProducts)
    .where(and(eq(marketProducts.storeExternalId, storeExternalId), isNull(marketProducts.endedAt)));
  if (rows.length === 0) return null;
  const at = new Date(Math.max(...rows.map((row) => row.lastSeenAt.getTime())));
  // Les produits de ce relevé-là : un relevé les date tous du même instant.
  const observations = rows
    .filter((row) => row.lastSeenAt.getTime() === at.getTime())
    .map((row) => ({ externalId: row.externalId, name: row.name, kind: row.kind, priceValue: row.priceValue, currency: row.currency, salesCount: row.salesCount, category: row.category, slug: row.slug }));
  return { at, observations };
}

export interface MarketIndexOutcome {
  indexed: number;
  failed: number;
  launched: number;
  /** Boutiques repérées qui attendent encore leur relevé du jour. */
  remaining: number;
  /** Motifs d'échec de ce passage, avec le nombre de boutiques touchées par chacun. */
  reasons: Record<string, number>;
  /** La plateforme refusait : le passage s'est arrêté de lui-même au lieu d'insister. */
  halted?: boolean;
  /** Le plafond du jour de la lecture des vitrines est atteint : le passage s'est arrêté là, sans échec. */
  budgetReached?: boolean;
}

/**
 * Relève à tour de rôle le catalogue des boutiques repérées par leurs publicités, les plus
 * anciennement relevées d'abord, dans un temps borné. Un échec avance quand même la date : une
 * boutique fermée ne doit pas bloquer la file.
 */
/** Boutiques dont le relevé du jour est dû, dans l'ordre où elles seront relevées. */
export async function dueDiscoveredStores(now = new Date()) {
  const db = getDb();
  const seuil = new Date(now.getTime() - REINDEX_AFTER_MS);
  const due = or(isNull(discoveredStores.indexedAt), lt(discoveredStores.indexedAt, seuil));
  /*
    Les boutiques dont une publicité a été vue ces trois derniers jours passent devant : ce sont
    celles qui vendent en ce moment, et les alertes se lisent en ventes PAR JOUR — il leur faut un
    relevé chaque jour. Les autres attendent deux jours de plus à ancienneté égale ; elles ne sont
    jamais écartées, seulement relevées moins souvent quand le temps manque.
  */
  const recente = new Date(now.getTime() - 3 * JOUR_MS).toISOString();
  const file = await db
    .select()
    .from(discoveredStores)
    .where(due)
    .orderBy(
      sql`coalesce(${discoveredStores.indexedAt}, 'epoch'::timestamptz) + case when ${discoveredStores.lastSeenAt} >= ${recente}::timestamptz then interval '0 hours' else interval '48 hours' end asc`,
      desc(discoveredStores.lastSeenAt),
    )
    .limit(300);
  return file;
}

export async function indexDiscoveredStores(
  budgetMs: number,
  now = new Date(),
  limits: { storeCapMs?: number; storeMinMs?: number } = {},
): Promise<MarketIndexOutcome> {
  const { storeCapMs = STORE_CAP_MS, storeMinMs = STORE_MIN_MS } = limits;
  const db = getDb();
  const file = await dueDiscoveredStores(now);

  const deadline = Date.now() + budgetMs;
  const outcome: MarketIndexOutcome = { indexed: 0, failed: 0, launched: 0, remaining: file.length, reasons: {} };
  let refusals = 0;

  for (const [rang, store] of file.entries()) {
    /*
      Le temps se vérifie AVANT d'entamer une boutique, et chaque boutique a son délai. Du 07 au
      11/10/2026, la boucle ne regardait l'heure qu'entre deux boutiques : une seule vitrine lente
      la faisait dépasser le temps de la requête, l'hébergeur coupait, et ni les alertes ni la
      suite du relevé — placées après elle — n'étaient jamais atteintes. Constat en production :
      36 boutiques sur 40 non relues depuis cinq jours, aucune alerte.
    */
    if (deadline - Date.now() < storeMinMs) break;
    if (rang > 0) await pause(PAUSE_MS);
    outcome.remaining -= 1;
    // La marge ne mange jamais plus du quart du délai : sur un délai court, les fiches se lisent encore.
    const storeDeadline = Date.now() + storeCapMs - Math.min(DETAIL_MARGIN_MS, Math.floor(storeCapMs / 4));
    try {
      const { target, observations } = await within(
        // Lectures de l'index : servies après ce qu'un client attend (voir sources/firecrawl.ts).
        asMarketIndexRead(async () => {
          // L'identifiant « store_… » se lit une fois sur la page de la boutique, puis il est gardé.
          const known = store.storeExternalId ? { externalId: store.storeExternalId, label: store.label } : await chariowStoreSource.resolve(store.host);
          return { target: known, observations: await chariowStoreSource.observe(known.externalId, { deadline: storeDeadline }) };
        }),
        storeCapMs,
      );
      const { launched } = await indexStoreCatalog({ externalId: target.externalId, host: store.host, label: target.label ?? store.label }, observations, now);
      await db
        .update(discoveredStores)
        .set({ storeExternalId: target.externalId, label: store.label ?? target.label ?? null, indexedAt: now })
        .where(eq(discoveredStores.id, store.id));
      outcome.indexed += 1;
      outcome.launched += launched;
      refusals = 0;
    } catch (error) {
      // Plafond du jour atteint : la boutique n'a pas échoué, elle attend — sa date ne bouge pas.
      if (error instanceof AppError && error.code === BUDGET_CODE) {
        outcome.remaining += 1;
        outcome.budgetReached = true;
        break;
      }
      outcome.failed += 1;
      // La cause, sans le nom de la boutique : c'est le motif qui se compte, d'un passage à l'autre.
      const cause = sourceFailureOf(error);
      const reason = (cause ? `vitrine sans réponse : ${cause}` : error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 90);
      outcome.reasons[reason] = (outcome.reasons[reason] ?? 0) + 1;
      console.warn('[marché] relevé impossible :', store.host, error instanceof Error ? error.message : error);
      await db.update(discoveredStores).set({ indexedAt: now }).where(eq(discoveredStores.id, store.id));
      refusals = cause ? refusals + 1 : 0;
      if (refusals >= REFUSALS_BEFORE_HALT) {
        outcome.halted = true;
        break;
      }
    }
  }
  return outcome;
}

/** Nom, au journal, du compte rendu d'un passage du relevé du marché. */
export const MARKET_RUN_AUDIT_ACTION = 'market.index.run';

/**
 * Compte rendu d'un passage, au journal. Du 07 au 11/10/2026 le relevé ne faisait plus le tour
 * des boutiques et rien ne le disait à personne : ses chiffres ne partaient que dans les journaux
 * de l'hébergeur. La page « État des services » lit maintenant le dernier. Ne lève jamais.
 */
export async function reportMarketRun(source: string, outcome: MarketIndexOutcome | null, alertes: number | null): Promise<void> {
  const reasons = Object.entries(outcome?.reasons ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, stores]) => ({ reason, stores }));
  await recordAudit({
    actor: { id: null, email: 'réveil quotidien' },
    action: MARKET_RUN_AUDIT_ACTION,
    details: { source, indexed: outcome?.indexed ?? null, failed: outcome?.failed ?? null, remaining: outcome?.remaining ?? null, launched: outcome?.launched ?? null, halted: outcome?.halted ?? false, budgetReached: outcome?.budgetReached ?? false, alertes, reasons },
    client: { ipAddress: null, userAgent: 'réveil quotidien' },
  }).catch((error: unknown) => console.warn('[marché] compte rendu non enregistré :', error instanceof Error ? error.message : error));
}

let lastBackgroundIndex = 0;

/**
 * Entretien de l'index à la consultation, en arrière-plan et au plus toutes les dix minutes par
 * instance : le seul réveil automatique est quotidien, et un index vide ne répond à rien.
 */
export function indexMarketInBackground(): void {
  if (Date.now() - lastBackgroundIndex < 600_000) return;
  lastBackgroundIndex = Date.now();
  runInBackground(async () => {
    await indexDiscoveredStores(45_000);
  }, 'index du marché');
}

/* -------------------------------------------------------------------------- */
/*  Recherche par niche                                                        */
/* -------------------------------------------------------------------------- */

/** Mots trop généraux pour désigner une niche : ils rattacheraient n'importe quel produit. */
const GENERIQUES = new Set(
  (
    'gestion quotidienne quotidien guide guides comment complet complete methode methodes formation formations creation contenu contenus pour avec sans dans ' +
    'debutant debutants plus faire business ligne programme programmes jours jour vente ventes vendre produit produits digital digitaux numerique numeriques ' +
    'service services conseil conseils astuce astuces apprendre devenir reussir lancer cours ebook ebooks livre livres pack packs pratique pratiques facile simple ' +
    'naturel naturelle naturels naturelles maison afrique africain africaine africains africaines ville villes petit petite grand grande entre chez votre vos notre ' +
    'tous toutes tout cette comme etre avoir leur leurs depuis jusqu etape etapes secret secrets strategie strategies plan plans'
  ).split(' '),
);

/**
 * Mots distinctifs d'une niche, ramenés à leur racine (« poulets » → « poulet ») pour que le
 * singulier trouve le pluriel. Si la niche n'est faite que de mots généraux, ils servent tous.
 */
export function nicheKeywords(niche: string): string[] {
  const mots = sansAccents(niche)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((mot) => mot.length >= 4)
    .map((mot) => (mot.length > 5 ? mot.replace(/(?:es|s|x)$/, '') : mot));
  const distinctifs = mots.filter((mot) => !GENERIQUES.has(mot) && !GENERIQUES.has(`${mot}s`));
  return [...new Set(distinctifs.length > 0 ? distinctifs : mots)].slice(0, 6);
}

export interface MarketProductView {
  id: string;
  name: string;
  category: string | null;
  kind: string | null;
  storeHost: string;
  storeLabel: string | null;
  storeUrl: string;
  price: number | null;
  currency: string | null;
  /** Ventes cumulées depuis la création du produit. null : non publiées. */
  sales: number | null;
  /** Ventes depuis notre premier relevé. null : non publiées. */
  salesTracked: number | null;
  firstSeenAt: string;
  /** Début de la plus ancienne publicité connue de la boutique : borne d'ancienneté publiée par la régie. */
  firstAdAt: string | null;
  /** Publicités de la boutique vues en cours au dernier contrôle. */
  activeAds: number;
  slug: string | null;
  externalId: string;
  /** Page du produit sur sa vitrine. */
  url: string;
  /** Début de la plus ancienne publicité connue de CE produit sur Meta, et le nombre de ses annonces. */
  productFirstAdAt: string | null;
  productAds: number;
}

export interface MarketSearchView {
  niche: string;
  keywords: string[];
  products: MarketProductView[];
  /** Boutiques distinctes parmi les produits trouvés. */
  stores: number;
  /** Boutiques dont le catalogue est dans l'index, et produits en vente qu'il contient. */
  indexedStores: number;
  indexedProducts: number;
  /** Offres de la niche vues en publicité sur le mur d'espionnage (voir market/adProducts.ts). */
  advertised: AdvertisedOffer[];
}

/** Produits en vente dont le nom porte un mot distinctif de la niche, les plus vendus d'abord. */
export async function searchMarketProducts(niche: string, limit = 60): Promise<MarketSearchView> {
  const db = getDb();
  const keywords = nicheKeywords(niche);
  const [totaux] = await db
    .select({ stores: sql<number>`count(distinct ${marketProducts.storeExternalId})`, products: sql<number>`count(*)` })
    .from(marketProducts)
    .where(isNull(marketProducts.endedAt));
  // Ce que le mur montre de la niche, que l'index en sache quelque chose ou non : le Radar ne reste jamais muet.
  const base = { niche, keywords, indexedStores: Number(totaux?.stores ?? 0), indexedProducts: Number(totaux?.products ?? 0), advertised: await advertisedOffers(keywords) };
  if (keywords.length === 0) return { ...base, products: [], stores: 0 };

  const rows = await db
    .select()
    .from(marketProducts)
    .where(and(isNull(marketProducts.endedAt), or(...keywords.map((mot) => sql`${marketProducts.nameKey} like ${`%${mot}%`}`))))
    .orderBy(sql`${marketProducts.salesCount} desc nulls last`, asc(marketProducts.firstSeenAt))
    .limit(400);

  // Un produit qui porte deux mots de la niche passe devant celui qui n'en porte qu'un.
  const score = (nameKey: string) => keywords.filter((mot) => nameKey.includes(mot)).length;
  const retenus = rows
    .map((row) => ({ row, score: score(row.nameKey) }))
    .sort((a, b) => b.score - a.score || (b.row.salesCount ?? -1) - (a.row.salesCount ?? -1))
    .slice(0, Math.min(Math.max(limit, 1), 200))
    .map((entry) => entry.row);

  const hosts = [...new Set(retenus.map((row) => row.storeHost))];
  const ads =
    hosts.length === 0
      ? []
      : await db
          .select({
            host: spiedAds.storeHost,
            activeAds: sql<number>`count(*) filter (where ${spiedAds.active})`,
            firstAdAt: sql<Date | null>`min(${spiedAds.startedAt})`,
          })
          .from(spiedAds)
          .where(inArray(spiedAds.storeHost, hosts))
          .groupBy(spiedAds.storeHost);
  const adsOf = new Map(ads.map((row) => [row.host, row]));
  const annonces = await loadStoreAds(hosts);

  return {
    ...base,
    stores: hosts.length,
    products: retenus.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      kind: row.kind,
      storeHost: row.storeHost,
      storeLabel: row.storeLabel,
      storeUrl: `https://${row.storeHost}`,
      price: row.priceValue,
      currency: row.currency,
      sales: row.salesCount,
      salesTracked: row.salesCount !== null && row.salesAtFirstSeen !== null ? Math.max(0, row.salesCount - row.salesAtFirstSeen) : null,
      firstSeenAt: row.firstSeenAt.toISOString(),
      firstAdAt: adsOf.get(row.storeHost)?.firstAdAt ? new Date(adsOf.get(row.storeHost)!.firstAdAt!).toISOString() : null,
      activeAds: Number(adsOf.get(row.storeHost)?.activeAds ?? 0),
      slug: row.slug,
      externalId: row.externalId,
      url: productUrl(row.storeHost, row.slug),
      productFirstAdAt: adsOfProduct(annonces.get(row.storeHost), row.slug, row.externalId).firstAdAt?.toISOString() ?? null,
      productAds: adsOfProduct(annonces.get(row.storeHost), row.slug, row.externalId).totalAds,
    })),
  };
}

/** Jours entiers entre deux instants. */
export const daysBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / JOUR_MS));
