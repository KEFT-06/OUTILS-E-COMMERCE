import { and, eq, gt, isNotNull, isNull, lt } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { generations, users } from '@server/db/schema';
import { env } from '@server/env';
import { UNLIMITED, getPlan } from '@server/services/plans';
import { type BucketOptions, getObject, putObject, removeObjects, supabaseStorage } from '@server/services/storage/supabase';
import { fetchVeoMedia, getVeoGeneration } from '@server/services/veo';

export { supabaseProjectUrl } from '@server/services/storage/supabase';

/**
 * Copie des vidéos Veo dans le stockage de fichiers de Supabase, pour la durée du palier.
 *
 * Google ne garde une vidéo générée que DEUX jours (« Generated videos are stored on the
 * server for 2 days, after which they are removed », ai.google.dev/gemini-api/docs/veo).
 * Au-delà, seule notre copie permet encore de la télécharger.
 *
 * LA DURÉE SUIT LE PALIER (plans.json, `videoRetentionDays`) : 24 h, 30 ou 90 jours. Copier
 * toutes les vidéos sans fin remplissait le stockage au rythme des inscriptions, y compris
 * avec les vidéos des paliers qui ne le paient pas. Désormais :
 *  - deux jours ou moins : AUCUNE copie, Google la garde lui-même ;
 *  - au-delà : une copie, effacée par le balayage de nuit à la date prévue ;
 *  - vidéo longue : seule la dernière version est gardée, chaque étape rendant la vidéo
 *    entière — les versions précédentes sont effacées dès que la suivante est copiée.
 *
 * L'espace de stockage est PRIVÉ : le fichier ne sort que par le serveur, à son auteur ou à
 * l'administration.
 */

/** Limite de dépôt de l'offre gratuite de Supabase. */
const MAX_BYTES = 50 * 1024 * 1024;
const DAY_MS = 24 * 3_600_000;
/** Durée de conservation chez Google : au-delà, plus rien à copier. */
export const VEO_KEEPS_DAYS = 2;

const bucket = (): BucketOptions => ({ id: env.CREATIVES_BUCKET, public: false, fileSizeLimit: MAX_BYTES });

export function videoArchiveConfigured(): boolean {
  return supabaseStorage() !== null;
}

/** Chemin de l'objet : l'identifiant d'opération, déjà validé par son schéma (lettres et chiffres). */
const objectPath = (requestId: string) => `veo/${requestId}.mp4`;

/** Jours de conservation promis à l'auteur : ceux de son palier (administration : le plus long). */
export async function videoRetentionDaysFor(userId: string): Promise<number> {
  const [user] = await getDb().select({ role: users.role, plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return VEO_KEEPS_DAYS;
  if (user.role === 'admin') return UNLIMITED.videoRetentionDays;
  return (await getPlan(user.plan)).limits.videoRetentionDays;
}

/** Une copie n'a de sens que si le palier promet plus que ce que Google garde. */
export const needsArchive = (retentionDays: number) => retentionDays > VEO_KEEPS_DAYS;

interface ArchivableGeneration {
  id: string;
  userId: string;
  providerRef: string | null;
  archivedAt: Date | null;
  parentId: string | null;
  completedAt: Date | null;
  createdAt: Date;
}

/**
 * Copie la vidéo d'une génération Veo terminée, une seule fois, si le palier de l'auteur le
 * justifie. Ne lève jamais : un échec est journalisé, et le balayage de nuit réessaie tant que
 * Google garde le fichier.
 *
 * @returns vrai si la vidéo est (désormais) archivée.
 */
export async function archiveVeoVideo(generation: ArchivableGeneration): Promise<boolean> {
  if (generation.archivedAt) return true;
  const target = supabaseStorage();
  if (!target || !generation.providerRef) return false;

  try {
    const retentionDays = await videoRetentionDaysFor(generation.userId);
    if (!needsArchive(retentionDays)) return false;

    const veo = await getVeoGeneration(generation.providerRef);
    if (veo.status !== 'completed' || !veo.mediaUrl) return false;
    const media = await fetchVeoMedia(veo.mediaUrl);
    const declared = Number(media.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) throw new Error(`vidéo de ${declared} octets, au-delà de la limite de dépôt`);
    const bytes = await media.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) throw new Error(`vidéo de ${bytes.byteLength} octets, au-delà de la limite de dépôt`);

    await putObject(target, bucket(), objectPath(generation.providerRef), bytes, 'video/mp4');

    const ready = generation.completedAt ?? generation.createdAt;
    await getDb()
      .update(generations)
      .set({ archivedAt: new Date(), archiveExpiresAt: new Date(ready.getTime() + retentionDays * DAY_MS) })
      .where(eq(generations.id, generation.id));

    if (generation.parentId) await dropReplacedVersion(generation.parentId);
    return true;
  } catch (error) {
    console.error('[archive vidéo]', generation.id, error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Vidéo longue : la version prolongée contient toute la précédente. Garder les deux doublait,
 * puis triplait le stockage à chaque étape, pour un fichier que personne ne rouvre.
 */
async function dropReplacedVersion(parentId: string): Promise<void> {
  const target = supabaseStorage();
  const [parent] = await getDb()
    .select({ id: generations.id, providerRef: generations.providerRef, archivedAt: generations.archivedAt })
    .from(generations)
    .where(eq(generations.id, parentId))
    .limit(1);
  if (!target || !parent?.archivedAt || !parent.providerRef) return;
  await removeObjects(target, env.CREATIVES_BUCKET, [objectPath(parent.providerRef)]);
  await getDb().update(generations).set({ archivedAt: null, archiveExpiresAt: new Date() }).where(eq(generations.id, parent.id));
}

/** La copie archivée, ou null si elle n'existe pas (l'appelant se rabat alors sur Google). */
export async function fetchArchivedVideo(requestId: string): Promise<Response | null> {
  const target = supabaseStorage();
  return target ? getObject(target, env.CREATIVES_BUCKET, objectPath(requestId)) : null;
}

/**
 * Date jusqu'à laquelle la vidéo reste téléchargeable : celle de la copie, ou à défaut les deux
 * jours de Google à compter de la fin du rendu.
 */
export function videoAvailableUntil(generation: { archivedAt: Date | null; archiveExpiresAt: Date | null; completedAt: Date | null; createdAt: Date }): Date {
  if (generation.archiveExpiresAt) return generation.archiveExpiresAt;
  return new Date((generation.completedAt ?? generation.createdAt).getTime() + VEO_KEEPS_DAYS * DAY_MS);
}

const archivableColumns = {
  id: generations.id,
  userId: generations.userId,
  providerRef: generations.providerRef,
  archivedAt: generations.archivedAt,
  parentId: generations.parentId,
  completedAt: generations.completedAt,
  createdAt: generations.createdAt,
};

/**
 * Filet du balayage de nuit : copie les vidéos Veo terminées depuis moins de deux jours et
 * pas encore archivées (dépôt interrompu, ou clé ajoutée après leur création). Les vidéos
 * dont le palier ne prévoit pas de copie sont écartées par `archiveVeoVideo`.
 */
export async function archivePendingVideos(now = new Date(), limit = 20): Promise<{ archived: number; failed: number }> {
  if (!videoArchiveConfigured()) return { archived: 0, failed: 0 };
  const rows = await getDb()
    .select(archivableColumns)
    .from(generations)
    .where(
      and(
        eq(generations.provider, 'veo'),
        eq(generations.status, 'completed'),
        isNull(generations.archivedAt),
        isNull(generations.archiveExpiresAt),
        gt(generations.createdAt, new Date(now.getTime() - VEO_KEEPS_DAYS * DAY_MS)),
      ),
    )
    .limit(limit);
  let archived = 0;
  for (const row of rows) if (await archiveVeoVideo(row)) archived += 1;
  return { archived, failed: rows.length - archived };
}

/**
 * Efface les copies arrivées à échéance. La ligne reste, avec sa date : l'écran peut dire que
 * la vidéo a expiré, et depuis quand, au lieu d'une erreur « introuvable ».
 */
export async function purgeExpiredVideos(now = new Date(), limit = 500): Promise<{ purged: number }> {
  const target = supabaseStorage();
  if (!target) return { purged: 0 };
  const rows = await getDb()
    .select({ id: generations.id, providerRef: generations.providerRef })
    .from(generations)
    .where(and(isNotNull(generations.archivedAt), isNotNull(generations.archiveExpiresAt), lt(generations.archiveExpiresAt, now)))
    .limit(limit);
  if (rows.length === 0) return { purged: 0 };

  await removeObjects(
    target,
    env.CREATIVES_BUCKET,
    rows.flatMap((row) => (row.providerRef ? [objectPath(row.providerRef)] : [])),
  );
  for (const row of rows) await getDb().update(generations).set({ archivedAt: null }).where(eq(generations.id, row.id));
  return { purged: rows.length };
}
