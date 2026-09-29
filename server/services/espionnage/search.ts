import { and, count, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { sansAccents } from '@server/db/search';
import { adSearchResults, adSearches } from '@server/db/schema';
import { env, providers } from '@server/env';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { effectiveLimits } from '@server/services/accounts';
import { readAnyMetaAd } from '@server/services/espionnage/parse';
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
 */

const SEARCH_STALE_MS = 15 * 60_000;
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
  thumbnailUrl: null;
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
    title: fields.title ?? null,
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
    platformAds: all.filter((ad) => ad.storeHost).length,
  };
}

/** Quota du compte et reste du plafond du serveur, pour ce mois-ci. */
export async function searchQuota(auth: RequestAuth, now = new Date()): Promise<SearchQuota> {
  const month = startOfMonth(now);
  const [mine] = await getDb()
    .select({ n: count() })
    .from(adSearches)
    .where(and(eq(adSearches.requestedBy, auth.account.user.id), gte(adSearches.createdAt, month), isNotNull(adSearches.providerRunId)));
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
 * Lance une recherche, ou relit la même faite depuis moins de 24 heures. Les refus de quota
 * passent AVANT tout appel au fournisseur : une recherche refusée ne coûte rien.
 */
export async function startAdSearch(auth: RequestAuth, request: AdSearchRequest, now = new Date()): Promise<AdSearchView> {
  if (!providers.apify) {
    throw new AppError(503, 'La recherche dans la bibliothèque publicitaire n’est pas configurée sur ce serveur.', 'SPY_SEARCH_NOT_CONFIGURED');
  }
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
  if (quota.serverLeft <= 0) {
    throw new AppError(
      429,
      'Le plafond mensuel de recherches nouvelles du service est atteint. Les recherches déjà faites restent consultables ; les nouvelles reprennent le mois prochain.',
      'SPY_SEARCH_BUDGET',
    );
  }

  const [row] = await getDb()
    .insert(adSearches)
    .values({ query: request.query, queryKey: key, country: request.country, requestedBy: auth.account.user.id, resultsLimit: env.SPY_SEARCH_RESULTS })
    .returning();

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
    await getDb()
      .update(adSearches)
      .set({ status: 'failed', error: error instanceof AppError ? error.message : 'Lancement impossible.', finishedAt: new Date() })
      .where(eq(adSearches.id, row!.id));
    throw error;
  }
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
