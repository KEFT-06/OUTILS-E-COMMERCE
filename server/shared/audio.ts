import { SPEECH_CHARS_PER_SECOND, spokenText } from '@server/shared/speech';

/**
 * Parcours audio : la lecture à voix haute des modules d'un ouvrage. Contrat partagé entre le
 * serveur, qui lit et enregistre, et l'écran, qui annonce la durée et le prix avant de lancer.
 */

/** Voix proposées. `tone` : le caractère que le service de voix donne à chacune. */
export const AUDIO_VOICES = [
  { id: 'posee', label: 'Posée', tone: 'Ferme et calme : celle d’un formateur.' },
  { id: 'chaleureuse', label: 'Chaleureuse', tone: 'Douce et proche : celle d’un accompagnement.' },
  { id: 'pedagogue', label: 'Pédagogue', tone: 'Claire et précise : celle d’une explication.' },
  { id: 'dynamique', label: 'Dynamique', tone: 'Vive et entraînante : celle d’une motivation.' },
] as const;

export type AudioVoiceId = (typeof AUDIO_VOICES)[number]['id'];
export const AUDIO_VOICE_IDS = AUDIO_VOICES.map((voice) => voice.id) as [AudioVoiceId, ...AudioVoiceId[]];

/** En deçà, il n'y a pas un module à lire : un titre, une ligne de plan. */
export const AUDIO_TEXT_MIN = 300;
/** Un module du Studio fait 12 000 caractères au plus ; la marge couvre son titre. */
export const AUDIO_TEXT_MAX = 14_000;
/** Tranche de facturation, en minutes (voir « audio_reading » dans credit-costs.json). */
export const AUDIO_MINUTES_PER_UNIT = 10;

/** Ce qui sera lu : le titre du module, une pause, puis son texte. */
export const audioScript = (title: string, text: string): string => spokenText(`${title.trim() ? `## ${title.trim()}\n\n` : ''}${text}`);

/** Minutes de lecture d'un module, arrondies à la minute entamée : ce que l'écran annonce et ce qui est facturé. */
export const audioMinutes = (title: string, text: string): number => Math.max(1, Math.ceil(audioScript(title, text).length / SPEECH_CHARS_PER_SECOND / 60));

/** Un module est-il assez rédigé pour être lu ? Une ligne de plan ne l'est pas. */
export const audioReady = (text: string): boolean => spokenText(text).length >= AUDIO_TEXT_MIN;

/** Une piste audio, telle que le serveur la décrit (sans ses octets). */
export interface AudioTrack {
  id: string;
  subjectId: string;
  /** Rang du module dans l'ouvrage, à partir de 1. */
  position: number;
  title: string;
  voice: AudioVoiceId;
  seconds: number;
  bytes: number;
  createdAt: string;
  /** Fin de conservation du fichier ; null : sans limite. */
  expiresAt: string | null;
}

/** « 12 min 05 » : une durée telle qu'on la dit. */
export function formatAudioDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes === 0 ? `${rest} s` : `${minutes} min ${String(rest).padStart(2, '0')}`;
}
