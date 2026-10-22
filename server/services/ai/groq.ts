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
  | 'EMPTY';

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
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400 || status === 404) return 'BAD_REQUEST';
  return 'UNAVAILABLE';
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

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
    const model =
      input.model ??
      (hasImages ? env.GROQ_VISION_MODEL : env.GROQ_MODEL) ??
      env.GROQ_MODEL;

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
      max_tokens: input.maxTokens,
      temperature: 0.4,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: userContent },
      ],
    };

    if (input.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'response', strict: true, schema: input.jsonSchema },
      };
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
          // Auth / bad request : pas la peine de réessayer.
          if (reason === 'AUTH' || reason === 'BAD_REQUEST') throw lastError;
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
          if (error.reason === 'AUTH' || error.reason === 'BAD_REQUEST' || error.reason === 'REFUSED' || error.reason === 'TRUNCATED' || error.reason === 'EMPTY') {
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
    if (reason !== 'NOT_CONFIGURED') {
      lastOutcome = { ok: false, code: reason, at: new Date().toISOString() };
      console.warn(`[direction artistique] demande sans réponse utilisable (${reason})`);
    }
    throw error instanceof GroqError ? error : new GroqError(reason);
  }
}
