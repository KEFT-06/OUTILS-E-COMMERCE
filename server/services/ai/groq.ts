import { env } from '@server/env';

/**
 * Groq : le directeur artistique et le rédacteur de consignes FLUX du site.
 *
 * Il remplace Claude pour écrire ce que le moteur d'images reçoit (scène, maquette,
 * relecture). API OpenAI-compatible. Son absence n'est jamais une panne : l'appelant
 * reçoit une `GroqError`, compose sa consigne sans lui, et l'auteur a son image.
 */

export type GroqFailure =
  | 'NOT_CONFIGURED'
  | 'AUTH'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UNREACHABLE'
  | 'BAD_REQUEST'
  | 'UNAVAILABLE'
  | 'REFUSED'
  | 'TRUNCATED'
  | 'EMPTY'
  /** Consigne + réponse au-delà des jetons par minute du modèle : refusée d'emblée (413). */
  | 'TOO_LARGE';

export class GroqError extends Error {
  constructor(readonly reason: GroqFailure) {
    super(`Direction artistique indisponible (${reason}).`);
    this.name = 'GroqError';
  }
}

let lastOutcome: { ok: boolean; code: GroqFailure | null; at: string } | null = null;

/** Dernier résultat, pour la page « État des services ». */
export function lastGroqOutcome() {
  return lastOutcome;
}

export function groqConfigured(): boolean {
  return Boolean(env.GROQ_API_KEY);
}

function reasonOfStatus(status: number): GroqFailure {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 413) return 'TOO_LARGE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400 || status === 404) return 'BAD_REQUEST';
  return 'UNAVAILABLE';
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/**
 * Modèles qui acceptent un schéma de réponse (« json_schema »), d'après la documentation de Groq
 * relue le 25/10/2026. Les autres — dont le modèle texte et le modèle vision par défaut — le
 * refusent par un 400 : ils reçoivent le schéma dans leur consigne, en mode « json_object ».
 */
const SCHEMA_MODELS = /^(openai\/gpt-oss|qwen\/qwen3|meta-models\/muse-spark)/;

/**
 * Jetons par minute de l'offre gratuite, par modèle (relevés le 25/10/2026 ; la page
 * console.groq.com/settings/limits fait foi). Groq compte la consigne ET le plafond de réponse :
 * une demande qui dépasse est refusée d'emblée (413). Le plafond de réponse est donc ramené à ce
 * qui tient.
 */
const FREE_TOKENS_PER_MINUTE: [RegExp, number][] = [
  [/gpt-oss/, 8_000],
  [/qwen3/, 8_000],
];
const tokensPerMinute = (model: string) => FREE_TOKENS_PER_MINUTE.find(([pattern]) => pattern.test(model))?.[1] ?? 8_000;
/** Estimation prudente pour du français : un jeton pour trois caractères. */
const estimatedTokens = (text: string) => Math.ceil(text.length / 3);
/** En deçà, la réponse serait coupée : la demande ne part pas. */
const MIN_ANSWER_TOKENS = 512;

/**
 * Une demande, une réponse en texte.
 *
 * `maxTokens` borne la réponse. Une réponse coupée par ce plafond est rejetée
 * (`TRUNCATED`) plutôt que servie à moitié.
 */
export async function askGroq(input: {
  system: string;
  prompt: string;
  maxTokens: number;
  /** Délai d'un essai. */
  timeoutMs: number;
  /** Essais supplémentaires après un premier échec passager. 1 par défaut ; 0 quand le temps est compté. */
  retries?: number;
  /** Ignoré (compatibilité Claude) : Groq n'a pas d'effort configurable de la même façon. */
  effort?: 'low' | 'medium' | 'high';
  /** Forme imposée à la réponse : elle arrive alors en JSON, conforme à ce schéma. */
  jsonSchema?: Record<string, unknown>;
  /** Images à regarder avant de répondre (relecture d'une couverture rendue). */
  images?: { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: Buffer }[];
  /** Modèle à utiliser ; défaut : GROQ_MODEL, ou GROQ_VISION_MODEL s'il y a des images. */
  model?: string;
}): Promise<string> {
  try {
    if (!env.GROQ_API_KEY) throw new GroqError('NOT_CONFIGURED');

    const hasImages = Boolean(input.images?.length);
    // Une réponse en JSON imposé va au modèle qui accepte un schéma ; les images, au modèle vision.
    const model = input.model ?? (hasImages ? env.GROQ_VISION_MODEL : input.jsonSchema ? env.GROQ_JSON_MODEL : env.GROQ_MODEL);
    const schemaNative = Boolean(input.jsonSchema) && SCHEMA_MODELS.test(model);
    // Sans schéma natif, le modèle lit la forme attendue dans sa consigne (le mode JSON exige d'y nommer « JSON »).
    /*
      La forme attendue est écrite dans la consigne, schéma natif ou non. Essayé sur l'API le
      25/10/2026 : avec le seul schéma natif, qwen3.8 a rendu « {cite data} » (400
      « json_validate_failed ») sur une relecture d'image ; avec la forme dans la consigne, du JSON
      conforme. Le mode JSON exige d'ailleurs que la consigne nomme « JSON ».
    */
    const system = input.jsonSchema ? `${input.system}\n\nRéponds par un seul objet JSON, conforme à ce schéma JSON :\n${JSON.stringify(input.jsonSchema)}` : input.system;
    const budget = tokensPerMinute(model) - estimatedTokens(system + input.prompt) - 200;
    if (budget < MIN_ANSWER_TOKENS) throw new GroqError('TOO_LARGE');
    const maxTokens = Math.min(input.maxTokens, budget);

    const userContent: string | ContentPart[] = hasImages
      ? [
          ...(input.images ?? []).map(
            (image): ContentPart => ({
              type: 'image_url',
              image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString('base64')}` },
            }),
          ),
          { type: 'text', text: input.prompt },
        ]
      : input.prompt;

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    };
    // gpt-oss raisonne avant de répondre, sur le même plafond : un raisonnement court laisse la place à la réponse.
    if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';

    if (input.jsonSchema) {
      /*
        Schéma « au mieux » (strict: false) : le mode strict exige que chaque champ soit obligatoire
        et chaque objet fermé (additionalProperties: false), ce que nos schémas ne sont pas.
        L'appelant valide la réponse de toute façon.
      */
      body.response_format = schemaNative
        ? { type: 'json_schema', json_schema: { name: 'response', strict: false, schema: input.jsonSchema } }
        : { type: 'json_object' };
    }

    const attempts = 1 + (input.retries ?? 1);
    let lastError: GroqError = new GroqError('UNAVAILABLE');

    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs);
      try {
        const response = await fetch(`${env.GROQ_API_URL.replace(/\/+$/, '')}/openai/v1/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.GROQ_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const reason = reasonOfStatus(response.status);
          lastError = new GroqError(reason);
          // JSON raté par le modèle (« json_validate_failed ») : un raté de génération, pas une demande fautive. Un nouvel essai.
          if (response.status === 400 && /json_validate_failed/.test(await response.text().catch(() => ''))) {
            lastError = new GroqError('UNAVAILABLE');
            continue;
          }
          // Auth, demande refusée ou trop grosse : la même demande échouerait de même.
          if (reason === 'AUTH' || reason === 'BAD_REQUEST' || reason === 'TOO_LARGE') throw lastError;
          continue;
        }

        const payload = (await response.json()) as {
          choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
        };
        const choice = payload.choices?.[0];
        if (choice?.message?.refusal) throw new GroqError('REFUSED');
        if (choice?.finish_reason === 'length') throw new GroqError('TRUNCATED');
        const text = (choice?.message?.content ?? '').trim();
        if (!text) throw new GroqError('EMPTY');
        lastOutcome = { ok: true, code: null, at: new Date().toISOString() };
        return text;
      } catch (error) {
        if (error instanceof GroqError) {
          lastError = error;
          if (['AUTH', 'BAD_REQUEST', 'REFUSED', 'TRUNCATED', 'EMPTY', 'TOO_LARGE'].includes(error.reason)) {
            throw error;
          }
          continue;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new GroqError('TIMEOUT');
          continue;
        }
        lastError = new GroqError('UNREACHABLE');
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError;
  } catch (error) {
    const reason = error instanceof GroqError ? error.reason : 'UNAVAILABLE';
    /*
      Réponse en JSON trop longue pour le modèle à schéma : un second essai sur le modèle texte,
      quand on lui en a donné un autre (GROQ_MODEL) — par défaut, c'est le même.
    */
    if ((reason === 'TOO_LARGE' || reason === 'TRUNCATED') && input.jsonSchema && !input.model && !input.images?.length && env.GROQ_MODEL !== env.GROQ_JSON_MODEL) {
      return askGroq({ ...input, model: env.GROQ_MODEL });
    }
    if (reason !== 'NOT_CONFIGURED') {
      lastOutcome = { ok: false, code: reason, at: new Date().toISOString() };
      console.warn(`[groq] demande sans réponse utilisable (${reason})`);
    }
    throw error instanceof GroqError ? error : new GroqError(reason);
  }
}

/**
 * Transcription d'une vidéo ou d'un audio par Whisper, chez Groq (« Depuis une vidéo » du Studio).
 *
 * Gemini regardait la vidéo lui-même ; son projet est bloqué depuis le 25/10/2026. Whisper ne lit
 * que le son — c'est ce que dit le créateur qui fait le produit. Formats acceptés (documentation
 * Groq) : flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm ; 25 Mo au plus en offre gratuite.
 */
export async function transcribeWithGroq(input: { data: Buffer; mimeType: string; fileName: string; timeoutMs: number }): Promise<string> {
  if (!env.GROQ_API_KEY) throw new GroqError('NOT_CONFIGURED');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(input.data)], { type: input.mimeType }), input.fileName || 'video.mp4');
  form.append('model', env.GROQ_TRANSCRIPTION_MODEL);
  form.append('response_format', 'text');
  let response: Response;
  try {
    response = await fetch(`${env.GROQ_API_URL.replace(/\/+$/, '')}/openai/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    throw new GroqError(error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE');
  }
  if (!response.ok) {
    console.warn(`[groq] transcription refusée (${response.status}) :`, (await response.text().catch(() => '')).slice(0, 200));
    throw new GroqError(reasonOfStatus(response.status));
  }
  const text = (await response.text()).trim();
  if (!text) throw new GroqError('EMPTY');
  return text;
}
