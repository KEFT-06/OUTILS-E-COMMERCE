import type { AudioTrack, AudioVoiceId } from '@server/shared/audio';
import { apiRequest } from '@/shared/lib/api';

/** Parcours audio : les modules d'un ouvrage lus à voix haute (server/services/audio). */
export const audioApi = {
  /** Les ouvrages du compte qui ont des pistes : combien, et pour quelle durée. */
  summary: () => apiRequest<{ subjects: { subjectId: string; tracks: number; seconds: number }[] }>('/api/audio/summary').then((response) => response.subjects),
  list: (subjectId: string) => apiRequest<{ tracks: AudioTrack[] }>(`/api/audio/tracks?subjectId=${encodeURIComponent(subjectId)}`).then((response) => response.tracks),
  create: (input: { subjectId: string; position: number; title: string; text: string; voice: AudioVoiceId }) =>
    apiRequest<{ track: AudioTrack }>('/api/audio/tracks', { method: 'POST', body: input }).then((response) => response.track),
  remove: (trackId: string) => apiRequest<void>(`/api/audio/tracks/${trackId}`, { method: 'DELETE' }),
  /** À écouter dans la page ; la date de création change l'adresse quand la piste est relue. */
  fileUrl: (track: Pick<AudioTrack, 'id' | 'createdAt'>) => `/api/audio/tracks/${track.id}/file?v=${encodeURIComponent(track.createdAt)}`,
  downloadUrl: (track: Pick<AudioTrack, 'id'>) => `/api/audio/tracks/${track.id}/file?download=1`,
};
