import Anthropic from '@anthropic-ai/sdk';
import { env } from '@server/env';

/**
 * Claude (Anthropic) : le directeur artistique du site.
 *
 * Il ne produit ni image ni vidéo. Il ÉCRIT ce que le moteur d'images reçoit : il lit la fiche
 * d'un ouvrage — à qui il s'adresse, ce qu'il promet, ses chapitres — et en tire la maquette de
 * sa couverture, ou la scène à peindre. Un moteur d'images rend ce qu'on lui décrit ; la différence entre une couverture
 * quelconque et une couverture qui parle de CE livre tient à cette description.
 *
 * SON ABSENCE N'EST JAMAIS UNE PANNE. Clé absente, service muet, réponse coupée ou refusée :
 * l'appelant reçoit une `ClaudeError`, compose sa consigne sans lui, et l'auteur a son image.
 * Rien de ce qui passe ici n'est donc facturé à part, ni annoncé à l'écran.
 */

/** Motif d'un échec, pour la page « État des services ». Ne sort jamais vers un client. */
export type ClaudeFailure = 'NOT_CONFIGURED' | 'AUTH' | 'RATE_LIMITED' | 'TIMEOUT' | 'UNREACHABLE' | 'BAD_REQUEST' | 'UNAVAILABLE' | 'REFUSED' | 'TRUNCATED' | 'EMPTY';

export class ClaudeError extends Error {
  constructor(readonly reason: ClaudeFailure) {
    super(`Direction artistique indisponible (${reason}).`);
    this.name = 'ClaudeError';
  }
}

let lastOutcome: { ok: boolean; code: ClaudeFailure | null; at: string } | null = null;

/** Dernier résultat, pour la page « État des services ». */
export function lastClaudeOutcome() {
  return lastOutcome;
}

export function claudeConfigured(): boolean {
  return Boolean(env.CLAUDE_API_KEY);
}

function reasonOf(error: unknown): ClaudeFailure {
  if (error instanceof ClaudeError) return error.reason;
  // Du plus précis au plus large : toutes ces classes héritent d'APIError.
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return 'AUTH';
  if (error instanceof Anthropic.RateLimitError) return 'RATE_LIMITED';
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'TIMEOUT';
  if (error instanceof Anthropic.APIConnectionError) return 'UNREACHABLE';
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) return 'BAD_REQUEST';
  return 'UNAVAILABLE';
}

/**
 * Une demande, une réponse en texte.
 *
 * `maxTokens` couvre la réflexion du modèle ET sa réponse : le fixer large. La longueur du texte
 * rendu se règle dans la consigne, pas ici — une réponse coupée par ce plafond est inutilisable,
 * et elle est rejetée (`TRUNCATED`) plutôt que servie à moitié.
 */
export async function askClaude(input: {
  system: string;
  prompt: string;
  maxTokens: number;
  /** Délai d'un essai. Il y en a deux au plus : compter le double avant de se passer de lui. */
  timeoutMs: number;
  /** Essais supplémentaires après un premier échec passager. 1 par défaut ; 0 quand le temps est compté. */
  retries?: number;
  /** Profondeur de réflexion. « low » : une consigne courte n'en demande pas davantage. */
  effort?: 'low' | 'medium' | 'high';
  /** Forme imposée à la réponse : elle arrive alors en JSON, conforme à ce schéma. */
  jsonSchema?: Record<string, unknown>;
  /** Images à regarder avant de répondre (relecture d'une couverture rendue). */
  images?: { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: Buffer }[];
}): Promise<string> {
  try {
    if (!env.CLAUDE_API_KEY) throw new ClaudeError('NOT_CONFIGURED');
    const client = new Anthropic({ apiKey: env.CLAUDE_API_KEY, baseURL: env.CLAUDE_API_URL, maxRetries: input.retries ?? 1, timeout: input.timeoutMs });
    const response = await client.messages.create({
      model: env.CLAUDE_MODEL,
      max_tokens: input.maxTokens,
      system: input.system,
      output_config: { effort: input.effort ?? 'low', ...(input.jsonSchema ? { format: { type: 'json_schema' as const, schema: input.jsonSchema } } : {}) },
      messages: [
        {
          role: 'user',
          content: input.images?.length
            ? [
                ...input.images.map((image) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mimeType, data: image.bytes.toString('base64') } })),
                { type: 'text' as const, text: input.prompt },
              ]
            : input.prompt,
        },
      ],
    });
    if (response.stop_reason === 'refusal') throw new ClaudeError('REFUSED');
    if (response.stop_reason === 'max_tokens') throw new ClaudeError('TRUNCATED');
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!text) throw new ClaudeError('EMPTY');
    lastOutcome = { ok: true, code: null, at: new Date().toISOString() };
    return text;
  } catch (error) {
    const reason = reasonOf(error);
    // Une clé absente n'est pas un incident : rien à noter, rien à journaliser.
    if (reason !== 'NOT_CONFIGURED') {
      lastOutcome = { ok: false, code: reason, at: new Date().toISOString() };
      console.warn(`[direction artistique] demande sans réponse utilisable (${reason})${error instanceof Anthropic.APIError && error.status ? ` — HTTP ${error.status}` : ''}`);
    }
    throw error instanceof ClaudeError ? error : new ClaudeError(reason);
  }
}
