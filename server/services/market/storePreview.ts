import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { discoveredStores, marketProducts, spiedAds, watches } from '@server/db/schema';
import { AppError } from '@server/middleware';
import { indexStoreCatalog, normalHost } from '@server/services/market';
import { chariowStoreSource } from '@server/services/radar/sources/chariowStore';
import { type Storefront, followableOnRadar, storefrontOfHost } from '@server/shared/storefronts';

/**
 * Fiche d'une boutique, en lecture seule : son catalogue connu, ses ventes, ses publicités.
 *
 * « Ouvrir dans le Radar », depuis une publicité ou une alerte, METTAIT la boutique sous
 * surveillance pour pouvoir l'afficher. Quota atteint, l'ajout était refusé (403) et l'on restait
 * devant un message d'erreur, sans la boutique. Regarder n'est pas surveiller : cette fiche se lit
 * sans rien ajouter au compte, et la mise sous surveillance redevient un geste qu'on choisit.
 *
 * Le catalogue vient de l'index du marché (commun à tous les comptes : c'est la vitrine publique
 * de la boutique). S'il n'y est pas encore, il est relevé une fois, à la demande.
 */

export interface StorePreviewProduct {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  currency: string | null;
  /** Ventes cumulées depuis la création du produit. null : non publiées. */
  sales: number | null;
  /** Ventes depuis notre premier relevé. null : non publiées. */
  salesTracked: number | null;
  firstSeenAt: string;
  /** Mise en ligne constatée : le produit est apparu après notre premier relevé de la boutique. */
  launchedAt: string | null;
  endedAt: string | null;
}

export interface StorePreviewView {
  host: string;
  label: string;
  url: string;
  storefront: Storefront | null;
  /** Le Radar sait relever le catalogue de cette boutique, donc la surveiller. */
  followable: boolean;
  /** Surveillance du compte sur cette boutique, s'il y en a déjà une. */
  watchId: string | null;
  products: StorePreviewProduct[];
  liveItems: number;
  endedItems: number;
  /** Ventes cumulées des produits en vente dont le compte est publié. */
  totalSales: number;
  itemsWithSales: number;
  /** Le premier relevé du catalogue est en cours : l'écran redemande la fiche dans un instant. */
  pending: boolean;
  /** La vitrine n'a pas répondu au relevé : la fiche montre ce qui reste connu, ses publicités. */
  unreachable: boolean;
  /** Offres que la boutique met en avant dans ses publicités, les plus diffusées d'abord. */
  advertised: { title: string; url: string; ads: number; active: number }[];
  /** Dernier relevé du catalogue. null : jamais relevé. */
  indexedAt: string | null;
  ads: { active: number; total: number; videos: number; firstAdAt: string | null; checkedAt: string | null };
}

/** Temps laissé au premier relevé avant de répondre « en cours » : l'écran ne reste pas figé. */
const FIRST_READ_MS = 9_000;

/** Relevés en cours, par hôte : dix écrans ouverts sur la même boutique ne font qu'une lecture. */
const reading = new Map<string, Promise<void>>();
/** Vitrines qui viennent de ne pas répondre : on ne les resollicite pas avant ce délai. */
const RETRY_AFTER_MS = 10 * 60_000;
const failedAt = new Map<string, number>();

function readCatalogOnce(host: string): Promise<void> {
  const running = reading.get(host);
  if (running) return running;
  const task = (async () => {
    try {
      const target = await chariowStoreSource.resolve(host);
      const observations = await chariowStoreSource.observe(target.externalId);
      const now = new Date();
      await indexStoreCatalog({ externalId: target.externalId, host, label: target.label }, observations, now);
      failedAt.delete(host);
      // La boutique entre dans la file des relevés quotidiens : sa fiche restera à jour.
      await getDb()
        .insert(discoveredStores)
        .values({ host, label: target.label, storeExternalId: target.externalId, indexedAt: now })
        .onConflictDoUpdate({
          target: discoveredStores.host,
          set: { storeExternalId: target.externalId, indexedAt: now, label: sql`coalesce(${discoveredStores.label}, excluded.label)` },
        });
    } catch (error) {
      // Mémoire bornée : au-delà, on repart de zéro plutôt que de grossir sans fin.
      if (failedAt.size > 500) failedAt.clear();
      failedAt.set(host, Date.now());
      console.warn('[marché] fiche de boutique, relevé impossible :', host, error instanceof Error ? error.message : error);
    } finally {
      reading.delete(host);
    }
  })();
  reading.set(host, task);
  return task;
}

const iso = (value: Date | string | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

export async function storePreview(userId: string, rawHost: string): Promise<StorePreviewView> {
  const host = normalHost(rawHost.trim());
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{1,63}){1,3}$/.test(host)) {
    throw new AppError(400, 'Cette adresse de boutique n’est pas reconnue.', 'STORE_HOST_INVALID');
  }
  const db = getDb();
  const followable = followableOnRadar(host);

  const lire = () =>
    db
      .select()
      .from(marketProducts)
      .where(eq(marketProducts.storeHost, host))
      .orderBy(sql`(${marketProducts.endedAt} is not null)`, sql`${marketProducts.salesCount} desc nulls last`, marketProducts.name)
      .limit(300);

  let rows = await lire();
  let pending = false;
  let unreachable = false;
  if (rows.length === 0 && followable) {
    const echec = failedAt.get(host);
    if (echec !== undefined && Date.now() - echec < RETRY_AFTER_MS) unreachable = true;
    else {
      // Jamais relevée : on la lit maintenant. Passé le délai, le relevé continue et l'écran revient.
      const fini = await Promise.race([
        readCatalogOnce(host).then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), FIRST_READ_MS)),
      ]);
      if (!fini) pending = true;
      else {
        rows = await lire();
        unreachable = rows.length === 0 && failedAt.has(host);
      }
    }
  }

  const [[adsRow], [known], mine, offres] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`count(*) filter (where ${spiedAds.active})`,
        videos: sql<number>`count(*) filter (where ${spiedAds.mediaKind} = 'video')`,
        firstAdAt: sql<Date | null>`min(${spiedAds.startedAt})`,
        checkedAt: sql<Date | null>`max(${spiedAds.lastSeenAt})`,
      })
      .from(spiedAds)
      .where(eq(spiedAds.storeHost, host)),
    db.select().from(discoveredStores).where(eq(discoveredStores.host, host)).limit(1),
    db.select({ id: watches.id, externalId: watches.externalId, url: watches.url }).from(watches).where(and(eq(watches.userId, userId))),
    // Ce que la boutique pousse en publicité : lisible même quand sa vitrine ne répond pas.
    db
      .select({
        url: spiedAds.landingUrl,
        title: sql<string | null>`max(${spiedAds.title})`,
        ads: sql<number>`count(*)`,
        active: sql<number>`count(*) filter (where ${spiedAds.active})`,
      })
      .from(spiedAds)
      .where(eq(spiedAds.storeHost, host))
      .groupBy(spiedAds.landingUrl)
      .orderBy(sql`count(*) filter (where ${spiedAds.active}) desc`, sql`count(*) desc`)
      .limit(8),
  ]);

  const storeExternalId = rows[0]?.storeExternalId ?? known?.storeExternalId ?? null;
  const watch = mine.find((entry) => (storeExternalId && entry.externalId === storeExternalId) || (entry.url ? normalHost(entry.url) === host : false));

  const live = rows.filter((row) => row.endedAt === null);
  const counted = live.filter((row) => row.salesCount !== null);
  const lastSeen = rows.reduce<Date | null>((latest, row) => (latest === null || row.lastSeenAt > latest ? row.lastSeenAt : latest), null);

  return {
    host,
    label: rows.find((row) => row.storeLabel)?.storeLabel ?? known?.label ?? host,
    url: `https://${host}`,
    storefront: storefrontOfHost(host),
    followable,
    watchId: watch?.id ?? null,
    products: rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      price: row.priceValue,
      currency: row.currency,
      sales: row.salesCount,
      salesTracked: row.salesCount !== null && row.salesAtFirstSeen !== null ? Math.max(0, row.salesCount - row.salesAtFirstSeen) : null,
      firstSeenAt: row.firstSeenAt.toISOString(),
      launchedAt: iso(row.launchedAt),
      endedAt: iso(row.endedAt),
    })),
    liveItems: live.length,
    endedItems: rows.length - live.length,
    totalSales: counted.reduce((total, row) => total + (row.salesCount ?? 0), 0),
    itemsWithSales: counted.length,
    pending,
    unreachable,
    advertised: offres
      .filter((offre) => offre.url.startsWith('https://'))
      .map((offre) => ({ title: offre.title?.trim() || 'Offre sans titre', url: offre.url, ads: Number(offre.ads), active: Number(offre.active) })),
    indexedAt: iso(lastSeen ?? known?.indexedAt),
    ads: {
      total: Number(adsRow?.total ?? 0),
      active: Number(adsRow?.active ?? 0),
      videos: Number(adsRow?.videos ?? 0),
      firstAdAt: iso(adsRow?.firstAdAt),
      checkedAt: iso(adsRow?.checkedAt),
    },
  };
}
