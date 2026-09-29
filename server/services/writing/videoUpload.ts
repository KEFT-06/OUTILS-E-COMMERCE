import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import {
  type BucketOptions,
  createSignedUpload,
  getObject,
  listObjects,
  removeObjects,
  supabaseStorage,
} from '@server/services/storage/supabase';
import { VIDEO_FILE_MAX_BYTES, VIDEO_MIME_TYPES } from '@server/services/writing/video';

/**
 * Dépôt direct d'une vidéo à transformer en produit.
 *
 * L'hébergeur refuse tout envoi de plus de 4,5 Mo à une fonction (413) : la plupart des vraies
 * vidéos, jusqu'à 14 Mo acceptés, n'arrivaient donc jamais au serveur en production. Le
 * navigateur dépose désormais le fichier dans le stockage de Supabase, par un lien signé à
 * usage unique ; le serveur le relit de là, le transmet à Gemini, puis l'EFFACE.
 *
 * Rien ne s'accumule : le fichier est effacé dès l'analyse faite, réussie ou non, et le
 * balayage de nuit efface tout dépôt de plus de 24 h (envoi abandonné en route).
 *
 * Sans stockage configuré, l'écran garde l'envoi direct au serveur, suffisant en local.
 */

const BUCKET_ID = 'depots-video';
const FOLDER = 'tmp';
const UPLOAD_TTL_MS = 24 * 3_600_000;

const bucket = (): BucketOptions => ({
  id: BUCKET_ID,
  public: false,
  fileSizeLimit: VIDEO_FILE_MAX_BYTES,
  allowedMimeTypes: [...VIDEO_MIME_TYPES],
});

export const directVideoUploadAvailable = () => supabaseStorage() !== null;

export const videoUploadRequestSchema = z.object({
  mimeType: z.string().trim().toLowerCase(),
  size: z.number().int().min(1),
});

/** Identifiant de dépôt : le compte, puis un identifiant aléatoire. Le premier prouve la propriété. */
const uploadIdSchema = z.string().regex(/^[0-9a-f-]{36}_[0-9a-f-]{36}$/);

const notConfigured = () =>
  new AppError(501, 'Le dépôt direct n’est pas disponible sur ce serveur : envoyez le fichier directement.', 'VIDEO_UPLOAD_UNAVAILABLE');

/** Lien de dépôt signé pour un fichier déclaré : type et poids sont vérifiés avant. */
export async function createVideoUpload(
  auth: RequestAuth,
  request: z.infer<typeof videoUploadRequestSchema>,
): Promise<{ uploadId: string; uploadUrl: string }> {
  const target = supabaseStorage();
  if (!target) throw notConfigured();
  if (!VIDEO_MIME_TYPES.includes(request.mimeType)) {
    throw new AppError(415, 'Envoyez un fichier vidéo ou audio (MP4, MOV, WebM, MP3, M4A, WAV…).', 'VIDEO_TYPE_UNSUPPORTED');
  }
  if (request.size > VIDEO_FILE_MAX_BYTES) {
    throw new AppError(413, `Le fichier dépasse ${Math.round(VIDEO_FILE_MAX_BYTES / 1024 / 1024)} Mo : raccourcissez la vidéo ou collez un lien YouTube.`, 'VIDEO_FILE_TOO_LARGE');
  }
  const uploadId = `${auth.account.user.id}_${randomUUID()}`;
  try {
    return { uploadId, uploadUrl: await createSignedUpload(target, bucket(), `${FOLDER}/${uploadId}`) };
  } catch (error) {
    console.error('[dépôt vidéo] lien refusé :', error instanceof Error ? error.message : error);
    throw new AppError(502, 'Le dépôt du fichier n’a pas pu être préparé.', 'VIDEO_UPLOAD_FAILED');
  }
}

/** Relit un dépôt de ce compte. Lève s'il appartient à un autre compte, ou s'il n'est pas arrivé. */
export async function readUploadedVideo(auth: RequestAuth, uploadId: unknown): Promise<{ data: Buffer; mimeType: string }> {
  const target = supabaseStorage();
  if (!target) throw notConfigured();
  const parsed = uploadIdSchema.safeParse(uploadId);
  const missing = new AppError(404, 'Le fichier envoyé est introuvable : renvoyez-le.', 'VIDEO_UPLOAD_MISSING');
  if (!parsed.success || !parsed.data.startsWith(`${auth.account.user.id}_`)) throw missing;

  const response = await getObject(target, BUCKET_ID, `${FOLDER}/${parsed.data}`);
  if (!response) throw missing;
  const mimeType = String(response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const data = Buffer.from(await response.arrayBuffer());
  if (!VIDEO_MIME_TYPES.includes(mimeType) || data.length === 0) {
    await discardUploadedVideo(parsed.data);
    throw new AppError(415, 'Envoyez un fichier vidéo ou audio (MP4, MOV, WebM, MP3, M4A, WAV…).', 'VIDEO_TYPE_UNSUPPORTED');
  }
  if (data.length > VIDEO_FILE_MAX_BYTES) {
    await discardUploadedVideo(parsed.data);
    throw new AppError(413, 'Le fichier est trop lourd pour être analysé.', 'VIDEO_FILE_TOO_LARGE');
  }
  return { data, mimeType };
}

/** Efface un dépôt. Ne lève jamais : le balayage de nuit rattrape un effacement manqué. */
export async function discardUploadedVideo(uploadId: string): Promise<void> {
  const target = supabaseStorage();
  if (!target || !uploadIdSchema.safeParse(uploadId).success) return;
  await removeObjects(target, BUCKET_ID, [`${FOLDER}/${uploadId}`]).catch((error: unknown) =>
    console.warn('[dépôt vidéo] effacement manqué :', error instanceof Error ? error.message : error),
  );
}

/** Balayage de nuit : tout dépôt de plus de 24 h est effacé (envoi abandonné, analyse coupée). */
export async function purgeStaleVideoUploads(now = new Date()): Promise<{ purged: number }> {
  const target = supabaseStorage();
  if (!target) return { purged: 0 };
  const objects = await listObjects(target, BUCKET_ID, FOLDER);
  const stale = objects
    .filter((object) => object.createdAt && now.getTime() - object.createdAt.getTime() > UPLOAD_TTL_MS)
    .map((object) => `${FOLDER}/${object.name}`);
  if (stale.length > 0) await removeObjects(target, BUCKET_ID, stale);
  return { purged: stale.length };
}
