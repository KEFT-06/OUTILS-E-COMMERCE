import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { generations } from '@server/db/schema';
import { env, providers } from '@server/env';
import { fetchVeoMedia, getVeoGeneration } from '@server/services/veo';

/**
 * Copie des vidéos Veo dans le stockage de fichiers de Supabase.
 *
 * Google ne garde une vidéo générée que DEUX jours (« Generated videos are stored on the
 * server for 2 days, after which they are removed », ai.google.dev/gemini-api/docs/veo).
 * Une vidéo payée et non téléchargée à temps était perdue. Supabase héberge déjà la base :
 * son stockage de fichiers évite un fournisseur de plus (offre gratuite : 1 Go, fichiers de
 * 50 Mo au plus ; une vidéo de 8 secondes en pèse quelques-uns).
 *
 * Tout est facultatif : sans SUPABASE_API_SECRET_KEY, rien ne change — la vidéo reste
 * servie par Google pendant ses deux jours, et l'écran le dit.
 *
 * L'espace de stockage est PRIVÉ : aucun lien public n'existe, le fichier ne sort que par le
 * serveur, à son auteur ou à l'administration, comme avant.
 */

/** Limite de dépôt de l'offre gratuite de Supabase. */
const MAX_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
/** Au-delà, Google a effacé le fichier : plus rien à copier. */
const VEO_RETENTION_MS = 2 * 24 * 3_600_000;

/** Adresse du projet : donnée, ou déduite de l'utilisateur de DATABASE_URL (« postgres.<réf> »). */
export function supabaseProjectUrl(): string | null {
  if (env.SUPABASE_URL) return env.SUPABASE_URL.replace(/\/+$/, '');
  if (!env.DATABASE_URL) return null;
  try {
    const reference = /^postgres\.([a-z0-9]{10,40})$/.exec(decodeURIComponent(new URL(env.DATABASE_URL).username))?.[1];
    return reference ? `https://${reference}.supabase.co` : null;
  } catch {
    return null;
  }
}

function storage(): { base: string; headers: Record<string, string> } | null {
  const url = supabaseProjectUrl();
  if (!providers.videoArchive || !url) return null;
  const key = env.SUPABASE_API_SECRET_KEY!;
  return { base: `${url}/storage/v1`, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}

export function videoArchiveConfigured(): boolean {
  return storage() !== null;
}

/** Chemin de l'objet : l'identifiant d'opération, déjà validé par son schéma (lettres et chiffres). */
const objectPath = (requestId: string) => `veo/${encodeURIComponent(requestId)}.mp4`;

async function createBucket(target: NonNullable<ReturnType<typeof storage>>): Promise<void> {
  const response = await fetch(`${target.base}/bucket`, {
    method: 'POST',
    headers: { ...target.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: env.CREATIVES_BUCKET, name: env.CREATIVES_BUCKET, public: false, file_size_limit: MAX_BYTES }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 409 : un autre dépôt l'a créé entre-temps.
  if (!response.ok && response.status !== 409) throw new Error(`création de l'espace de stockage refusée (${response.status})`);
}

async function upload(target: NonNullable<ReturnType<typeof storage>>, requestId: string, bytes: ArrayBuffer): Promise<Response> {
  return fetch(`${target.base}/object/${env.CREATIVES_BUCKET}/${objectPath(requestId)}`, {
    method: 'POST',
    headers: { ...target.headers, 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
    body: bytes,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Copie la vidéo d'une génération Veo terminée, une seule fois. Ne lève jamais : un échec
 * est journalisé, et le balayage de nuit réessaie tant que Google garde le fichier.
 *
 * @returns vrai si la vidéo est (désormais) archivée.
 */
export async function archiveVeoVideo(generation: { id: string; providerRef: string | null; archivedAt: Date | null }): Promise<boolean> {
  if (generation.archivedAt) return true;
  const target = storage();
  if (!target || !generation.providerRef) return false;

  try {
    const veo = await getVeoGeneration(generation.providerRef);
    if (veo.status !== 'completed' || !veo.mediaUrl) return false;
    const media = await fetchVeoMedia(veo.mediaUrl);
    const declared = Number(media.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) throw new Error(`vidéo de ${declared} octets, au-delà de la limite de dépôt`);
    const bytes = await media.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) throw new Error(`vidéo de ${bytes.byteLength} octets, au-delà de la limite de dépôt`);

    let response = await upload(target, generation.providerRef, bytes);
    if (response.status === 404 || response.status === 400) {
      // Premier dépôt : l'espace de stockage n'existe pas encore.
      await createBucket(target);
      response = await upload(target, generation.providerRef, bytes);
    }
    if (!response.ok) throw new Error(`dépôt refusé (${response.status})`);

    await getDb().update(generations).set({ archivedAt: new Date() }).where(eq(generations.id, generation.id));
    return true;
  } catch (error) {
    console.error('[archive vidéo]', generation.id, error instanceof Error ? error.message : error);
    return false;
  }
}

/** La copie archivée, ou null si elle n'existe pas (l'appelant se rabat alors sur Google). */
export async function fetchArchivedVideo(requestId: string): Promise<Response | null> {
  const target = storage();
  if (!target) return null;
  try {
    const response = await fetch(`${target.base}/object/authenticated/${env.CREATIVES_BUCKET}/${objectPath(requestId)}`, {
      headers: target.headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok && response.body ? response : null;
  } catch {
    return null;
  }
}

/**
 * Filet du balayage de nuit : copie les vidéos Veo terminées depuis moins de deux jours et
 * pas encore archivées (dépôt interrompu, ou clé ajoutée après leur création).
 */
export async function archivePendingVideos(now = new Date(), limit = 20): Promise<{ archived: number; failed: number }> {
  if (!videoArchiveConfigured()) return { archived: 0, failed: 0 };
  const rows = await getDb()
    .select({ id: generations.id, providerRef: generations.providerRef, archivedAt: generations.archivedAt })
    .from(generations)
    .where(
      and(
        eq(generations.provider, 'veo'),
        eq(generations.status, 'completed'),
        isNull(generations.archivedAt),
        gt(generations.createdAt, new Date(now.getTime() - VEO_RETENTION_MS)),
      ),
    )
    .limit(limit);
  let archived = 0;
  for (const row of rows) if (await archiveVeoVideo(row)) archived += 1;
  return { archived, failed: rows.length - archived };
}
