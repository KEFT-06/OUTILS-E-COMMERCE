import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';
import { and, asc, eq, isNotNull, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { audioTracks } from '@server/db/schema';
import { env } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { speakPassages, speechConfigured } from '@server/services/ai/geminiSpeech';
import { cloudflareSpeechConfigured, speakPassagesCloudflare } from '@server/services/ai/cloudflareSpeech';
import { MP3_BYTES_PER_SECOND, encodeMp3 } from '@server/services/audio/mp3';
import { videoRetentionDaysFor } from '@server/services/creatives/archive';
import { runBilledGeneration } from '@server/services/generations';
import { type BucketOptions, getObject, putObject, removeObjects, supabaseStorage } from '@server/services/storage/supabase';
import { AUDIO_TEXT_MAX, AUDIO_TEXT_MIN, AUDIO_VOICE_IDS, type AudioTrack, type AudioVoiceId, audioMinutes, audioScript } from '@server/shared/audio';
import { splitForSpeech } from '@server/shared/speech';

/**
 * Parcours audio : chaque module d'un ouvrage, lu à voix haute et remis en MP3.
 *
 * Demande du propriétaire : « quand ça met parcours audio, ça devait rédiger l'ebook plus l'audio
 * téléchargeable ». Le Studio rédige ; ce service lit. Un module à la fois : c'est ce qu'un auteur
 * écoute, corrige et vend — et un module refait ne fait pas relire les autres.
 *
 *   texte du module → ce qu'un lecteur dirait (shared/speech) → passages lus de front (Gemini TTS)
 *   → un seul fichier MP3 (audio/mp3) → rangé au stockage de fichiers, à défaut en base.
 *
 * Le fichier suit la conservation des vidéos du palier : c'est un fichier lourd de la même
 * famille, et l'auteur le télécharge pour le vendre ailleurs.
 */

/** Voix du service derrière chaque voix proposée, et la façon de dire demandée. */
const VOICES: Record<AudioVoiceId, { name: string; style: string }> = {
  posee: { name: 'Kore', style: 'voix posée de formateur, débit calme, articulation nette' },
  chaleureuse: { name: 'Sulafat', style: 'voix chaleureuse et proche, débit calme, comme on parle à quelqu’un qu’on accompagne' },
  pedagogue: { name: 'Charon', style: 'voix claire d’enseignant, débit régulier, chaque idée bien détachée' },
  dynamique: { name: 'Puck', style: 'voix vive et entraînante, débit soutenu sans précipitation' },
};

const DAY_MS = 86_400_000;
/** Temps accordé à la lecture d'un module ; l'encodage et le dépôt prennent le reste des 300 s de l'hébergeur. */
const SPEAK_BUDGET_MS = 215_000;
/** Au-delà, une piste rangée en base alourdirait chaque sauvegarde : le stockage de fichiers est alors exigé. */
const DB_MAX_BYTES = 6 * 1024 * 1024;

const bucket = (): BucketOptions => ({ id: env.CREATIVES_BUCKET, public: false, fileSizeLimit: 50 * 1024 * 1024 });
const objectPath = (userId: string, trackId: string) => `audio/${userId}/${trackId}.mp3`;

export const audioRequestSchema = z.object({
  /** L'ouvrage : identifiant du produit dans le Studio. */
  subjectId: z.string().trim().min(1).max(100),
  position: z.number().int().min(1).max(60),
  title: z.string().trim().max(200).default(''),
  text: z
    .string()
    .trim()
    .min(AUDIO_TEXT_MIN, 'Ce module est trop court pour être lu : rédigez-le d’abord.')
    .max(AUDIO_TEXT_MAX, 'Ce module est trop long pour une seule piste : coupez-le en deux modules.'),
  voice: z.enum(AUDIO_VOICE_IDS).default('posee'),
});

export type AudioRequest = z.infer<typeof audioRequestSchema>;

type TrackRow = typeof audioTracks.$inferSelect;

const viewOf = (row: Pick<TrackRow, 'id' | 'subjectId' | 'position' | 'title' | 'voice' | 'seconds' | 'bytes' | 'createdAt' | 'expiresAt'>): AudioTrack => ({
  id: row.id,
  subjectId: row.subjectId,
  position: row.position,
  title: row.title,
  voice: (AUDIO_VOICE_IDS as readonly string[]).includes(row.voice) ? (row.voice as AudioVoiceId) : 'posee',
  seconds: row.seconds,
  bytes: row.bytes,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt?.toISOString() ?? null,
});

const SUMMARY = {
  id: audioTracks.id,
  subjectId: audioTracks.subjectId,
  position: audioTracks.position,
  title: audioTracks.title,
  voice: audioTracks.voice,
  seconds: audioTracks.seconds,
  bytes: audioTracks.bytes,
  createdAt: audioTracks.createdAt,
  expiresAt: audioTracks.expiresAt,
};

/** Lit un module à voix haute et l'enregistre. La piste précédente de ce module, s'il y en avait une, est remplacée. */
export async function createAudioTrack(auth: RequestAuth, input: AudioRequest): Promise<AudioTrack> {
  // La voix gratuite (Cloudflare) d'abord ; celle de Gemini seulement à défaut — son projet est bloqué depuis le 25/10/2026.
  const voixGratuite = cloudflareSpeechConfigured();
  if (!voixGratuite && !speechConfigured()) throw providerUnavailable('lecture à voix haute');
  const userId = auth.account.user.id;
  const script = audioScript(input.title, input.text);
  if (script.length < AUDIO_TEXT_MIN) throw new AppError(400, 'Ce module est trop court pour être lu : rédigez-le d’abord.', 'AUDIO_TEXT_TOO_SHORT');
  const voice = VOICES[input.voice];
  const storage = supabaseStorage();

  const { result } = await runBilledGeneration({
    auth,
    actionId: 'audio_reading',
    // Toute tranche de dix minutes entamée est due : le même calcul que celui que l'écran annonce.
    units: audioMinutes(input.title, input.text),
    kind: 'audio',
    provider: voixGratuite ? 'cloudflare' : 'gemini',
    run: async () => {
      const spoken = voixGratuite
        ? await speakPassagesCloudflare(splitForSpeech(script), { budgetMs: SPEAK_BUDGET_MS })
        : await speakPassages(splitForSpeech(script), { voice: voice.name, style: voice.style, budgetMs: SPEAK_BUDGET_MS });
      const mp3 = encodeMp3(spoken.pcm);
      if (!storage && mp3.length > DB_MAX_BYTES) throw providerUnavailable('enregistrement des fichiers audio');
      return { mp3, seconds: Math.round(spoken.seconds) };
    },
    describe: () => ({ providerRef: null, state: 'completed', fileFormat: 'mp3' }),
  });

  const retention = await videoRetentionDaysFor(userId);
  const [row] = await getDb()
    .insert(audioTracks)
    .values({
      userId,
      subjectId: input.subjectId,
      position: input.position,
      title: input.title,
      voice: input.voice,
      seconds: result.seconds,
      bytes: result.mp3.length,
      expiresAt: Number.isFinite(retention) && retention > 0 && retention < 36_500 ? new Date(Date.now() + retention * DAY_MS) : null,
      data: storage ? null : result.mp3.toString('base64'),
    })
    .returning();

  if (storage) {
    try {
      await putObject(storage, bucket(), objectPath(userId, row!.id), result.mp3, 'audio/mpeg');
      await getDb().update(audioTracks).set({ storagePath: objectPath(userId, row!.id) }).where(eq(audioTracks.id, row!.id));
    } catch (error) {
      // Dépôt refusé : la piste reste en base si elle y tient, pour que l'auteur ait ce qu'il a payé.
      console.warn('[audio] dépôt au stockage impossible :', error instanceof Error ? error.message : error);
      if (result.mp3.length > DB_MAX_BYTES) {
        await getDb().delete(audioTracks).where(eq(audioTracks.id, row!.id));
        throw providerUnavailable('enregistrement des fichiers audio');
      }
      await getDb().update(audioTracks).set({ data: result.mp3.toString('base64') }).where(eq(audioTracks.id, row!.id));
    }
  }

  // Une seule piste par module : la précédente est retirée, son fichier aussi.
  const replaced = await getDb()
    .delete(audioTracks)
    .where(and(eq(audioTracks.userId, userId), eq(audioTracks.subjectId, input.subjectId), eq(audioTracks.position, input.position), ne(audioTracks.id, row!.id)))
    .returning({ storagePath: audioTracks.storagePath });
  await removeFiles(replaced.flatMap((old) => (old.storagePath ? [old.storagePath] : [])));

  return viewOf(row!);
}

async function removeFiles(paths: string[]): Promise<void> {
  const storage = supabaseStorage();
  if (!storage || paths.length === 0) return;
  await removeObjects(storage, bucket().id, paths).catch((error: unknown) => console.warn('[audio] fichiers non effacés :', error instanceof Error ? error.message : error));
}

/** Les pistes d'un ouvrage, dans l'ordre de ses modules. */
export async function listAudioTracks(auth: RequestAuth, subjectId: string): Promise<AudioTrack[]> {
  const rows = await getDb()
    .select(SUMMARY)
    .from(audioTracks)
    .where(and(eq(audioTracks.userId, auth.account.user.id), eq(audioTracks.subjectId, subjectId)))
    .orderBy(asc(audioTracks.position));
  return rows.map(viewOf);
}

/** Pour chaque ouvrage du compte qui a des pistes : combien, et pour quelle durée. */
export async function audioSummary(auth: RequestAuth): Promise<{ subjectId: string; tracks: number; seconds: number }[]> {
  const rows = await getDb()
    .select({ subjectId: audioTracks.subjectId, seconds: audioTracks.seconds })
    .from(audioTracks)
    .where(eq(audioTracks.userId, auth.account.user.id));
  const bySubject = new Map<string, { subjectId: string; tracks: number; seconds: number }>();
  for (const row of rows) {
    const entry = bySubject.get(row.subjectId) ?? { subjectId: row.subjectId, tracks: 0, seconds: 0 };
    entry.tracks += 1;
    entry.seconds += row.seconds;
    bySubject.set(row.subjectId, entry);
  }
  return [...bySubject.values()];
}

const trackIdSchema = z.string().uuid();
const notFound = () => new AppError(404, 'Piste audio introuvable sur votre compte.', 'AUDIO_TRACK_NOT_FOUND');

async function ownedTrack(auth: RequestAuth, trackId: string | undefined): Promise<TrackRow> {
  const parsed = trackIdSchema.safeParse(trackId);
  if (!parsed.success) throw notFound();
  const [row] = await getDb()
    .select()
    .from(audioTracks)
    .where(and(eq(audioTracks.id, parsed.data), eq(audioTracks.userId, auth.account.user.id)))
    .limit(1);
  if (!row) throw notFound();
  return row;
}

/** Nom du fichier remis à l'auteur : « 03 - choisir-son-emplacement.mp3 ». */
function fileName(row: TrackRow): string {
  const slug = row.title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${String(row.position).padStart(2, '0')}${slug ? `-${slug}` : ''}.mp3`;
}

/** Sert le fichier d'une piste : à écouter dans la page, ou à télécharger (`download`). */
export async function sendAudioTrack(auth: RequestAuth, trackId: string | undefined, res: ExpressResponse, download: boolean): Promise<void> {
  const row = await ownedTrack(auth, trackId);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (download) res.setHeader('Content-Disposition', `attachment; filename="${fileName(row)}"`);

  if (row.data) {
    const bytes = Buffer.from(row.data, 'base64');
    res.setHeader('Content-Length', String(bytes.length));
    res.end(bytes);
    return;
  }
  const storage = supabaseStorage();
  const stored = storage && row.storagePath ? await getObject(storage, bucket().id, row.storagePath) : null;
  if (!stored?.body) throw new AppError(404, 'Ce fichier audio n’est plus disponible : relisez ce module pour le retrouver.', 'AUDIO_FILE_MISSING');
  res.setHeader('Content-Length', String(row.bytes));
  await pipeline(Readable.fromWeb(stored.body as NodeReadableStream<Uint8Array>), res);
}

export async function deleteAudioTrack(auth: RequestAuth, trackId: string | undefined): Promise<void> {
  const row = await ownedTrack(auth, trackId);
  await getDb().delete(audioTracks).where(eq(audioTracks.id, row.id));
  await removeFiles(row.storagePath ? [row.storagePath] : []);
}

/** Efface les pistes dont la conservation est échue (appelé par le relevé quotidien). */
export async function purgeExpiredAudio(now = new Date(), limit = 300): Promise<{ purged: number }> {
  const expired = await getDb()
    .select({ id: audioTracks.id, storagePath: audioTracks.storagePath })
    .from(audioTracks)
    .where(and(isNotNull(audioTracks.expiresAt), lt(audioTracks.expiresAt, now)))
    .limit(limit);
  for (const row of expired) await getDb().delete(audioTracks).where(eq(audioTracks.id, row.id));
  await removeFiles(expired.flatMap((row) => (row.storagePath ? [row.storagePath] : [])));
  return { purged: expired.length };
}

/** Poids annoncé d'une piste, avant de la produire. */
export const audioBytesFor = (seconds: number): number => Math.round(seconds * MP3_BYTES_PER_SECOND);
