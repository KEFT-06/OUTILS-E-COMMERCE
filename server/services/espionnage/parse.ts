import { z } from 'zod';
import type { spiedAds } from '@server/db/schema';
import { findStorefront } from '@server/shared/storefronts';

/**
 * Lecture d'une annonce de la bibliothèque publicitaire Meta, telle que la collecte la rend.
 *
 * Tout ici vient d'une sonde réelle du 23/09/2026 sur 60 annonces, pas de la documentation :
 *
 *  · la preuve qu'une annonce mène à la plateforme se lit dans `snapshot.linkUrl` ou
 *    `snapshot.caption`, JAMAIS dans l'enregistrement entier. `inputUrl` contient le mot-clé
 *    cherché dans CHAQUE annonce : chercher partout ferait passer les 60 pour des nôtres,
 *    alors que 43 seulement le sont. C'est le piège principal de ce module.
 *  · `startDate` est un horodatage UNIX en secondes, pas en millisecondes.
 *  · le visuel est dans `snapshot.images[].originalImageUrl` ou `snapshot.videos[]` ; 39 sur 43
 *    en avaient un. Son adresse est signée par Meta et expire : elle est rafraîchie à chaque
 *    collecte, et l'écran prévoit un repli.
 *  · dépense, impressions et portée sont vides hors Union européenne (0 sur 43). Rien ne les lit.
 *  · les boutiques ne sont pas toutes en .com ou .shop. Mesuré le 28/09/2026 sur 30 annonces :
 *    .store, .online et .market aussi — onze annonces sur trente étaient jetées pour cette seule
 *    raison. Toute extension est donc acceptée derrière « mychariow ».
 *  · la plateforme n'est pas seule : au Cameroun, en Côte d'Ivoire et au Sénégal, la plupart des
 *    annonces relevées le 04/10/2026 mènent à des boutiques Maketou ou Shopify. Les trois sont
 *    reconnues (server/shared/storefronts.ts).
 *  · une annonce à plusieurs cartes porte parfois son lien dans les cartes, et pas à la racine :
 *    le lien de chaque carte est une destination au même titre que le lien principal.
 */

const mediaSchema = z
  .object({
    originalImageUrl: z.string().nullable().optional(),
    resizedImageUrl: z.string().nullable().optional(),
    videoPreviewImageUrl: z.string().nullable().optional(),
    videoHdUrl: z.string().nullable().optional(),
    videoSdUrl: z.string().nullable().optional(),
  })
  .passthrough();

const cardSchema = mediaSchema.extend({
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  linkUrl: z.string().nullable().optional(),
  ctaText: z.string().nullable().optional(),
});

export const metaAdSchema = z
  .object({
    adArchiveID: z.union([z.string(), z.number()]).nullable().optional(),
    adArchiveId: z.union([z.string(), z.number()]).nullable().optional(),
    /** Secondes depuis l'époque UNIX. */
    startDate: z.number().nullable().optional(),
    isActive: z.boolean().nullable().optional(),
    collationCount: z.number().nullable().optional(),
    publisherPlatform: z.array(z.string()).nullable().optional(),
    pageName: z.string().nullable().optional(),
    pageID: z.union([z.string(), z.number()]).nullable().optional(),
    pageId: z.union([z.string(), z.number()]).nullable().optional(),
    /** Tranche d'impressions (« <100 »…), publiée par Meta pour certaines annonces seulement. */
    impressionsWithIndex: z
      .object({ impressionsText: z.string().nullable().optional(), impressionsIndex: z.number().nullable().optional() })
      .nullable()
      .optional(),
    snapshot: z
      .object({
        linkUrl: z.string().nullable().optional(),
        caption: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        body: z.object({ text: z.string().nullable().optional() }).nullable().optional(),
        images: z.array(mediaSchema).nullable().optional(),
        videos: z.array(mediaSchema).nullable().optional(),
        cards: z.array(cardSchema).nullable().optional(),
        pageName: z.string().nullable().optional(),
        pageProfileUri: z.string().nullable().optional(),
        pageProfilePictureUrl: z.string().nullable().optional(),
        ctaText: z.string().nullable().optional(),
        displayFormat: z.string().nullable().optional(),
        linkDescription: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type MetaAd = z.infer<typeof metaAdSchema>;

/**
 * Coupe un texte sans jamais laisser une moitié d'emoji.
 *
 * Un emoji occupe deux unités de texte ; coupé entre les deux, il laisse un caractère orphelin
 * que la base refuse dans une colonne JSON (« low surrogate must follow a high surrogate »). Une
 * seule annonce ainsi coupée faisait échouer l'enregistrement de tout son lot — constaté le
 * 04/10/2026 sur une vraie collecte, où les textes publicitaires sont pleins d'emojis.
 */
export function clip(text: string, max: number): string {
  return text.slice(0, max).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

/** Texte court et propre, ou null ; les gabarits non remplis de Meta (« {{product.name}} ») sont écartés. */
const shortText = (value: string | null | undefined, max: number): string | null => {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text || /^\{\{.*\}\}$/.test(text)) return null;
  return clip(text, max) || null;
};
export type SpiedAdInsert = typeof spiedAds.$inferInsert;

/** Une annonce quelconque de la bibliothèque : boutique de la plateforme et lien peuvent manquer. */
export type MetaAdFields = Omit<SpiedAdInsert, 'storeHost' | 'landingUrl'> & { storeHost: string | null; landingUrl: string | null };

/**
 * Traduit une annonce en ligne de mur d'espionnage, ou rend null quand elle ne mène à aucune
 * boutique reconnue. On ne regarde que les liens de destination et la légende : ce sont les seuls
 * champs qui prouvent la redirection.
 */
export function readMetaAd(raw: unknown, now: Date): SpiedAdInsert | null {
  const ad = readAnyMetaAd(raw, now);
  if (!ad?.storeHost || !ad.landingUrl) return null;
  return { ...ad, storeHost: ad.storeHost, landingUrl: ad.landingUrl };
}

/**
 * Lit n'importe quelle annonce, qu'elle mène ou non à la plateforme : c'est ce que rend une
 * recherche par mot-clé, comme dans la bibliothèque de Meta. `storeHost` n'est renseigné que
 * pour une boutique reconnue (Chariow, Maketou, Shopify), prouvée par un lien ou la légende.
 */
export function readAnyMetaAd(raw: unknown, now: Date): MetaAdFields | null {
  const parsed = metaAdSchema.safeParse(raw);
  if (!parsed.success) return null;
  const ad = parsed.data;
  const snap = ad.snapshot;
  if (!snap) return null;

  const cardLinks = (snap.cards ?? []).map((card) => card.linkUrl ?? '').filter((link) => link.startsWith('http'));
  // Le lien principal et la légende d'abord : une carte ne l'emporte que s'ils ne désignent aucune boutique.
  const boutique = findStorefront(`${snap.linkUrl ?? ''} ${snap.caption ?? ''}`) ?? findStorefront(cardLinks.join(' '));

  const externalId = String(ad.adArchiveID ?? ad.adArchiveId ?? '').trim();
  const landingUrl = (snap.linkUrl?.trim().startsWith('http') ? snap.linkUrl : (cardLinks[0] ?? '')).trim();
  if (!externalId) return null;

  // Création dynamique ou carrousel : le visuel est dans la première carte, pas à la racine.
  const firstCard = snap.cards?.find((card) => card.resizedImageUrl || card.originalImageUrl || card.videoPreviewImageUrl);
  const image =
    snap.images?.find((m) => m.originalImageUrl || m.resizedImageUrl) ?? (firstCard && !firstCard.videoPreviewImageUrl ? firstCard : undefined);
  const video =
    snap.videos?.find((m) => m.videoPreviewImageUrl || m.videoSdUrl || m.videoHdUrl) ?? (firstCard?.videoPreviewImageUrl ? firstCard : undefined);
  // On préfère l'aperçu de la vidéo à la vidéo elle-même : une image suffit à reconnaître une
  // annonce, et relayer la vidéo d'un tiers serait la rediffuser.
  const media = video
    ? { url: video.videoPreviewImageUrl ?? null, kind: 'video' as const }
    : image
      ? // L'image redimensionnée d'abord : c'est elle qu'on conserve, et elle pèse dix fois moins.
        { url: image.resizedImageUrl ?? image.originalImageUrl ?? null, kind: 'image' as const }
      : { url: null, kind: null };

  return {
    externalId,
    // « .shop » et « .com » désignent la même boutique Chariow : une seule forme, celle que le radar surveille.
    storeHost: boutique?.host ?? null,
    landingUrl: landingUrl.startsWith('http') ? landingUrl.slice(0, 2_000) : null,
    title: clip(snap.title?.replace(/\s+/g, ' ').trim() ?? '', 300) || null,
    bodyText: clip(snap.body?.text?.trim() ?? '', 4_000) || null,
    advertiser: clip((snap.pageName ?? ad.pageName)?.trim() ?? '', 200) || null,
    mediaUrl: media.url?.slice(0, 2_000) ?? null,
    mediaKind: media.kind,
    // Fichier d'origine, pour le téléchargement : la vidéo elle-même, ou l'image en pleine définition.
    downloadUrl: (video ? (video.videoHdUrl ?? video.videoSdUrl) : image ? (image.originalImageUrl ?? image.resizedImageUrl) : null)?.slice(0, 2_000) ?? null,
    // Pour la lecture sur le mur : la définition légère d'abord, qui démarre vite sur une connexion mobile.
    playUrl: (video ? (video.videoSdUrl ?? video.videoHdUrl) : null)?.slice(0, 2_000) ?? null,
    // Secondes, pas millisecondes : mesuré. Multiplier au mauvais facteur daterait toutes les
    // annonces de 1970 et l'ancienneté n'aurait aucun sens.
    startedAt: typeof ad.startDate === 'number' && ad.startDate > 0 ? new Date(ad.startDate * 1000) : null,
    variants: typeof ad.collationCount === 'number' && ad.collationCount > 0 ? ad.collationCount : 1,
    platforms: ad.publisherPlatform ?? [],
    active: ad.isActive !== false,
    firstSeenAt: now,
    lastSeenAt: now,
    pageId: String(ad.pageID ?? ad.pageId ?? '').trim().slice(0, 40) || null,
    pageUrl: snap.pageProfileUri?.startsWith('https://') ? snap.pageProfileUri.slice(0, 500) : null,
    pageAvatarUrl: snap.pageProfilePictureUrl?.startsWith('https://') ? snap.pageProfilePictureUrl.slice(0, 2_000) : null,
    impressionsText: shortText(ad.impressionsWithIndex?.impressionsText, 40),
    ctaText: shortText(snap.ctaText, 60),
    displayFormat: shortText(snap.displayFormat, 30),
    linkCaption: shortText(snap.caption, 200),
    linkDescription: shortText(snap.linkDescription, 600),
    cards:
      snap.cards && snap.cards.length > 1
        ? snap.cards.slice(0, 10).map((card) => ({
            title: shortText(card.title, 300),
            body: shortText(card.body, 2_000),
            linkUrl: card.linkUrl?.startsWith('http') ? card.linkUrl.slice(0, 2_000) : null,
            ctaText: shortText(card.ctaText, 60),
          }))
        : null,
  };
}
