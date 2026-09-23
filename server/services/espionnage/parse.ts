import { z } from 'zod';
import type { spiedAds } from '@server/db/schema';

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
    snapshot: z
      .object({
        linkUrl: z.string().nullable().optional(),
        caption: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        body: z.object({ text: z.string().nullable().optional() }).nullable().optional(),
        images: z.array(mediaSchema).nullable().optional(),
        videos: z.array(mediaSchema).nullable().optional(),
        pageName: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type MetaAd = z.infer<typeof metaAdSchema>;

/** Hôte de vitrine de la plateforme, avec son sous-domaine. */
const STOREFRONT_HOST = /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.mychariow\.(?:com|shop)\b/i;
/** Sous-domaines techniques : ce ne sont pas des boutiques. */
const NOT_A_STORE = new Set(['www', 'api', 'api-edge', 'app', 'cdn', 'images', 'assets', 'static']);

export type SpiedAdInsert = typeof spiedAds.$inferInsert;

/**
 * Traduit une annonce en ligne de mur d'espionnage, ou rend null quand elle ne mène pas à la
 * plateforme. On ne regarde que le lien de destination et la légende : ce sont les deux seuls
 * champs qui prouvent la redirection.
 */
export function readMetaAd(raw: unknown, now: Date): SpiedAdInsert | null {
  const parsed = metaAdSchema.safeParse(raw);
  if (!parsed.success) return null;
  const ad = parsed.data;
  const snap = ad.snapshot;
  if (!snap) return null;

  const preuve = `${snap.linkUrl ?? ''} ${snap.caption ?? ''}`;
  const trouve = STOREFRONT_HOST.exec(preuve);
  const sous = trouve?.[1]?.toLowerCase();
  if (!sous || NOT_A_STORE.has(sous)) return null;

  const externalId = String(ad.adArchiveID ?? ad.adArchiveId ?? '').trim();
  const landingUrl = (snap.linkUrl ?? '').trim();
  if (!externalId || !landingUrl) return null;

  const image = snap.images?.find((m) => m.originalImageUrl || m.resizedImageUrl);
  const video = snap.videos?.find((m) => m.videoPreviewImageUrl || m.videoSdUrl || m.videoHdUrl);
  // On préfère l'aperçu de la vidéo à la vidéo elle-même : une image suffit à reconnaître une
  // annonce, et relayer la vidéo d'un tiers serait la rediffuser.
  const media = video
    ? { url: video.videoPreviewImageUrl ?? null, kind: 'video' as const }
    : image
      ? { url: image.originalImageUrl ?? image.resizedImageUrl ?? null, kind: 'image' as const }
      : { url: null, kind: null };

  return {
    externalId,
    // « .shop » et « .com » désignent la même boutique : une seule forme, celle que le radar surveille.
    storeHost: `${sous}.mychariow.com`,
    landingUrl: landingUrl.slice(0, 2_000),
    title: snap.title?.replace(/\s+/g, ' ').trim().slice(0, 300) || null,
    bodyText: snap.body?.text?.trim().slice(0, 4_000) || null,
    advertiser: (snap.pageName ?? ad.pageName)?.trim().slice(0, 200) || null,
    mediaUrl: media.url?.slice(0, 2_000) ?? null,
    mediaKind: media.kind,
    // Secondes, pas millisecondes : mesuré. Multiplier au mauvais facteur daterait toutes les
    // annonces de 1970 et l'ancienneté n'aurait aucun sens.
    startedAt: typeof ad.startDate === 'number' && ad.startDate > 0 ? new Date(ad.startDate * 1000) : null,
    variants: typeof ad.collationCount === 'number' && ad.collationCount > 0 ? ad.collationCount : 1,
    platforms: ad.publisherPlatform ?? [],
    active: ad.isActive !== false,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}
