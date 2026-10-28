import { env } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';
import { SPEECH_SAMPLE_RATE, type SpokenAudio, secondsOf } from '@server/services/ai/geminiSpeech';

/**
 * Lecture à voix haute par MeloTTS, chez Cloudflare Workers AI : la voix gratuite du parcours audio.
 *
 * La voix venait de Gemini ; son projet est bloqué depuis le 25/10/2026 (« Your project has been
 * denied access »), et le propriétaire a décidé de faire sans lui. Essayé ce jour-là sur l'API : une
 * phrase française de 23 mots rendue en 3 s (7,8 s d'audio), un texte d'une minute en 8 s ; Whisper
 * l'a retranscrit mot pour mot. Prix annoncé : 0,000205 $ la minute d'audio, dans la franchise
 * quotidienne de Cloudflare. Une seule voix française : pas de choix de voix avec ce service.
 *
 * Réponse : un JSON { result: { audio } }, l'audio en base64, au format WAV (PCM 16 bits mono,
 * 44,1 kHz mesurés). Le parcours audio travaille en PCM 24 kHz (voir mp3.ts) : l'audio y est
 * ramené.
 */

const MODEL = '@cf/myshell-ai/melotts';
const GAP = Buffer.alloc(Math.round(SPEECH_SAMPLE_RATE * 0.6) * 2);

/** Compte et jeton Workers AI : depuis le retrait des images (28/10/2026), Cloudflare ne sert plus qu'à la voix. */
export const cloudflareSpeechConfigured = (): boolean => Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN);

/** Le PCM 16 bits mono d'un fichier WAV, et sa fréquence. Lève si le fichier n'en est pas un. */
export function pcmOfWav(wav: Buffer): { pcm: Buffer; sampleRate: number } {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('pas un fichier WAV');
  let offset = 12;
  let sampleRate = 0;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = wav.readUInt16LE(offset + 10);
      sampleRate = wav.readUInt32LE(offset + 12);
      bits = wav.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      if (channels !== 1 || bits !== 16 || !sampleRate) throw new Error(`WAV inattendu (${channels} canaux, ${bits} bits)`);
      return { pcm: wav.subarray(offset + 8, Math.min(wav.length, offset + 8 + size)), sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV sans données');
}

/** Ramène un PCM 16 bits mono à `target` Hz, par interpolation linéaire : assez pour la voix. */
export function resample(pcm: Buffer, from: number, target = SPEECH_SAMPLE_RATE): Buffer {
  if (from === target) return pcm;
  const input = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const length = Math.floor((input.length * target) / from);
  const output = Buffer.alloc(length * 2);
  for (let index = 0; index < length; index += 1) {
    const position = (index * from) / target;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const value = input[left]! + (input[right]! - input[left]!) * (position - left);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), index * 2);
  }
  return output;
}

async function speakOne(text: string, timeoutMs: number): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(`${env.CLOUDFLARE_AI_URL.replace(/\/+$/, '')}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_AI_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, lang: 'fr' }),
      signal: AbortSignal.timeout(Math.max(5_000, timeoutMs)),
    });
  } catch {
    throw new AppError(504, 'La lecture à voix haute n’a pas répondu à temps : vos points ont été rendus.', 'CF_SPEECH_TIMEOUT');
  }
  const payload = (await response.json().catch(() => null)) as { success?: boolean; result?: { audio?: string } } | null;
  if (response.status === 429) throw new AppError(429, 'La lecture à voix haute est très demandée en ce moment : vos points ont été rendus.', 'CF_SPEECH_QUOTA');
  if (!response.ok || !payload?.result?.audio) {
    console.error('[voix cloudflare] le fournisseur a répondu', response.status);
    throw new AppError(502, 'La lecture à voix haute n’a pas abouti : vos points ont été rendus.', 'CF_SPEECH_FAILED');
  }
  const { pcm, sampleRate } = pcmOfWav(Buffer.from(payload.result.audio, 'base64'));
  return resample(pcm, sampleRate);
}

/**
 * Lit plusieurs passages, deux de front, et les met bout à bout dans l'ordre, séparés d'un court
 * silence. Un passage qui échoue est repris une fois, seul.
 */
export async function speakPassagesCloudflare(passages: readonly string[], options: { budgetMs?: number; concurrency?: number } = {}): Promise<SpokenAudio> {
  if (!cloudflareSpeechConfigured()) throw providerUnavailable('lecture à voix haute');
  const deadline = Date.now() + (options.budgetMs ?? 240_000);
  const spoken = new Array<Buffer | undefined>(passages.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < passages.length; index = next++) {
      const say = () => speakOne(passages[index]!, deadline - Date.now());
      spoken[index] = await say().catch((error: unknown) => {
        if (error instanceof AppError && error.code === 'CF_SPEECH_QUOTA') throw error;
        return say();
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 2, passages.length) }, worker));
  const pcm = Buffer.concat(spoken.flatMap((audio, index) => (audio ? (index === 0 ? [audio] : [GAP, audio]) : [])));
  return { pcm, seconds: secondsOf(pcm), model: MODEL };
}
