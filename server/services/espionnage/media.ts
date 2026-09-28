import type { Response as ExpressResponse } from 'express';
import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { spiedAds } from '@server/db/schema';
import { isProd } from '@server/env';
import { assertPublicUrl } from '@server/lib/publicUrl';
import { AppError } from '@server/middleware';
import { type BucketOptions, getObject, putObject, removeObjects, supabaseStorage } from '@server/services/storage/supabase';

/**
 * Aperçus des publicités du mur, conservés dans notre stockage.
 *
 * Les adresses de visuel de Meta sont signées et EXPIRENT en quelques jours. Entre deux
 * collectes, le mur se remplissait de cases « visuel expiré » — ce qui se lisait comme une
 * panne, et vidait l'écran de ce qu'il a de plus parlant. L'aperçu est donc copié à la
 * collecte, tant que l'adresse est fraîche, puis servi par le serveur.
 *
 * Ce qui est conservé : une image par annonce, la version réduite (quelques dizaines de Ko),
 * ou l'image d'aperçu pour une vidéo — jamais la vidéo elle-même. L'aperçu est effacé trente
 * jours après que l'annonce a cessé d'être vue : le stockage suit le mur, il ne s'accumule pas.
 *
 * Sans stockage configuré, rien ne change : l'écran affiche l'adresse de Meta tant qu'elle vit.
 */

const BUCKET_ID = 'espionnage';
const MAX_BYTES = 3 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;
const KEEP_AFTER_LAST_SEEN_MS = 30 * 24 * 3_600_000;
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
/** Seuls les serveurs d'images de Meta sont lus : l'adresse vient d'un tiers, jamais d'ailleurs. */
const META_IMAGE_HOST = /(^|\.)(fbcdn\.net|cdninstagram\.com)$/i;

const bucket = (): BucketOptions => ({ id: BUCKET_ID, public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: Object.keys(IMAGE_TYPES) });

async function downloadMetaImage(raw: string): Promise<{ bytes: ArrayBuffer; type: string }> {
  const url = await assertPublicUrl(raw, 'L’adresse du visuel');
  // Hors production seulement, le faux serveur d'images des tests répond en local.
  const local = !isProd && url.hostname === '127.0.0.1';
  if (!local && !META_IMAGE_HOST.test(url.hostname)) throw new Error(`hôte refusé : ${url.hostname}`);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`visuel indisponible (${response.status})`);
  const type = String(response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!IMAGE_TYPES[type]) throw new Error(`type refusé : ${type || 'inconnu'}`);
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('visuel trop lourd');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error('visuel vide ou trop lourd');
  return { bytes, type };
}

/**
 * Copie les aperçus manquants, les annonces les plus récemment vues d'abord (leur adresse est
 * la plus fraîche). Ne lève jamais : un échec est noté sur l'annonce, qui ne sera retentée
 * qu'avec une nouvelle adresse, à la collecte suivante.
 */
export async function storeMissingThumbnails(limit = 100): Promise<{ stored: number; failed: number }> {
  const target = supabaseStorage();
  if (!target) return { stored: 0, failed: 0 };
  const rows = await getDb()
    .select({ id: spiedAds.id, externalId: spiedAds.externalId, mediaUrl: spiedAds.mediaUrl })
    .from(spiedAds)
    .where(and(isNull(spiedAds.thumbnailPath), isNotNull(spiedAds.mediaUrl), isNull(spiedAds.thumbnailFailedAt)))
    .orderBy(desc(spiedAds.lastSeenAt))
    .limit(limit);

  let stored = 0;
  let failed = 0;
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try {
        const { bytes, type } = await downloadMetaImage(row.mediaUrl!);
        const path = `ads/${row.externalId.replace(/[^\w-]/g, '')}.${IMAGE_TYPES[type]}`;
        await putObject(target, bucket(), path, bytes, type);
        await getDb().update(spiedAds).set({ thumbnailPath: path }).where(eq(spiedAds.id, row.id));
        stored += 1;
      } catch (error) {
        failed += 1;
        await getDb().update(spiedAds).set({ thumbnailFailedAt: new Date() }).where(eq(spiedAds.id, row.id));
        console.warn('[espionnage] aperçu non copié :', row.externalId, error instanceof Error ? error.message : error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return { stored, failed };
}

/**
 * Sert l'aperçu d'une annonce. Public et mis en cache par le réseau de l'hébergeur : ce sont
 * des publicités que Meta montre à tout le monde, et chaque vignette du mur ne doit pas
 * coûter un appel au serveur ni une lecture du stockage.
 */
export async function sendAdThumbnail(adId: string | undefined, res: ExpressResponse): Promise<void> {
  const notFound = new AppError(404, 'Aperçu introuvable.', 'SPY_THUMBNAIL_NOT_FOUND');
  if (!adId || !/^[0-9a-f-]{36}$/.test(adId)) throw notFound;
  const target = supabaseStorage();
  const [row] = await getDb().select({ path: spiedAds.thumbnailPath }).from(spiedAds).where(eq(spiedAds.id, adId)).limit(1);
  if (!target || !row?.path) throw notFound;
  const object = await getObject(target, BUCKET_ID, row.path);
  if (!object) throw notFound;
  const bytes = Buffer.from(await object.arrayBuffer());
  res.setHeader('Content-Type', object.headers.get('content-type') ?? 'image/jpeg');
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(bytes);
}

/**
 * Copie la photo de profil des annonceurs, une fois par page Facebook : Meta la signe et la fait
 * expirer comme les visuels, et la carte d'annonce la montre en tête, comme sur la bibliothèque.
 */
export async function storeMissingAvatars(limit = 60): Promise<{ stored: number; failed: number }> {
  const target = supabaseStorage();
  if (!target) return { stored: 0, failed: 0 };
  const rows = await getDb()
    .selectDistinctOn([spiedAds.pageId], { pageId: spiedAds.pageId, url: spiedAds.pageAvatarUrl })
    .from(spiedAds)
    .where(and(isNotNull(spiedAds.pageId), isNotNull(spiedAds.pageAvatarUrl), isNull(spiedAds.pageAvatarPath)))
    .orderBy(spiedAds.pageId, desc(spiedAds.lastSeenAt))
    .limit(limit);
  let stored = 0;
  let failed = 0;
  for (const row of rows) {
    const pageId = row.pageId!.replace(/\D/g, '');
    if (!pageId || !row.url) continue;
    try {
      const { bytes, type } = await downloadMetaImage(row.url);
      const path = `pages/${pageId}.${IMAGE_TYPES[type]}`;
      await putObject(target, bucket(), path, bytes, type);
      await getDb().update(spiedAds).set({ pageAvatarPath: path }).where(eq(spiedAds.pageId, row.pageId!));
      stored += 1;
    } catch (error) {
      failed += 1;
      // Adresse morte : on l'oublie, la collecte suivante en apportera une fraîche.
      await getDb().update(spiedAds).set({ pageAvatarUrl: null }).where(eq(spiedAds.pageId, row.pageId!));
      console.warn('[espionnage] photo de profil non copiée :', pageId, error instanceof Error ? error.message : error);
    }
  }
  return { stored, failed };
}

/** Photo de profil d'un annonceur, publique et mise en cache comme les aperçus. */
export async function sendPageAvatar(pageId: string | undefined, res: ExpressResponse): Promise<void> {
  const notFound = new AppError(404, 'Photo introuvable.', 'SPY_AVATAR_NOT_FOUND');
  if (!pageId || !/^\d{5,30}$/.test(pageId)) throw notFound;
  const target = supabaseStorage();
  const [row] = await getDb()
    .select({ path: spiedAds.pageAvatarPath })
    .from(spiedAds)
    .where(and(eq(spiedAds.pageId, pageId), isNotNull(spiedAds.pageAvatarPath)))
    .limit(1);
  if (!target || !row?.path) throw notFound;
  const object = await getObject(target, BUCKET_ID, row.path);
  if (!object) throw notFound;
  const bytes = Buffer.from(await object.arrayBuffer());
  res.setHeader('Content-Type', object.headers.get('content-type') ?? 'image/jpeg');
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(bytes);
}

/** Efface les aperçus des annonces qu'on ne voit plus depuis trente jours. */
export async function purgeStaleThumbnails(now = new Date(), limit = 500): Promise<{ purged: number }> {
  const target = supabaseStorage();
  if (!target) return { purged: 0 };
  const rows = await getDb()
    .select({ id: spiedAds.id, path: spiedAds.thumbnailPath })
    .from(spiedAds)
    .where(and(isNotNull(spiedAds.thumbnailPath), lt(spiedAds.lastSeenAt, new Date(now.getTime() - KEEP_AFTER_LAST_SEEN_MS))))
    .limit(limit);
  if (rows.length === 0) return { purged: 0 };
  await removeObjects(target, BUCKET_ID, rows.flatMap((row) => (row.path ? [row.path] : [])));
  for (const row of rows) await getDb().update(spiedAds).set({ thumbnailPath: null }).where(eq(spiedAds.id, row.id));
  return { purged: rows.length };
}
