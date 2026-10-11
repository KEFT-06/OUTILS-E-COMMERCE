import { env } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';

/**
 * Synthèse vocale (Gemini TTS) : un passage de texte devient sa lecture à voix haute.
 *
 * Mesuré sur le vrai service le 11/10/2026, en français : 1 156 caractères donnent 71,7 s d'audio
 * (16 caractères par seconde lue), rendus en 22,6 s — trois fois plus vite qu'on ne les écoute.
 *
 * Le service rend du son BRUT (WAV, 24 kHz, mono, 16 bits) : 2,9 Mo la minute. C'est la matière
 * d'un montage, pas un fichier à remettre — un chapitre de douze minutes pèserait 34 Mo. Ce
 * module rend donc les échantillons, que l'appelant assemble puis compresse avant de les servir.
 */

export const SPEECH_SAMPLE_RATE = 24_000;
/** Deux octets par échantillon, un seul canal. */
const BYTES_PER_SECOND = SPEECH_SAMPLE_RATE * 2;
const TIMEOUT_MS = 120_000;
/** En deçà, un essai n'a pas le temps d'aboutir : on ne le lance pas. */
const MIN_ATTEMPT_MS = 15_000;

export interface SpokenAudio {
  /** Échantillons PCM 16 bits, petit-boutistes, mono, à SPEECH_SAMPLE_RATE. */
  pcm: Buffer;
  seconds: number;
  model: string;
}

interface SpeechPayload {
  candidates?: { finishReason?: string; content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  error?: { status?: string; message?: string };
}

export function speechConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

const failed = () => new AppError(502, 'La lecture à voix haute n’a pas pu être produite : vos points ont été rendus.', 'GEMINI_SPEECH_FAILED');

/**
 * Les échantillons d'une réponse du service. Fonction pure.
 *
 * Un WAV se lit bloc par bloc : supposer 44 octets d'en-tête ferait prendre un bloc d'informations
 * pour du son — un claquement au début de chaque passage, répété à chaque raccord. Une réponse sans
 * en-tête est du son brut, tel quel.
 */
export function pcmOf(audio: Buffer): Buffer {
  if (audio.length < 12 || audio.toString('latin1', 0, 4) !== 'RIFF' || audio.toString('latin1', 8, 12) !== 'WAVE') return audio;
  let offset = 12;
  let format: { code: number; channels: number; rate: number; bits: number } | null = null;
  while (offset + 8 <= audio.length) {
    const id = audio.toString('latin1', offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ' && start + 16 <= audio.length) {
      format = { code: audio.readUInt16LE(start), channels: audio.readUInt16LE(start + 2), rate: audio.readUInt32LE(start + 4), bits: audio.readUInt16LE(start + 14) };
    }
    if (id === 'data') {
      if (format && (format.code !== 1 || format.channels !== 1 || format.rate !== SPEECH_SAMPLE_RATE || format.bits !== 16)) throw failed();
      // Une taille annoncée plus grande que le fichier (flux coupé, taille inconnue) : on prend ce qui est là.
      return audio.subarray(start, Math.min(audio.length, start + size));
    }
    // Les blocs sont alignés sur deux octets.
    offset = start + size + (size % 2);
  }
  throw failed();
}

/** Un fichier WAV complet autour d'échantillons bruts. Fonction pure. */
export function wavOf(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SPEECH_SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export const secondsOf = (pcm: Buffer): number => pcm.length / BYTES_PER_SECOND;

/** Modèles de voix dans l'ordre d'essai, sans doublon. */
const speechModels = () => [...new Set([env.GEMINI_TTS_MODEL, env.GEMINI_TTS_FALLBACK_MODEL])];

export interface SpeechInput {
  /** Le texte à lire, mot pour mot. */
  text: string;
  /** Voix du catalogue du service. */
  voice: string;
  /** Façon de dire : « voix posée de formateur, débit calme ». */
  style?: string;
  /** Temps accordé à ce passage, tous essais compris. */
  budgetMs?: number;
}

/**
 * Lit un passage. Une saturation ou un délai fait passer au modèle suivant ; un refus du texte
 * (400) ne se rejoue pas ailleurs — le second modèle refuserait de même.
 */
export async function synthesizeSpeech(input: SpeechInput): Promise<SpokenAudio> {
  if (!env.GEMINI_API_KEY) throw providerUnavailable('lecture à voix haute');
  const deadline = Date.now() + (input.budgetMs ?? TIMEOUT_MS * 2);
  let last = 0;

  for (const model of speechModels()) {
    const left = deadline - Date.now();
    if (left < MIN_ATTEMPT_MS) break;
    let response: Response;
    try {
      response = await fetch(`${env.GEMINI_API_URL.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: input.text, ...(input.style ? { speech_metadata: { style: input.style } } : {}) }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: input.voice } } },
        }),
        signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, left)),
      });
    } catch {
      console.warn(`[voix] ${model} n’a pas répondu à temps`);
      last = 504;
      continue;
    }
    const payload = (await response.json().catch(() => null)) as SpeechPayload | null;
    if (response.status === 200) {
      const data = payload?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data;
      if (!data) {
        console.warn(`[voix] ${model} a répondu sans son (${payload?.candidates?.[0]?.finishReason ?? 'motif inconnu'})`);
        last = 502;
        continue;
      }
      const pcm = pcmOf(Buffer.from(data, 'base64'));
      if (pcm.length < BYTES_PER_SECOND / 4) throw failed();
      return { pcm, seconds: secondsOf(pcm), model };
    }

    console.warn(`[voix] ${model} a répondu ${response.status} :`, [payload?.error?.status, payload?.error?.message].filter(Boolean).join(' — ').slice(0, 300));
    if (response.status === 401 || response.status === 403) {
      throw new AppError(503, 'Le service de lecture à voix haute refuse l’accès du serveur : l’administrateur doit vérifier sa configuration.', 'GEMINI_SPEECH_ACCESS_DENIED');
    }
    if (response.status === 400) throw failed();
    last = response.status;
  }

  if (last === 429) throw new AppError(429, 'La lecture à voix haute n’a pas pu être produite. Vos points ont été rendus.', 'GEMINI_SPEECH_RATE_LIMITED');
  if (last === 504) throw new AppError(504, 'La lecture à voix haute n’a pas été produite à temps : vos points ont été rendus.', 'GEMINI_SPEECH_TIMEOUT');
  throw failed();
}

/** Silence entre deux passages : le souffle d'un lecteur qui change de paragraphe. */
const GAP = Buffer.alloc(Math.round(BYTES_PER_SECOND * 0.35));

/**
 * Lit plusieurs passages, quelques-uns de front, et les met bout à bout dans l'ordre. Un passage
 * qui échoue est repris une fois, seul : ses voisins ne sont pas relus pour autant.
 */
export async function speakPassages(passages: readonly string[], options: { voice: string; style?: string; concurrency?: number; budgetMs?: number }): Promise<SpokenAudio> {
  const deadline = Date.now() + (options.budgetMs ?? 240_000);
  const spoken = new Array<SpokenAudio | undefined>(passages.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < passages.length; index = next++) {
      const say = () => synthesizeSpeech({ text: passages[index]!, voice: options.voice, style: options.style, budgetMs: deadline - Date.now() });
      spoken[index] = await say().catch((error: unknown) => {
        // Un refus d'accès ne se rejoue pas : il vaut pour tous les passages.
        if (error instanceof AppError && error.code === 'GEMINI_SPEECH_ACCESS_DENIED') throw error;
        return say();
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, passages.length) }, worker));

  const parts = spoken.flatMap((audio, index) => (audio ? (index === 0 ? [audio.pcm] : [GAP, audio.pcm]) : []));
  const pcm = Buffer.concat(parts);
  return { pcm, seconds: secondsOf(pcm), model: spoken.find(Boolean)?.model ?? env.GEMINI_TTS_MODEL };
}
