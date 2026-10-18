import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { discoveredStores, marketProducts, spiedAds, watches } from '@server/db/schema';
import { AppError } from '@server/middleware';
import { normalHost } from '@server/services/market';
import { adsOfProduct, loadStoreAds, productUrl } from '@server/services/market/productAds';
import { chariowStoreSource } from '@server/services/radar/sources/chariowStore';
import { firecrawlConfigured } from '@server/services/radar/sources/firecrawl';
import { ingestStorefrontReading } from '@server/services/radar/storefrontReadings';
import { runInBackground } from '@server/shared/backgroundWork';
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
 *
 * Demande du propriétaire (18/10/2026) : « quand on clique sur Voir dans Radar d'une boutique, on
 * affiche toutes les informations nécessaires automatiquement — pas seulement ce que Firecrawl a
 * collecté à l'avance : qu'il puisse le faire à la demande ». Quand la vitrine se lit par Firecrawl,
 * une fiche dont le dernier relevé a plus de six heures est donc RELUE à l'ouverture : l'écran montre
 * aussitôt les chiffres connus, datés, puis les chiffres frais dès qu'ils arrivent.
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
  slug: string | null;
  /** Identifiant du produit chez la plateforme, « prd_… » : certaines publicités mènent à lui. */
  externalId: string;
  /** Page du produit sur sa vitrine. */
  url: string;
  /** Début de la plus ancienne publicité connue de CE produit sur Meta, et ses annonces. */
  firstAdAt: string | null;
  activeAds: number;
  totalAds: number;
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
  /** Le catalogue affiché est relu en ce moment : l'écran redemande la fiche, les chiffres frais arrivent. */
  refreshing: boolean;
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
/** Au-delà, une fiche ouverte relit sa vitrine : les chiffres d'une boutique qu'on regarde doivent être ceux du jour. */
const REFRESH_AFTER_MS = 6 * 3_600_000;
/**
 * Une lecture demandée il y a moins longtemps est tenue pour en cours, d'une instance du serveur à
 * l'autre : l'écran redemande la fiche toutes les cinq secondes, et chaque demande peut tomber sur
 * une instance différente — sans cette marque, chacune relancerait une lecture payée.
 */
const READING_WINDOW_MS = 90_000;

/** Relevés en cours, par hôte : dix écrans ouverts sur la même boutique ne font qu'une lecture. */
const reading = new Map<string, Promise<void>>();
/** Vitrines qui viennent de ne pas répondre : on ne les resollicite pas avant ce délai. */
const RETRY_AFTER_MS = 10 * 60_000;
const failedAt = new Map<string, number>();

function readCatalogOnce(host: string, known: { externalId: string; label: string | null } | null = null, previousIndexedAt: Date | null = null): Promise<void> {
  const running = reading.get(host);
  if (running) return running;
  const task = (async () => {
    try {
      // Les autres instances voient la lecture en cours, et n'en lancent pas une seconde.
      await getDb()
        .insert(discoveredStores)
        .values({ host, label: known?.label ?? null, storeExternalId: known?.externalId ?? null, indexedAt: new Date() })
        .onConflictDoUpdate({ target: discoveredStores.host, set: { indexedAt: new Date() } });
      // L'identifiant déjà connu évite de relire la page de la boutique : une page de moins à payer.
      const target = known ? { externalId: known.externalId, label: known.label ?? host } : await chariowStoreSource.resolve(host);
      const observations = await chariowStoreSource.observe(target.externalId);
      const now = new Date();
      // Index du marché, et surveillances de cette boutique par tous les comptes : un relevé sert à tous.
      await ingestStorefrontReading({ externalId: target.externalId, host, label: target.label }, observations, now);
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
      // La lecture n'a rien donné : la boutique garde la date de son dernier vrai relevé.
      await getDb()
        .update(discoveredStores)
        .set({ indexedAt: previousIndexedAt })
        .where(eq(discoveredStores.host, host))
        .catch(() => undefined);
      console.warn('[marché] fiche de boutique, relevé impossible :', host, error instanceof Error ? error.message : error);
    } finally {
      reading.delete(host);
    }
  })();
  reading.set(host, task);
  // En hébergement sans serveur, la lecture se poursuit après la réponse : l'hébergeur en est prévenu.
  runInBackground(() => task, 'fiche de boutique');
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
  let refreshing = false;
  let unreachable = false;
  const [dejaConnue] = await db.select().from(discoveredStores).where(eq(discoveredStores.host, host)).limit(1);
  const dernierReleve = rows.reduce((latest, row) => Math.max(latest, row.lastSeenAt.getTime()), 0);
  const perime = rows.length > 0 && Date.now() - dernierReleve > REFRESH_AFTER_MS;
  // Une lecture vient d'être demandée (ici ou sur une autre instance) et n'a pas encore rendu ses chiffres.
  const lectureEnCours =
    reading.has(host) || (dejaConnue?.indexedAt != null && dejaConnue.indexedAt.getTime() > dernierReleve && Date.now() - dejaConnue.indexedAt.getTime() < READING_WINDOW_MS);
  /*
    Jamais relevée : on la lit maintenant, quel que soit le lecteur. Relevée il y a plus de six
    heures : on la relit seulement par Firecrawl — lue directement, la plateforme refuse le serveur
    depuis le 11/10/2026, et chaque ouverture la solliciterait pour rien.
  */
  const aLire = followable && (rows.length === 0 || (perime && firecrawlConfigured()));
  if (aLire && lectureEnCours) {
    if (rows.length === 0) pending = true;
    else refreshing = true;
  } else if (aLire) {
    const echec = failedAt.get(host);
    if (echec !== undefined && Date.now() - echec < RETRY_AFTER_MS) unreachable = rows.length === 0;
    else {
      const connue = rows[0] ? { externalId: rows[0].storeExternalId, label: rows[0].storeLabel } : dejaConnue?.storeExternalId ? { externalId: dejaConnue.storeExternalId, label: dejaConnue.label } : null;
      // Passé le délai, la lecture continue et l'écran revient la chercher.
      const fini = await Promise.race([
        readCatalogOnce(host, connue, dejaConnue?.indexedAt ?? null).then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), FIRST_READ_MS)),
      ]);
      if (!fini) {
        if (rows.length === 0) pending = true;
        else refreshing = true;
      } else {
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

  const annonces = (await loadStoreAds([host])).get(host);
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
      slug: row.slug,
      externalId: row.externalId,
      url: productUrl(host, row.slug),
      firstAdAt: iso(adsOfProduct(annonces, row.slug, row.externalId).firstAdAt),
      activeAds: adsOfProduct(annonces, row.slug, row.externalId).activeAds,
      totalAds: adsOfProduct(annonces, row.slug, row.externalId).totalAds,
    })),
    liveItems: live.length,
    endedItems: rows.length - live.length,
    totalSales: counted.reduce((total, row) => total + (row.salesCount ?? 0), 0),
    itemsWithSales: counted.length,
    pending,
    refreshing,
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
