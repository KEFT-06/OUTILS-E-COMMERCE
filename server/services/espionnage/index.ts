import { and, asc, count, desc, eq, gte, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { spiedAds } from '@server/db/schema';
import { providers } from '@server/env';
import { lastDiscoveryAt } from '@server/services/radar/discovery';

/**
 * Mur d'espionnage : les publicités qui tournent en ce moment et qui mènent à une boutique de la
 * plateforme. C'est la réponse à « que vendent ceux qui paient de la publicité, et depuis quand ».
 *
 * Ce module ne collecte rien : il LIT ce que le passage payant de la découverte a déposé. Une
 * seule collecte, deux écrans — sinon on paierait deux fois la même donnée.
 *
 * L'ancienneté est ici une vraie donnée, pas une observation : Meta publie la date de début de
 * chaque annonce. Elle sépare deux situations que l'on confond toujours — une annonce de 12 jours
 * est un test en cours, une annonce de 213 jours est un produit qui paie sa publicité depuis sept
 * mois. La seconde a fait ses preuves ; la première n'a rien prouvé.
 *
 * Ce que ce mur ne montrera jamais, faute de donnée et non par choix : le budget, les impressions
 * et la portée. Meta ne les publie que pour l'Union européenne — mesuré à 0 sur 43 annonces.
 */

export interface SpiedAdView {
  id: string;
  /** Identifiant chez Meta : permet de rouvrir l'annonce dans la bibliothèque publicitaire. */
  externalId: string;
  storeHost: string;
  landingUrl: string;
  title: string | null;
  bodyText: string | null;
  advertiser: string | null;
  mediaUrl: string | null;
  mediaKind: string | null;
  startedAt: string | null;
  /** Jours de diffusion selon Meta. null : date de début non publiée. */
  runningDays: number | null;
  variants: number;
  platforms: string[];
  active: boolean;
  lastSeenAt: string;
}

export interface EspionnageFilters {
  /** Jours de diffusion au moins : sépare les tests des offres installées. */
  minDays?: number;
  /** Jours de diffusion au plus : pour ne voir que ce qui vient d'être lancé. */
  maxDays?: number;
  storeHost?: string;
  mediaKind?: 'image' | 'video';
  /** Recherche libre dans le titre, le texte et le nom de l'annonceur. */
  search?: string;
  sort?: 'oldest' | 'newest' | 'variants';
  limit?: number;
}

export interface EspionnageView {
  ads: SpiedAdView[];
  /** Annonces en base, toutes boutiques confondues, avant filtrage. */
  total: number;
  stores: number;
  lastCollectedAt: string | null;
  /** false : aucun jeton de collecte — le mur est vide et l'écran le dit au lieu de mentir. */
  configured: boolean;
  /** Annonces que le palier laisse voir ; null : tout le mur. */
  visibleLimit: number | null;
  /** Annonces retenues par les filtres mais masquées par le palier. Zéro : rien n'est caché. */
  hiddenByPlan: number;
}

const JOUR_MS = 86_400_000;

const runningDays = (startedAt: Date | null, now: Date): number | null =>
  startedAt ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / JOUR_MS)) : null;

function viewOf(row: typeof spiedAds.$inferSelect, now: Date): SpiedAdView {
  return {
    id: row.id,
    externalId: row.externalId,
    storeHost: row.storeHost,
    landingUrl: row.landingUrl,
    title: row.title,
    bodyText: row.bodyText,
    advertiser: row.advertiser,
    mediaUrl: row.mediaUrl,
    mediaKind: row.mediaKind,
    startedAt: row.startedAt?.toISOString() ?? null,
    runningDays: runningDays(row.startedAt, now),
    variants: row.variants,
    platforms: row.platforms,
    active: row.active,
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/**
 * Annonces du mur, filtrées. Lecture pure d'un cache partagé : gratuite, et identique pour tous
 * les comptes puisque les publicités d'une plateforme sont les mêmes pour tout le monde.
 */
export async function listSpiedAds(
  filters: EspionnageFilters = {},
  /** Plafond du palier ; null : tout le mur. */
  visibleLimit: number | null = null,
  now = new Date(),
): Promise<EspionnageView> {
  const demande = Math.min(Math.max(filters.limit ?? 60, 1), 200);
  // Le palier l'emporte toujours sur ce que demande l'écran.
  const limit = visibleLimit === null ? demande : Math.min(demande, visibleLimit);
  const conditions: SQL[] = [];

  /*
    L'ancienneté se filtre sur la DATE de début, pas sur un nombre de jours calculé : comparer des
    dates laisse la base utiliser son index, alors qu'un calcul par ligne l'obligerait à tout lire.
    Attention au sens : « au moins 30 jours de diffusion » veut dire « commencée AVANT il y a 30 jours ».
  */
  if (filters.minDays !== undefined && filters.minDays > 0) {
    conditions.push(and(isNotNull(spiedAds.startedAt), lte(spiedAds.startedAt, new Date(now.getTime() - filters.minDays * JOUR_MS)))!);
  }
  if (filters.maxDays !== undefined) {
    conditions.push(and(isNotNull(spiedAds.startedAt), gte(spiedAds.startedAt, new Date(now.getTime() - filters.maxDays * JOUR_MS)))!);
  }
  if (filters.storeHost) conditions.push(eq(spiedAds.storeHost, filters.storeHost));
  if (filters.mediaKind) conditions.push(eq(spiedAds.mediaKind, filters.mediaKind));
  if (filters.search) {
    // Recherche insensible à la casse sur les trois champs lisibles par un humain.
    const motif = `%${filters.search.replace(/[%_]/g, '')}%`;
    conditions.push(
      or(
        sql`${spiedAds.title} ilike ${motif}`,
        sql`${spiedAds.bodyText} ilike ${motif}`,
        sql`${spiedAds.advertiser} ilike ${motif}`,
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const order =
    filters.sort === 'newest'
      ? [desc(spiedAds.startedAt)]
      : filters.sort === 'variants'
        ? [desc(spiedAds.variants), asc(spiedAds.startedAt)]
        : // Par défaut les plus anciennes : ce sont celles qui ont prouvé quelque chose.
          [asc(spiedAds.startedAt)];

  const rows = await getDb().select().from(spiedAds).where(where).orderBy(...order).limit(limit);

  /*
    Combien d'annonces le palier cache-t-il, parmi celles que les filtres retiennent ? On le
    compte pour le DIRE. Couper en silence laisserait croire que la niche est vide, alors que
    c'est l'abonnement qui borne — un utilisateur qui ne sait pas ce qu'il rate n'a aucune
    raison de payer, et croit le produit pauvre.
  */
  let hiddenByPlan = 0;
  if (visibleLimit !== null) {
    const [correspondantes] = await getDb().select({ total: count() }).from(spiedAds).where(where);
    hiddenByPlan = Math.max(0, Number(correspondantes?.total ?? 0) - rows.length);
  }

  const [totaux] = await getDb()
    .select({ total: count(), stores: sql<number>`count(distinct ${spiedAds.storeHost})` })
    .from(spiedAds);

  return {
    ads: rows.map((row) => viewOf(row, now)),
    total: Number(totaux?.total ?? 0),
    stores: Number(totaux?.stores ?? 0),
    lastCollectedAt: (await lastDiscoveryAt())?.toISOString() ?? null,
    configured: providers.apify,
    visibleLimit,
    hiddenByPlan,
  };
}

/** Boutiques présentes sur le mur, pour alimenter le filtre par boutique. */
export async function spiedStores(): Promise<{ host: string; ads: number }[]> {
  const rows = await getDb()
    .select({ host: spiedAds.storeHost, ads: count() })
    .from(spiedAds)
    .groupBy(spiedAds.storeHost)
    .orderBy(desc(count()))
    .limit(100);
  return rows.map((row) => ({ host: row.host, ads: Number(row.ads) }));
}
