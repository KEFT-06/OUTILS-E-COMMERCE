import { and, asc, count, desc, eq, gte, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { containsIgnoringAccents } from '@server/db/search';
import { spiedAds } from '@server/db/schema';
import { providers } from '@server/env';
import { harvestCollectionRuns, lastDiscoveryAt, pendingCollectionRuns } from '@server/services/radar/discovery';
import { isMetaMediaUrl, storeMissingAvatars, storeMissingThumbnails } from '@server/services/espionnage/media';
import { runInBackground } from '@server/shared/backgroundWork';
import { STOREFRONTS, type Storefront } from '@server/shared/storefronts';

/**
 * Mur d'espionnage : les publicités qui tournent en ce moment et qui mènent à une boutique
 * reconnue (Chariow, Maketou, Shopify). C'est la réponse à « que vendent ceux qui paient de la
 * publicité, et depuis quand ».
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
  /** Le fichier d'origine (vidéo ou image) peut être téléchargé. */
  downloadable: boolean;
  /** Adresse de la vidéo chez Meta, pour la lire sur le mur. null : pas une vidéo, ou adresse inconnue. */
  videoUrl: string | null;
  /** Pays où une collecte a vu cette annonce en diffusion (ISO). Vide : inconnu. */
  countries: string[];
  startedAt: string | null;
  /**
   * Jours pendant lesquels l'annonce a été VUE en diffusion, de sa date de début au dernier
   * passage qui l'a retrouvée. null : date de début non publiée par Meta.
   */
  runningDays: number | null;
  /**
   * Jours écoulés depuis le dernier passage qui a vu cette annonce. Au-delà d'une collecte,
   * on ne sait plus si elle tourne encore : le mur doit le dire plutôt que de le supposer.
   */
  daysSinceSeen: number;
  variants: number;
  platforms: string[];
  active: boolean;
  lastSeenAt: string;
  /** Aperçu conservé chez nous (ne périme pas) ; null : seule l'adresse de Meta, qui expire. */
  thumbnailUrl: string | null;
  pageId: string | null;
  pageUrl: string | null;
  /** Photo de profil de l'annonceur : notre copie si elle existe, sinon l'adresse de Meta. */
  pageAvatarUrl: string | null;
  /** Tranche d'impressions publiée par Meta (« <100 »…), quand elle existe. */
  impressionsText: string | null;
  ctaText: string | null;
  displayFormat: string | null;
  linkCaption: string | null;
  linkDescription: string | null;
  cards: { title: string | null; body: string | null; linkUrl: string | null; ctaText: string | null }[];
}

export interface EspionnageFilters {
  /** Jours de diffusion au moins : sépare les tests des offres installées. */
  minDays?: number;
  /** Jours de diffusion au plus : pour ne voir que ce qui vient d'être lancé. */
  maxDays?: number;
  storeHost?: string;
  /** Toutes les annonces d'un annonceur, comme « voir toutes les annonces » chez Meta. */
  pageId?: string;
  mediaKind?: 'image' | 'video';
  /** Pays de diffusion relevé (ISO) : ne garde que les annonces vues dans ce pays. */
  country?: string;
  /** Plateforme de la boutique où mène l'annonce. */
  storefront?: Storefront;
  /**
   * État déclaré par Meta à la dernière collecte qui a vu l'annonce. La bibliothèque de Meta
   * propose ce filtre en premier, et c'est souvent la seule question : « qu'est-ce qui tourne
   * encore ? ». Une absence de collecte ne vaut pas arrêt — voir `daysSinceSeen`.
   */
  etat?: 'active' | 'arretee';
  /** Recherche libre dans le titre, le texte et le nom de l'annonceur. */
  search?: string;
  /** Annonces qui mènent à ce produit : son nom d'adresse et/ou son identifiant, séparés par une virgule. */
  product?: string;
  sort?: 'oldest' | 'newest' | 'variants';
  limit?: number;
  /**
   * Série demandée, la première valant 0. Le mur servait toujours les mêmes premières annonces
   * du tri : « Actualiser » passe à la série suivante, et revient à la première après la dernière.
   */
  batch?: number;
}

export interface EspionnageView {
  ads: SpiedAdView[];
  /** Pays pour lesquels au moins une annonce a été relevée (ISO). */
  countries: string[];
  /** Plateformes présentes sur le mur, avec leur nombre d'annonces : on ne propose que ce qui existe. */
  storefronts: { id: Storefront; ads: number }[];
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
  /** Annonces retenues par les filtres, toutes séries confondues. */
  matching: number;
  /** Série servie (0 = la première) et nombre de séries : « Actualiser » passe à la suivante. */
  batch: number;
  batches: number;
  /** Annonces servies par série : de quoi dire « annonces 101 à 200 sur 380 ». */
  pageSize: number;
  /** Une collecte tourne chez le fournisseur : de nouvelles annonces arrivent dans quelques minutes. */
  collecting: boolean;
}

const JOUR_MS = 86_400_000;

/** Plafond de page, tous paliers confondus : deux cents vignettes suffisent à alourdir l'écran. */
const PLAFOND_ABSOLU = 200;

/**
 * Durée pendant laquelle l'annonce a été VUE en diffusion : de sa date de début au dernier
 * passage qui l'a retrouvée.
 *
 * Elle se comptait jusqu'à aujourd'hui, et c'était faux d'une façon qui retournait le mur
 * contre son propre propos. Une collecte ne désactive pas les annonces qu'elle ne retrouve
 * pas — elle n'en ramène qu'un nombre plafonné, trié par impressions, si bien qu'une absence
 * ne prouve pas un arrêt. Une annonce arrêtée le lendemain de sa collecte continuait donc de
 * vieillir indéfiniment. Le tri par défaut montrant les plus anciennes d'abord, les annonces
 * mortes arrivaient en tête, présentées comme les mieux éprouvées : exactement l'inverse de
 * ce que ce mur promet.
 *
 * Compter jusqu'au dernier passage qui l'a vue n'affirme que ce qui a été observé. Une
 * annonce toujours en vie est retrouvée à chaque collecte, et son compteur avance avec elle.
 */
const runningDays = (startedAt: Date | null, lastSeenAt: Date): number | null =>
  startedAt ? Math.max(0, Math.floor((lastSeenAt.getTime() - startedAt.getTime()) / JOUR_MS)) : null;

/** Forme des hôtes de chaque plateforme, tels que la lecture des annonces les enregistre. */
const HOST_LIKE: Record<Storefront, string> = { chariow: '%.mychariow.com', maketou: '%.mymaketou.%', shopify: '%.myshopify.com' };
const onStorefront = (storefront: Storefront): SQL => sql`${spiedAds.storeHost} like ${HOST_LIKE[storefront]}`;

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
    downloadable: Boolean(row.downloadUrl ?? row.mediaUrl ?? row.thumbnailPath),
    // La définition légère d'abord ; l'adresse d'origine pour les annonces relevées avant qu'on la garde.
    videoUrl: row.mediaKind === 'video' ? ([row.playUrl, row.downloadUrl].find(isMetaMediaUrl) ?? null) : null,
    countries: row.countries,
    startedAt: row.startedAt?.toISOString() ?? null,
    runningDays: runningDays(row.startedAt, row.lastSeenAt),
    variants: row.variants,
    platforms: row.platforms,
    active: row.active,
    lastSeenAt: row.lastSeenAt.toISOString(),
    thumbnailUrl: row.thumbnailPath ? `/api/espionnage/media/${row.id}` : null,
    pageId: row.pageId,
    pageUrl: row.pageUrl,
    pageAvatarUrl: row.pageAvatarPath && row.pageId ? `/api/espionnage/avatar/${row.pageId}` : row.pageAvatarUrl,
    impressionsText: row.impressionsText,
    ctaText: row.ctaText,
    displayFormat: row.displayFormat,
    linkCaption: row.linkCaption,
    linkDescription: row.linkDescription,
    cards: row.cards ?? [],
    daysSinceSeen: Math.max(0, Math.floor((now.getTime() - row.lastSeenAt.getTime()) / JOUR_MS)),
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
  /*
    Par défaut, l'écran reçoit tout ce que son palier autorise.

    Il y avait ici une valeur fixe de soixante, et c'était un défaut qui se retournait contre
    les comptes payants : un palier promettant 200 annonces n'en servait que 60, et le message
    « votre palier affiche 200 annonces » s'affichait à côté de 140 annonces manquantes. Le
    plafond venait du code, la phrase accusait l'abonnement.

    Le plafond absolu reste : deux cents lignes portant chacune une image sont déjà une page
    lourde, et il borne aussi le palier « illimité ».
  */
  const plafondPalier = visibleLimit ?? PLAFOND_ABSOLU;
  const demande = Math.min(Math.max(filters.limit ?? plafondPalier, 1), PLAFOND_ABSOLU);
  const limit = Math.min(demande, plafondPalier);
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
  if (filters.pageId) conditions.push(eq(spiedAds.pageId, filters.pageId));
  if (filters.product) {
    // Même règle que le Radar : le nom du produit est un segment entier de l'adresse de destination.
    const chemin = sql`rtrim(split_part(split_part(lower(${spiedAds.landingUrl}), '?', 1), '#', 1), '/')`;
    const menent = filters.product
      .split(',')
      .slice(0, 2)
      // Le tiret bas est un joker pour LIKE : il est échappé, « prd_1j8 » ne doit pas valoir « prdx1j8 ».
      .map((cle) => `/${cle.toLowerCase().replace(/_/g, '\\_')}`)
      .map((segment) => sql`(${chemin} like ${`%${segment}`} or ${chemin} like ${`%${segment}/%`})`);
    conditions.push(or(...menent)!);
  }
  if (filters.mediaKind) conditions.push(eq(spiedAds.mediaKind, filters.mediaKind));
  if (filters.country) conditions.push(sql`${spiedAds.countries} @> ${JSON.stringify([filters.country])}::jsonb`);
  if (filters.etat) conditions.push(eq(spiedAds.active, filters.etat === 'active'));
  if (filters.search) {
    /*
      Recherche insensible à la casse sur les trois champs lisibles par un humain.

      Trois caractères sont retirés, et non deux. `%` et `_` sont les jokers de ILIKE ; on les
      neutralisait déjà. L'ANTISLASH manquait, et c'est lui qui en est l'échappement : une
      recherche finissant par « \ » échappait le « % » de fin, transformait le joker en
      caractère ordinaire, et ne rendait plus rien. Un champ de recherche qui répond « aucun
      résultat » au lieu de chercher passe pour un mur vide.

      Rien d'injectable ici — la valeur est un paramètre — mais un motif faux reste faux.
    */
    /*
      INSENSIBLE AUX ACCENTS, comme la recherche des niches. Ce n'était pas le cas : chercher
      « editions » ne trouvait pas « Éditions Numériques ». Sur des annonces rédigées en
      français, souvent tapées au téléphone sans accents, c'était une recherche qui échouait
      une fois sur deux — et un même produit qui se comportait différemment d'un écran à
      l'autre.

      Le pliage est partagé avec la recherche de l'administration : voir server/db/search.ts.
    */
    conditions.push(containsIgnoringAccents([spiedAds.title, spiedAds.bodyText, spiedAds.advertiser], filters.search));
  }

  /*
    Tous les réglages SAUF la plateforme : c'est contre eux que se compte chaque plateforme. Le
    filtre annonçait le total de la plateforme sur tout le mur — « Chariow · 540 » — même avec
    « Vidéos » et « Cameroun » choisis à côté : on cliquait, et la liste en montrait quarante. Un
    nombre affiché à côté d'un choix doit être celui qu'on obtient en le faisant.
  */
  const sansPlateforme = conditions.length > 0 ? and(...conditions) : undefined;
  if (filters.storefront) conditions.push(onStorefront(filters.storefront));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const order =
    filters.sort === 'newest'
      ? [desc(spiedAds.startedAt)]
      : filters.sort === 'variants'
        ? [desc(spiedAds.variants), asc(spiedAds.startedAt)]
        : // Par défaut les plus anciennes : ce sont celles qui ont prouvé quelque chose.
          [asc(spiedAds.startedAt)];

  const [correspondantes] = await getDb().select({ total: count() }).from(spiedAds).where(where);
  const matching = Number(correspondantes?.total ?? 0);
  /*
    Une série est une PAGE : les annonces 1 à N, puis N+1 à 2N, sans recouvrement, et toutes les
    séries réunies font exactement les annonces annoncées. Quand tout tenait sur une page, les
    séries faisaient seulement tourner l'ordre : l'écran affichait « Série 2 sur 3 » au-dessus des
    mêmes annonces — un nombre de séries qui ne correspondait à rien (propriétaire, 07/10/2026).
  */
  const batches = Math.max(1, Math.ceil(matching / limit));
  // Au-delà de la dernière série, on revient à la première : le bouton ne mène jamais à un mur vide.
  const batch = Math.max(0, filters.batch ?? 0) % batches;

  // L'identifiant départage les dates égales : sans lui, deux séries pourraient se chevaucher.
  const rows = await getDb()
    .select()
    .from(spiedAds)
    .where(where)
    .orderBy(...order, asc(spiedAds.id))
    .limit(limit)
    .offset(batch * limit);

  /*
    Combien d'annonces le palier cache-t-il, parmi celles que les filtres retiennent ? On le
    compte pour le DIRE. Couper en silence laisserait croire que la niche est vide, alors que
    c'est l'abonnement qui borne — un utilisateur qui ne sait pas ce qu'il rate n'a aucune
    raison de payer, et croit le produit pauvre.

    Le compte se fait contre la LIMITE DU PALIER, et non contre le nombre de lignes servies :
    une page plus courte parce que l'écran en a demandé moins n'est pas un manque imputable à
    l'abonnement. Accuser le palier de ce qu'il n'a pas fait pousse à payer pour rien, et
    l'utilisateur qui souscrit découvre que rien ne change.
  */
  const hiddenByPlan = visibleLimit !== null ? Math.max(0, matching - visibleLimit) : 0;

  const [totaux] = await getDb()
    .select({ total: count(), stores: sql<number>`count(distinct ${spiedAds.storeHost})` })
    .from(spiedAds);

  // Pays relevés sur tout le mur, pour le filtre : on ne propose que ce qui existe.
  const paysConnus = await getDb()
    .select({ pays: sql<string>`distinct jsonb_array_elements_text(${spiedAds.countries})` })
    .from(spiedAds);

  const parPlateforme = await Promise.all(
    STOREFRONTS.map(async (id) => {
      const [row] = await getDb()
        .select({ ads: count() })
        .from(spiedAds)
        .where(sansPlateforme ? and(sansPlateforme, onStorefront(id)) : onStorefront(id));
      return { id, ads: Number(row?.ads ?? 0) };
    }),
  );

  return {
    countries: paysConnus.map((row) => row.pays).sort(),
    // La plateforme choisie reste proposée même à zéro : on doit pouvoir lire « 0 » et en changer.
    storefronts: parPlateforme.filter((entry) => entry.ads > 0 || entry.id === filters.storefront),
    /** Annonces servies par série : de quoi dire « annonces 101 à 200 sur 380 ». */
    pageSize: limit,
    ads: rows.map((row) => viewOf(row, now)),
    total: Number(totaux?.total ?? 0),
    stores: Number(totaux?.stores ?? 0),
    lastCollectedAt: (await lastDiscoveryAt())?.toISOString() ?? null,
    configured: providers.apify,
    visibleLimit,
    hiddenByPlan,
    matching,
    batch,
    batches,
    collecting: providers.apify ? (await pendingCollectionRuns()) > 0 : false,
  };
}

let lastBackgroundRefresh = 0;

/**
 * Tenue du mur à chaque consultation, en arrière-plan et au plus toutes les deux minutes par
 * instance : récolte d'une collecte terminée, copie des aperçus manquants. Sans cela, une
 * collecte finie n'apparaissait qu'au passage du planificateur, le lendemain.
 */
export function refreshWallInBackground(): void {
  if (Date.now() - lastBackgroundRefresh < 120_000) return;
  lastBackgroundRefresh = Date.now();
  runInBackground(async () => {
    if (providers.apify && (await pendingCollectionRuns()) > 0) await harvestCollectionRuns();
    await storeMissingThumbnails(60);
    await storeMissingAvatars(30);
  }, 'tenue du mur d’espionnage');
}

/**
 * « Actualiser » : ce qu'une collecte terminée a rapporté entre dans le mur tout de suite, au
 * lieu d'attendre le passage de la nuit. Ne lance AUCUNE collecte : chacune est facturée, et
 * son rythme reste celui du planificateur.
 */
export async function refreshWall(now = new Date()): Promise<{ collecting: boolean; adsAdded: number }> {
  if (!providers.apify) return { collecting: false, adsAdded: 0 };
  let adsAdded = 0;
  if ((await pendingCollectionRuns()) > 0) adsAdded = (await harvestCollectionRuns(now)).adsKept ?? 0;
  runInBackground(async () => {
    await storeMissingThumbnails(60);
    await storeMissingAvatars(30);
  }, 'aperçus du mur d’espionnage');
  return { collecting: (await pendingCollectionRuns()) > 0, adsAdded };
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
