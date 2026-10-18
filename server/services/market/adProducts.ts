import { asc, desc, inArray, or } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { containsIgnoringAccents } from '@server/db/search';
import { marketProducts, spiedAds } from '@server/db/schema';
import { leadsToProduct, productUrl } from '@server/services/market/productAds';
import { type Storefront, storefrontOfHost } from '@server/shared/storefronts';

/**
 * Ce que le Radar sait du produit qu'une publicité annonce.
 *
 * Demande du propriétaire (18/10/2026) : « quand le radar manque de données il les tire depuis
 * l'espionnage, et vice versa ; ils doivent être connectés et liés ». Le Radar savait déjà compter
 * les publicités d'un produit ; une publicité du mur, elle, ne disait rien du produit vers lequel
 * elle mène — ni son nom, ni son prix, ni ses ventes, que le Radar avait pourtant relevés.
 *
 * Même règle que dans l'autre sens (`leadsToProduct`) : le nom d'adresse ou l'identifiant du produit
 * est un segment entier de l'adresse de destination, sur la même boutique. Rien n'est estimé : un
 * produit que le Radar n'a jamais lu reste inconnu, et la date du relevé accompagne chaque chiffre.
 */

export interface AdRadarProduct {
  name: string;
  price: number | null;
  currency: string | null;
  /** Ventes cumulées publiées par la vitrine au dernier relevé. null : non publiées. */
  sales: number | null;
  /** Ventes depuis notre premier relevé. null : non publiées. */
  salesTracked: number | null;
  /** Dernier relevé qui a lu ce produit : les chiffres datent de ce jour. */
  readAt: string;
  /** Le produit n'était plus en vente au dernier relevé. */
  ended: boolean;
  url: string;
}

export interface AdRadarStore {
  /** Produits en vente connus du Radar pour cette boutique. */
  products: number;
  /** Ventes cumulées publiées, tous produits en vente confondus. null : aucune publiée. */
  sales: number | null;
  readAt: string | null;
}

export interface AdRadarData {
  product: AdRadarProduct | null;
  store: AdRadarStore | null;
}

/** Données du Radar pour chaque publicité (par son identifiant), en une seule lecture de l'index. */
export async function radarDataForAds(ads: readonly { id: string; storeHost: string | null; landingUrl: string | null }[]): Promise<Map<string, AdRadarData>> {
  const result = new Map<string, AdRadarData>();
  const hosts = [...new Set(ads.flatMap((ad) => (ad.storeHost ? [ad.storeHost] : [])))];
  if (hosts.length === 0) return result;

  const rows = await getDb()
    .select({
      storeHost: marketProducts.storeHost,
      name: marketProducts.name,
      slug: marketProducts.slug,
      externalId: marketProducts.externalId,
      price: marketProducts.priceValue,
      currency: marketProducts.currency,
      sales: marketProducts.salesCount,
      salesAtFirstSeen: marketProducts.salesAtFirstSeen,
      lastSeenAt: marketProducts.lastSeenAt,
      endedAt: marketProducts.endedAt,
    })
    .from(marketProducts)
    .where(inArray(marketProducts.storeHost, hosts));

  const byHost = new Map<string, typeof rows>();
  for (const row of rows) byHost.set(row.storeHost, [...(byHost.get(row.storeHost) ?? []), row]);

  for (const ad of ads) {
    const catalog = ad.storeHost ? byHost.get(ad.storeHost) : undefined;
    if (!catalog || catalog.length === 0) continue;
    const landing = ad.landingUrl ?? '';
    const match = landing ? catalog.find((row) => [row.slug, row.externalId].some((key) => key && leadsToProduct(landing, key))) : undefined;
    const onSale = catalog.filter((row) => !row.endedAt);
    const published = onSale.flatMap((row) => (row.sales === null ? [] : [row.sales]));
    const lastRead = catalog.reduce<Date | null>((latest, row) => (!latest || row.lastSeenAt > latest ? row.lastSeenAt : latest), null);
    result.set(ad.id, {
      product: match
        ? {
            name: match.name,
            price: match.price,
            currency: match.currency,
            sales: match.sales,
            salesTracked: match.sales !== null && match.salesAtFirstSeen !== null ? Math.max(0, match.sales - match.salesAtFirstSeen) : null,
            readAt: match.lastSeenAt.toISOString(),
            ended: Boolean(match.endedAt),
            url: productUrl(match.storeHost, match.slug),
          }
        : null,
      store: { products: onSale.length, sales: published.length > 0 ? published.reduce((sum, value) => sum + value, 0) : null, readAt: lastRead?.toISOString() ?? null },
    });
  }
  return result;
}

/** Une offre que les boutiques d'une niche poussent en publicité : un produit, toutes ses annonces réunies. */
export interface AdvertisedOffer {
  title: string;
  storeHost: string;
  storefront: Storefront | null;
  landingUrl: string;
  /** Annonces du mur qui mènent à cette offre, et celles vues en cours au dernier contrôle. */
  ads: number;
  activeAds: number;
  /** Début de la plus ancienne de ces annonces, publié par Meta. */
  firstAdAt: string | null;
  /** Jours de diffusion de la plus durable, vus par nos collectes. */
  longestDays: number | null;
  /** Ce que le Radar sait du produit, quand il l'a relevé. */
  product: AdRadarProduct | null;
}

const JOUR_MS = 86_400_000;

/** Première phrase d'un texte publicitaire, en 90 caractères au plus. */
const premierePhrase = (text: string | null) => {
  const phrase = (text ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  return phrase.length > 90 ? `${phrase.slice(0, 89).trimEnd()}…` : phrase;
};

/** Même offre, que l'annonce mène à la page du produit ou à son paiement. */
const offerPath = (landingUrl: string) =>
  landingUrl.toLowerCase().split(/[?#]/)[0]!.replace(/\/+$/, '').replace(/\/checkout$/, '');

/**
 * Les offres d'une niche vues en publicité sur le mur, les plus poussées d'abord.
 *
 * Le Radar ne trouvait les produits d'une niche que dans l'index des catalogues — que les vitrines
 * Chariow refusent de laisser relire depuis le 11/10/2026 : « aucun produit sur cette niche » alors
 * que le mur montrait des boutiques qui en font la publicité.
 *
 * Une annonce compte quand un mot distinctif de la niche est dans son TITRE, ou quand son texte en
 * porte au moins deux. Le texte seul ne suffisait pas : pour « élevage de poulets », des packs de
 * recettes remontaient parce qu'ils citent le poulet DG (mesuré le 18/10/2026). Un mot dans le
 * titre vaut deux dans le texte pour le classement.
 */
export async function advertisedOffers(keywords: readonly string[], limit = 20): Promise<AdvertisedOffer[]> {
  if (keywords.length === 0) return [];
  const rows = await getDb()
    .select({
      id: spiedAds.id,
      storeHost: spiedAds.storeHost,
      landingUrl: spiedAds.landingUrl,
      title: spiedAds.title,
      bodyText: spiedAds.bodyText,
      linkDescription: spiedAds.linkDescription,
      startedAt: spiedAds.startedAt,
      lastSeenAt: spiedAds.lastSeenAt,
      active: spiedAds.active,
    })
    .from(spiedAds)
    .where(or(...keywords.map((mot) => containsIgnoringAccents([spiedAds.title, spiedAds.bodyText, spiedAds.linkDescription], mot))))
    .orderBy(desc(spiedAds.active), asc(spiedAds.startedAt))
    .limit(600);

  const plier = (text: string | null) => (text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  /*
    Un mot entier : la racine de la niche suivie de trois lettres au plus (« poulet » trouve
    « poulets », « recett » trouve « recettes »), jamais noyée dans un autre mot — « excel » ne
    trouve ni « excellence » ni « excellent » (relevé local du 18/10/2026).
  */
  const motifs = keywords.map((mot) => new RegExp(`(?:^|[^a-z0-9])${mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-z]{0,3}(?![a-z0-9])`));
  const compte = (texte: string) => motifs.filter((motif) => motif.test(texte)).length;
  /** 0 : l'annonce n'est pas de la niche. */
  const score = (row: (typeof rows)[number]) => {
    const titre = compte(`${plier(row.title)} ${plier(row.linkDescription)}`);
    const texte = compte(plier(row.bodyText));
    return titre >= 1 || texte >= Math.min(2, keywords.length) ? 2 * titre + texte : 0;
  };

  const offers = new Map<string, { rows: typeof rows; score: number }>();
  for (const row of rows) {
    if (score(row) === 0) continue;
    const key = `${row.storeHost}|${offerPath(row.landingUrl)}`;
    const entry = offers.get(key) ?? { rows: [], score: 0 };
    entry.rows.push(row);
    entry.score = Math.max(entry.score, score(row));
    offers.set(key, entry);
  }

  const ranked = [...offers.values()]
    .map(({ rows: ofOffer, score: best }) => {
      const debuts = ofOffer.flatMap((row) => (row.startedAt ? [row.startedAt.getTime()] : []));
      const durees = ofOffer.flatMap((row) => (row.startedAt ? [Math.max(0, Math.floor((row.lastSeenAt.getTime() - row.startedAt.getTime()) / JOUR_MS))] : []));
      return {
        first: ofOffer[0]!,
        score: best,
        ads: ofOffer.length,
        activeAds: ofOffer.filter((row) => row.active).length,
        firstAdAt: debuts.length ? new Date(Math.min(...debuts)).toISOString() : null,
        longestDays: durees.length ? Math.max(...durees) : null,
        // À défaut de titre : la première phrase du texte publicitaire, plutôt qu'un code d'adresse illisible.
        title: ofOffer.map((row) => row.title?.trim() || row.linkDescription?.trim() || premierePhrase(row.bodyText)).find(Boolean) ?? '',
      };
    })
    .sort((a, b) => b.score - a.score || b.activeAds - a.activeAds || b.ads - a.ads || (b.longestDays ?? -1) - (a.longestDays ?? -1))
    .slice(0, Math.max(1, limit));

  const radar = await radarDataForAds(ranked.map((offer) => offer.first));
  return ranked.map((offer) => {
    const product = radar.get(offer.first.id)?.product ?? null;
    const segment = offerPath(offer.first.landingUrl).split('/').pop() ?? '';
    return {
      title: product?.name || offer.title || segment || offer.first.storeHost,
      storeHost: offer.first.storeHost,
      storefront: storefrontOfHost(offer.first.storeHost),
      landingUrl: offer.first.landingUrl,
      ads: offer.ads,
      activeAds: offer.activeAds,
      firstAdAt: offer.firstAdAt,
      longestDays: offer.longestDays,
      product,
    };
  });
}
