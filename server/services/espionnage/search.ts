import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { sansAccents } from '@server/db/search';
import { adSearchResults, adSearches } from '@server/db/schema';
import { env, providers } from '@server/env';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { effectiveLimits } from '@server/services/accounts';
import { listSpiedAds } from '@server/services/espionnage';
import { collectorDispatchConfigured, requestCollectorPassage } from '@server/services/espionnage/dispatch';
import { fromLibraryRecord } from '@server/services/espionnage/library';
import { readAnyMetaAd } from '@server/services/espionnage/parse';
import { followableOnRadar } from '@server/shared/storefronts';
import {
  FAILED_RUN,
  adLibraryUrl,
  apifyFetch,
  apifyUrl,
  datasetItemSchema,
  ingestDiscoveryItems,
  runSchema,
  runStatusSchema,
} from '@server/services/radar/discovery';

/**
 * Recherche par mot-clé dans la bibliothèque publicitaire, comme sur celle de Meta : on tape
 * « chariow », « formation excel » ou « ebook », et l'on obtient les publicités EN COURS de tous
 * les comptes qui utilisent ce mot, avec leur ancienneté, leur texte, leur visuel et leur lien.
 *
 * Ce qui la sépare de la page de Meta, et que l'écran dit : Meta ne se laisse pas interroger
 * directement, chaque recherche nouvelle passe donc par une collecte chez Apify, qui prend
 * une trentaine de secondes (27 s mesurées le 28/09/2026) et se paie au résultat. D’où trois règles :
 *  1. le résultat est PARTAGÉ — la même recherche, par n'importe quel compte, dans les 24 heures,
 *     est relue gratuitement ;
 *  2. chaque palier a un quota de recherches nouvelles par mois (plans.json) ;
 *  3. le serveur a un plafond mensuel de publicités recherchées, quel que soit le nombre de
 *     comptes : la dépense est bornée.
 *
 * Les annonces qui mènent à une boutique de la plateforme rejoignent aussi le mur : une donnée
 * payée pour une recherche sert deux fois.
 *
 * LA RECHERCHE NE DÉPEND PAS DE LA SEULE LECTURE PAYANTE. Le 11/10/2026, le compte de collecte
 * refusait le serveur : chaque recherche finissait en « Recherche impossible — le service de
 * collecte publicitaire refuse l'accès du serveur », alors que le site a son propre collecteur
 * (dossier collecteur/, Crawlee + Playwright) et un mur de plusieurs milliers d'annonces déjà
 * relevées. Quand la lecture payante manque — pas branchée, refusée, à sec, plafond atteint —, la
 * recherche change de source au lieu d'échouer :
 *   1. elle répond tout de suite avec ce que nos relevés contiennent pour ce mot ;
 *   2. elle est confiée au collecteur, qui relit la bibliothèque pour ce mot et complète la liste
 *      — en quelques minutes s'il peut être appelé à la demande, sinon à son passage de la nuit.
 */

const SEARCH_STALE_MS = 15 * 60_000;
/** Au-delà, une recherche confiée au collecteur n'attend plus : ce qu'elle a trouvé dans nos relevés reste sa réponse. */
const COLLECTOR_WAIT_MS = 36 * 3_600_000;
/** Un passage demandé il y a moins longtemps prendra aussi les recherches arrivées depuis : inutile d'en demander un autre. */
const DISPATCH_WINDOW_MS = 60_000;
/** Une récolte dure quelques secondes ; au-delà de ce délai depuis le lancement, elle a été coupée. */
const HARVEST_STALE_MS = 4 * 60_000;

export const adSearchRequestSchema = z.object({
  query: z.string().trim().min(2, 'Tapez au moins deux caractères.').max(80),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^(ALL|[A-Z]{2})$/)
    .default('ALL'),
});

export type AdSearchRequest = z.infer<typeof adSearchRequestSchema>;

/** Clé de partage : même mot-clé, aux accents, à la casse et aux espaces près. */
export const searchKey = (query: string) => sansAccents(query).toLowerCase().replace(/\s+/g, ' ').trim();

const JOUR_MS = 86_400_000;

export interface LibraryAdView {
  id: string;
  externalId: string;
  storeHost: string | null;
  landingUrl: string | null;
  title: string | null;
  bodyText: string | null;
  advertiser: string | null;
  mediaUrl: string | null;
  mediaKind: string | null;
  /** Aperçu conservé chez nous, pour une annonce tirée de nos relevés ; null sinon. */
  thumbnailUrl: string | null;
  startedAt: string | null;
  runningDays: number | null;
  daysSinceSeen: number;
  variants: number;
  platforms: string[];
  active: boolean;
  lastSeenAt: string;
  pageId: string | null;
  pageUrl: string | null;
  pageAvatarUrl: string | null;
  impressionsText: string | null;
  ctaText: string | null;
  displayFormat: string | null;
  linkCaption: string | null;
  linkDescription: string | null;
  cards: { title: string | null; body: string | null; linkUrl: string | null; ctaText: string | null }[];
}

export interface AdSearchView {
  id: string;
  query: string;
  country: string;
  status: 'running' | 'done' | 'failed';
  adsFound: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** Relue depuis une recherche déjà faite : gratuite, et sans décompte du quota. */
  fromCache: boolean;
  ads: LibraryAdView[];
  /** Annonces trouvées mais masquées par le palier. */
  hiddenByPlan: number;
  /** Annonces qui mènent à une boutique de la plateforme, parmi celles trouvées. */
  platformAds: number;
  /**
   * La liste vient de nos relevés, et le collecteur relit la bibliothèque pour ce mot : elle va se
   * compléter. soon : dans quelques minutes ; tonight : à son passage de la nuit. null : liste finale.
   */
  refreshing: 'soon' | 'tonight' | null;
}

export interface SearchQuota {
  /** Recherches nouvelles lancées ce mois-ci par ce compte. */
  used: number;
  /** null : illimité. */
  limit: number | null;
  /** Recherches nouvelles encore possibles ce mois-ci sur le serveur, tous comptes confondus. */
  serverLeft: number;
}

type SearchRow = typeof adSearches.$inferSelect;

const startOfMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

function adViewOf(fields: NonNullable<ReturnType<typeof readAnyMetaAd>>, searchedAt: Date, position: number, searchId: string): LibraryAdView {
  const started = fields.startedAt ?? null;
  return {
    id: `${searchId}-${position}`,
    externalId: fields.externalId,
    storeHost: fields.storeHost,
    landingUrl: fields.landingUrl,
    title: fields.title && !/\{\{[^}]*\}\}/.test(fields.title) ? fields.title : null,
    bodyText: fields.bodyText ?? null,
    advertiser: fields.advertiser ?? null,
    mediaUrl: fields.mediaUrl ?? null,
    mediaKind: fields.mediaKind ?? null,
    thumbnailUrl: null,
    startedAt: started?.toISOString() ?? null,
    runningDays: started ? Math.max(0, Math.floor((searchedAt.getTime() - started.getTime()) / JOUR_MS)) : null,
    daysSinceSeen: 0,
    variants: fields.variants ?? 1,
    platforms: fields.platforms ?? [],
    active: fields.active ?? true,
    lastSeenAt: searchedAt.toISOString(),
    pageId: fields.pageId ?? null,
    pageUrl: fields.pageUrl ?? null,
    pageAvatarUrl: fields.pageAvatarUrl ?? null,
    impressionsText: fields.impressionsText ?? null,
    ctaText: fields.ctaText ?? null,
    displayFormat: fields.displayFormat ?? null,
    linkCaption: fields.linkCaption ?? null,
    linkDescription: fields.linkDescription ?? null,
    cards: fields.cards ?? [],
  };
}

async function viewOf(row: SearchRow, auth: RequestAuth, fromCache: boolean): Promise<AdSearchView> {
  const rows =
    row.status === 'done'
      ? await getDb().select({ ad: adSearchResults.ad }).from(adSearchResults).where(eq(adSearchResults.searchId, row.id)).orderBy(adSearchResults.position)
      : [];
  const all = rows.map((entry) => entry.ad as unknown as LibraryAdView);
  const visible = effectiveLimits(auth.account).spiedAdsVisible;
  const ads = visible === null ? all : all.slice(0, visible);
  return {
    id: row.id,
    query: row.query,
    country: row.country,
    status: row.status === 'harvesting' ? 'running' : (row.status as AdSearchView['status']),
    adsFound: row.adsFound,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    fromCache,
    ads,
    hiddenByPlan: all.length - ads.length,
    platformAds: all.filter((ad) => followableOnRadar(ad.storeHost)).length,
    refreshing: awaitsCollector(row) ? (collectorDispatchConfigured() ? 'soon' : 'tonight') : null,
  };
}

/** La recherche attend-elle encore la lecture du collecteur ? */
const awaitsCollector = (row: SearchRow, now = new Date()) => row.collector === 'pending' && now.getTime() - row.createdAt.getTime() < COLLECTOR_WAIT_MS;

/** Quota du compte et reste du plafond du serveur, pour ce mois-ci. */
export async function searchQuota(auth: RequestAuth, now = new Date()): Promise<SearchQuota> {
  const month = startOfMonth(now);
  const [mine] = await getDb()
    .select({ n: count() })
    .from(adSearches)
    .where(and(eq(adSearches.requestedBy, auth.account.user.id), gte(adSearches.createdAt, month), or(isNotNull(adSearches.providerRunId), isNotNull(adSearches.collector))));
  const [server] = await getDb()
    .select({ ads: sql<number>`coalesce(sum(${adSearches.resultsLimit}), 0)` })
    .from(adSearches)
    .where(and(gte(adSearches.createdAt, month), isNotNull(adSearches.providerRunId)));
  const spent = Number(server?.ads ?? 0);
  return {
    used: Number(mine?.n ?? 0),
    limit: effectiveLimits(auth.account).adSearchesPerMonth,
    serverLeft: Math.max(0, Math.floor((env.SPY_SEARCH_MONTHLY_ADS - spent) / env.SPY_SEARCH_RESULTS)),
  };
}

/**
 * Réponse tirée de nos relevés, et recherche confiée au collecteur. Ce que le mur contient pour
 * ce mot part tout de suite ; la lecture fraîche de la bibliothèque le remplacera à son arrivée.
 */
async function serveFromOurBase(row: SearchRow, auth: RequestAuth, request: AdSearchRequest, now: Date): Promise<AdSearchView> {
  const ours = await listSpiedAds(
    { search: request.query, ...(request.country === 'ALL' ? {} : { country: request.country }), etat: 'active', sort: 'oldest', limit: env.SPY_SEARCH_RESULTS },
    null,
    now,
  )
    .then((view) => view.ads)
    .catch((error: unknown) => {
      console.warn('[recherche] lecture de nos relevés impossible :', error instanceof Error ? error.message : error);
      return [];
    });

  await getDb().delete(adSearchResults).where(eq(adSearchResults.searchId, row.id));
  if (ours.length > 0) {
    await getDb()
      .insert(adSearchResults)
      .values(ours.map((ad, position) => ({ searchId: row.id, position, ad: { ...ad, id: `${row.id}-${position}` } as unknown as Record<string, unknown> })));
  }
  // Un passage déjà demandé dans la minute prendra aussi cette recherche.
  const [earlier] = await getDb()
    .select({ id: adSearches.id })
    .from(adSearches)
    .where(and(eq(adSearches.collector, 'pending'), gte(adSearches.createdAt, new Date(now.getTime() - DISPATCH_WINDOW_MS))))
    .limit(1);
  const [served] = await getDb()
    .update(adSearches)
    .set({ status: 'done', adsFound: ours.length, error: null, collector: 'pending', providerRunId: null, datasetId: null, finishedAt: now })
    .where(eq(adSearches.id, row.id))
    .returning();
  if (!earlier) void requestCollectorPassage();
  return viewOf(served ?? row, auth, false);
}

/**
 * Lance une recherche, ou relit la même faite depuis moins de 24 heures. Les refus du palier
 * passent AVANT tout appel au fournisseur : une recherche refusée ne coûte rien.
 *
 * La lecture payante d'abord, quand elle est branchée et qu'il lui reste du budget ce mois-ci ;
 * sinon, ou si elle se dérobe au lancement, nos relevés et notre collecteur (voir l'en-tête).
 */
export async function startAdSearch(auth: RequestAuth, request: AdSearchRequest, now = new Date()): Promise<AdSearchView> {
  const key = searchKey(request.query);
  if (key.length < 2) throw new AppError(400, 'Tapez au moins deux caractères.', 'SPY_SEARCH_INVALID');

  const [recent] = await getDb()
    .select()
    .from(adSearches)
    .where(
      and(
        eq(adSearches.queryKey, key),
        eq(adSearches.country, request.country),
        inArray(adSearches.status, ['running', 'harvesting', 'done']),
        gte(adSearches.createdAt, new Date(now.getTime() - env.SPY_SEARCH_CACHE_HOURS * 3_600_000)),
      ),
    )
    .orderBy(desc(adSearches.createdAt))
    .limit(1);
  if (recent) return viewOf(recent, auth, true);

  const quota = await searchQuota(auth, now);
  if (quota.limit !== null && quota.limit === 0) {
    throw new AppError(
      403,
      'Votre palier permet de consulter les recherches déjà faites, mais pas d’en lancer de nouvelles. Passez à un palier supérieur pour chercher n’importe quel mot-clé.',
      'SPY_SEARCH_PLAN',
    );
  }
  if (quota.limit !== null && quota.used >= quota.limit) {
    throw new AppError(
      429,
      `Vous avez lancé vos ${quota.limit} recherches nouvelles de ce mois. Les recherches déjà faites restent consultables gratuitement.`,
      'SPY_SEARCH_QUOTA',
    );
  }

  const [row] = await getDb()
    .insert(adSearches)
    .values({ query: request.query, queryKey: key, country: request.country, requestedBy: auth.account.user.id, resultsLimit: env.SPY_SEARCH_RESULTS })
    .returning();

  // Le plafond mensuel du serveur borne la DÉPENSE : une fois atteint, la recherche passe par nos relevés, qui ne coûtent rien.
  if (!providers.apify || quota.serverLeft <= 0) return serveFromOurBase(row!, auth, request, now);

  try {
    const response = await apifyFetch(apifyUrl(`/acts/${env.APIFY_ADS_ACTOR}/runs`), {
      method: 'POST',
      body: JSON.stringify({
        startUrls: [{ url: adLibraryUrl(request.query, request.country) }],
        // Plafond facturé : la borne du coût de cette recherche.
        resultsLimit: env.SPY_SEARCH_RESULTS,
        activeStatus: 'active',
        sorting: 'total_impressions',
      }),
    });
    const parsed = runSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new AppError(502, 'La recherche n’a pas pu être lancée (réponse illisible).', 'SPY_SEARCH_FAILED');
    const [started] = await getDb()
      .update(adSearches)
      .set({ providerRunId: parsed.data.data.id, datasetId: parsed.data.data.defaultDatasetId })
      .where(eq(adSearches.id, row!.id))
      .returning();
    return viewOf(started!, auth, false);
  } catch (error) {
    // Compte refusé, réserve épuisée, service muet : ce n'est pas l'affaire de celui qui cherche.
    console.warn('[recherche] lecture payante indisponible, la recherche passe par nos relevés :', error instanceof AppError ? error.code : error);
    return serveFromOurBase(row!, auth, request, now);
  }
}

/** Recherches que le collecteur doit lire à son prochain passage, les plus anciennes d'abord. */
export async function pendingCollectorSearches(now = new Date(), limit = 12): Promise<{ id: string; query: string; country: string; max: number }[]> {
  const rows = await getDb()
    .select({ id: adSearches.id, query: adSearches.query, country: adSearches.country })
    .from(adSearches)
    .where(and(eq(adSearches.collector, 'pending'), gte(adSearches.createdAt, new Date(now.getTime() - COLLECTOR_WAIT_MS))))
    .orderBy(asc(adSearches.createdAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, max: env.SPY_SEARCH_RESULTS }));
}

/** Rang à partir duquel sont rangées, dans une recherche, les annonces tirées de nos relevés : après la lecture fraîche. */
const OURS_FROM = 10_000;

/**
 * Versement, par le collecteur, d'un lot d'annonces lues dans la bibliothèque pour une recherche.
 *
 * La lecture fraîche passe en tête ; ce que nos relevés avaient donné reste À LA SUITE, sans
 * doublon. Essai réel du 11/10/2026 : pour « formation », nos relevés rendaient dix boutiques du
 * marché de l'auteur, la bibliothèque dix écoles du monde entier — remplacer les unes par les
 * autres retirait justement les concurrents qu'il cherche. `first` : premier lot ; `done` :
 * dernier lot, la recherche n'attend plus (même si la lecture revient vide).
 */
export async function pourCollectorSearch(input: { id: string; items: unknown[]; first: boolean; done: boolean }, now = new Date()): Promise<{ stored: number } | null> {
  const [row] = await getDb().select().from(adSearches).where(eq(adSearches.id, input.id)).limit(1);
  if (!row || row.collector !== 'pending') return null;

  // Premier lot : ce qui est déjà là vient de nos relevés, et cède les premiers rangs.
  if (input.first) {
    await getDb()
      .update(adSearchResults)
      .set({ position: sql`${adSearchResults.position} + ${OURS_FROM}` })
      .where(and(eq(adSearchResults.searchId, row.id), lt(adSearchResults.position, OURS_FROM)));
  }
  const read = await getDb()
    .select({ ad: adSearchResults.ad })
    .from(adSearchResults)
    .where(and(eq(adSearchResults.searchId, row.id), lt(adSearchResults.position, OURS_FROM)));
  const seen = new Set(read.map((entry) => (entry.ad as unknown as LibraryAdView).externalId));
  const fresh = input.items
    .map((item) => readAnyMetaAd(fromLibraryRecord(item), now))
    .filter((ad): ad is NonNullable<typeof ad> => ad !== null && !seen.has(ad.externalId) && Boolean(seen.add(ad.externalId)))
    .slice(0, Math.max(0, row.resultsLimit - read.length));

  if (fresh.length > 0) {
    await getDb()
      .insert(adSearchResults)
      .values(fresh.map((ad, index) => ({ searchId: row.id, position: read.length + index, ad: adViewOf(ad, now, read.length + index, row.id) as unknown as Record<string, unknown> })));
    // Une annonce de nos relevés que la lecture fraîche a retrouvée n'est pas montrée deux fois.
    await getDb()
      .delete(adSearchResults)
      .where(
        and(
          eq(adSearchResults.searchId, row.id),
          gte(adSearchResults.position, OURS_FROM),
          inArray(sql<string>`${adSearchResults.ad}->>'externalId'`, fresh.map((ad) => ad.externalId)),
        ),
      );
  }
  if (input.done || fresh.length > 0) {
    const [{ total } = { total: 0 }] = await getDb().select({ total: count() }).from(adSearchResults).where(eq(adSearchResults.searchId, row.id));
    await getDb()
      .update(adSearches)
      .set({ adsFound: Number(total), ...(input.done ? { collector: 'done', finishedAt: now } : {}) })
      .where(eq(adSearches.id, row.id));
  }
  return { stored: fresh.length };
}

/** Relève le passage d'une recherche en cours et verse son résultat quand il est terminé. */
async function advance(row: SearchRow, now: Date): Promise<SearchRow> {
  /*
    Récolte interrompue — instance coupée entre « harvesting » et « done » : la recherche restait
    « en cours » pour toujours, et resservie telle quelle à quiconque cherchait le même mot
    pendant 24 h. Elle repart ; la récolte remplace ses résultats, un doublon est donc sans effet.
  */
  if (row.status === 'harvesting' && now.getTime() - row.createdAt.getTime() > HARVEST_STALE_MS) {
    const [reset] = await getDb()
      .update(adSearches)
      .set({ status: 'running' })
      .where(and(eq(adSearches.id, row.id), eq(adSearches.status, 'harvesting')))
      .returning();
    if (reset) row = reset;
  }
  if (row.status !== 'running' || !row.providerRunId || !row.datasetId) return row;
  const state = runStatusSchema.safeParse(
    await (await apifyFetch(apifyUrl(`/actor-runs/${encodeURIComponent(row.providerRunId)}`))).json().catch(() => null),
  );
  const status = state.success ? state.data.data.status.toUpperCase() : 'UNKNOWN';

  if (status === 'SUCCEEDED') {
    const [claimed] = await getDb()
      .update(adSearches)
      .set({ status: 'harvesting' })
      .where(and(eq(adSearches.id, row.id), eq(adSearches.status, 'running')))
      .returning();
    if (!claimed) return row;
    try {
      const items = datasetItemSchema.safeParse(
        await (await apifyFetch(apifyUrl(`/datasets/${encodeURIComponent(row.datasetId)}/items`, '&clean=true&format=json'))).json().catch(() => null),
      );
      if (!items.success) throw new Error('résultat illisible');
      const seen = new Set<string>();
      const ads = items.data
        .map((item) => readAnyMetaAd(item, now))
        .filter((ad): ad is NonNullable<typeof ad> => ad !== null && !seen.has(ad.externalId) && Boolean(seen.add(ad.externalId)));
      await getDb().delete(adSearchResults).where(eq(adSearchResults.searchId, row.id));
      if (ads.length > 0) {
        await getDb()
          .insert(adSearchResults)
          .values(ads.map((ad, position) => ({ searchId: row.id, position, ad: adViewOf(ad, now, position, row.id) as unknown as Record<string, unknown> })));
      }
      // Les annonces de la plateforme rejoignent aussi le mur : la donnée est déjà payée.
      await ingestDiscoveryItems(items.data, now).catch((error: unknown) =>
        console.warn('[recherche] versement au mur impossible :', error instanceof Error ? error.message : error),
      );
      const [done] = await getDb()
        .update(adSearches)
        .set({ status: 'done', adsFound: ads.length, finishedAt: new Date() })
        .where(eq(adSearches.id, row.id))
        .returning();
      return done ?? row;
    } catch (error) {
      await getDb().update(adSearches).set({ status: 'running' }).where(eq(adSearches.id, row.id));
      console.warn('[recherche] récolte impossible :', error instanceof Error ? error.message : error);
      return row;
    }
  }

  if (FAILED_RUN.has(status) || now.getTime() - row.createdAt.getTime() > SEARCH_STALE_MS) {
    const [failed] = await getDb()
      .update(adSearches)
      .set({
        status: 'failed',
        error: 'La recherche n’a pas abouti chez le fournisseur. Relancez-la dans un moment.',
        finishedAt: new Date(),
      })
      .where(and(eq(adSearches.id, row.id), eq(adSearches.status, 'running')))
      .returning();
    return failed ?? row;
  }
  return row;
}

const searchIdSchema = z.string().uuid();

/** État d'une recherche ; celle qui tourne encore est relevée au passage. Lisible par tout compte. */
export async function getAdSearch(auth: RequestAuth, id: string | undefined, now = new Date()): Promise<AdSearchView> {
  const parsed = searchIdSchema.safeParse(id);
  const missing = new AppError(404, 'Recherche introuvable.', 'SPY_SEARCH_NOT_FOUND');
  if (!parsed.success) throw missing;
  const [row] = await getDb().select().from(adSearches).where(eq(adSearches.id, parsed.data)).limit(1);
  if (!row) throw missing;
  const current = providers.apify ? await advance(row, now).catch(() => row) : row;
  return viewOf(current, auth, current.requestedBy !== auth.account.user.id);
}

/** Recherches récentes du service : relues gratuitement, elles servent de point de départ. */
export async function recentAdSearches(now = new Date(), limit = 12): Promise<{ id: string; query: string; country: string; adsFound: number; createdAt: string }[]> {
  const rows = await getDb()
    .select()
    .from(adSearches)
    .where(and(eq(adSearches.status, 'done'), gte(adSearches.createdAt, new Date(now.getTime() - env.SPY_SEARCH_CACHE_HOURS * 3_600_000))))
    .orderBy(desc(adSearches.createdAt))
    .limit(limit * 3);
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = `${row.queryKey}|${row.country}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((row) => ({ id: row.id, query: row.query, country: row.country, adsFound: row.adsFound ?? 0, createdAt: row.createdAt.toISOString() }));
}
