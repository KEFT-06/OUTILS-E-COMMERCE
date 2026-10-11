import { Mp3Encoder } from '@breezystack/lamejs';
import { SPEECH_SAMPLE_RATE } from '@server/services/ai/geminiSpeech';

/**
 * Compression en MP3 du son rendu par la synthèse vocale.
 *
 * Le service de voix rend du son brut : 2,9 Mo la minute. En MP3 mono à 40 kbit/s — largement
 * assez pour une voix —, la minute pèse 0,3 Mo : un chapitre de douze minutes passe de 34 Mo à
 * moins de 4. C'est ce qui le rend servable par l'hébergeur (réponses limitées à 4,5 Mo),
 * téléchargeable sur une connexion mobile, et lisible partout.
 */

export const MP3_KBPS = 40;
/** Octets par seconde du fichier produit : de quoi annoncer un poids avant de lancer. */
export const MP3_BYTES_PER_SECOND = (MP3_KBPS * 1000) / 8;

/** Trames de 576 échantillons à cette fréquence : on en encode un paquet à la fois, sans tout garder en double. */
const BLOCK_SAMPLES = 576 * 200;

/** Encode des échantillons PCM 16 bits mono (à SPEECH_SAMPLE_RATE) en MP3. */
export function encodeMp3(pcm: Buffer): Buffer {
  // Vue alignée sur deux octets : un tampon tiré d'un plus grand peut commencer à une adresse impaire.
  const aligned = pcm.byteOffset % 2 === 0 ? pcm : Buffer.from(pcm);
  const samples = new Int16Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.length / 2));
  const encoder = new Mp3Encoder(1, SPEECH_SAMPLE_RATE, MP3_KBPS);
  const parts: Uint8Array[] = [];
  for (let start = 0; start < samples.length; start += BLOCK_SAMPLES) {
    const encoded = encoder.encodeBuffer(samples.subarray(start, start + BLOCK_SAMPLES));
    if (encoded.length > 0) parts.push(Uint8Array.from(encoded));
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(Uint8Array.from(tail));
  return Buffer.concat(parts);
}
