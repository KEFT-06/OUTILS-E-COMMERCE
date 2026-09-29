import { env } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';

/**
 * Rédaction par l'Agent API de Perplexity (POST /v1/agent), commune à la fiche d'analyse
 * (réponse JSON structurée) et au rapport rédigé (texte libre).
 *
 * L'analyse de marché est entièrement confiée à Perplexity — recherche approfondie, réflexion
 * et rédaction — et plus à Google : décision du propriétaire du 28/09/2026. La recherche
 * approfondie vit dans services/analysis/research.ts ; ce module ne fait que rédiger, à partir
 * de ce que la recherche a établi.
 *
 * Mêmes garanties que la rédaction par Gemini : refus passagers (429, 5xx, coupure) réessayés
 * dans le délai imparti, réponse illisible redemandée une fois, et messages sans nom de
 * fournisseur (marque blanche).
 */

export interface PerplexityService {
  /** Nom lu par l'utilisateur : « service d’analyse »… */
  name: string;
  /** Préfixe des codes d'erreur : ANALYSIS, REPORT… */
  code: string;
  /** Étiquette des journaux du serveur. */
  log: string;
}

const RETRY_WAITS_MS = [0, 1_000, 2_000, 3_000];
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MIN_ATTEMPT_MS = 8_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Modèle ou préréglage choisi par la configuration (PERPLEXITY_WRITER). */
function writerChoice(): { preset: string } | { model: string } {
  const choice = env.PERPLEXITY_WRITER;
  return choice.startsWith('preset:') ? { preset: choice.slice('preset:'.length) } : { model: choice };
}

/** Convertit un schéma au format de Gemini (types en majuscules) en schéma JSON standard. */
export function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'type' && typeof value === 'string') out.type = value.toLowerCase();
    else if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, sub]) => [name, toJsonSchema(sub)]));
    } else out[key] = toJsonSchema(value);
  }
  return out;
}

interface AgentPayload {
  status?: string;
  model?: string | null;
  output?: { type?: string; content?: { type?: string; text?: string | null }[] | null }[] | null;
  error?: { message?: string | null } | null;
}

/** Texte des messages rendus par l'agent, sans les résultats de recherche ni les appels d'outils. */
function messageText(payload: AgentPayload | null): string {
  return (payload?.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}

/** Un bloc ```json … ``` éventuel autour du JSON est retiré avant lecture. */
const unfence = (text: string) => text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

async function callAgent(input: {
  service: PerplexityService;
  prompt: string;
  instructions?: string;
  responseSchema?: unknown;
  maxOutputTokens?: number;
  timeoutMs: number;
  /** Rendu attendu : lève une erreur si la réponse ne convient pas (elle sera redemandée une fois). */
  accept: (text: string) => void;
}): Promise<{ text: string; model: string | null }> {
  if (!env.PERPLEXITY_API_KEY) throw providerUnavailable('analyse de marché');
  const { service } = input;
  const body = JSON.stringify({
    ...writerChoice(),
    input: input.prompt,
    ...(input.instructions ? { instructions: input.instructions } : {}),
    ...(input.maxOutputTokens ? { max_output_tokens: input.maxOutputTokens } : {}),
    ...(input.responseSchema
      ? { response_format: { type: 'json_schema', json_schema: { name: 'reponse', schema: toJsonSchema(input.responseSchema) } } }
      : {}),
  });
  const deadline = Date.now() + input.timeoutMs;
  let lastStatus: number | null = null;
  let unreadable = 0;

  for (let attempt = 0; attempt < RETRY_WAITS_MS.length + unreadable; attempt += 1) {
    const wait = RETRY_WAITS_MS[Math.min(attempt, RETRY_WAITS_MS.length - 1)]!;
    if (attempt > 0 && deadline - Date.now() - wait < MIN_ATTEMPT_MS) break;
    await sleep(wait);

    let response: Response;
    try {
      response = await fetch(`${env.PERPLEXITY_API_URL.replace(/\/+$/, '')}/v1/agent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
    } catch {
      if (deadline - Date.now() < MIN_ATTEMPT_MS) {
        throw new AppError(504, `Le ${service.name} n’a pas répondu à temps. Réessayez : vos points ont été rendus.`, `${service.code}_TIMEOUT`);
      }
      lastStatus = 503;
      console.warn(`[${service.log}] connexion interrompue, tentative ${attempt + 1}`);
      continue;
    }

    const payload = (await response.json().catch(() => null)) as AgentPayload | null;
    if (response.ok && payload?.status === 'completed') {
      const text = messageText(payload);
      try {
        input.accept(text);
        return { text, model: payload.model ?? null };
      } catch {
        if (unreadable > 0) {
          lastStatus = 200;
          break;
        }
        unreadable = 1;
        lastStatus = 200;
        console.warn(`[${service.log}] réponse illisible, nouvel essai`);
        continue;
      }
    }

    const detail = JSON.stringify(payload?.error ?? payload ?? '').slice(0, 300);
    if (response.status === 401 || response.status === 403 || response.status === 402) {
      console.error(`[${service.log}] accès refusé`, response.status, detail);
      if (response.status === 402 || /credit|balance|billing|insufficient/i.test(detail)) {
        throw new AppError(503, `Le ${service.name} est momentanément indisponible : l’administrateur en a été informé. Vos points ont été rendus.`, `${service.code}_INSUFFICIENT_CREDITS`);
      }
      throw new AppError(503, `Le ${service.name} est momentanément indisponible : l’administrateur en a été informé. Vos points ont été rendus.`, `${service.code}_ACCESS_DENIED`);
    }
    if (response.ok || RETRYABLE.has(response.status)) {
      // Réponse terminée en échec, ou refus passager : un nouvel essai a sa chance.
      lastStatus = response.ok ? 503 : response.status;
      console.warn(`[${service.log}] refus passager ${response.status}, tentative ${attempt + 1} :`, detail);
      continue;
    }
    console.error(`[${service.log}] demande refusée`, response.status, detail);
    throw new AppError(502, `Le ${service.name} a refusé la demande. Réessayez : vos points ont été rendus.`, `${service.code}_FAILED`);
  }

  if (lastStatus === 200) {
    throw new AppError(502, `Réponse illisible du ${service.name}. Réessayez : vos points ont été rendus.`, `${service.code}_UNREADABLE`);
  }
  if (lastStatus === 429) {
    throw new AppError(429, `Le ${service.name} n’a pas pu aboutir. Vos points ont été rendus.`, `${service.code}_RATE_LIMITED`);
  }
  // Une erreur interne qui résiste à tous les essais tient à la demande elle-même : attendre n'y changera rien.
  if (lastStatus === 500) {
    throw new AppError(502, `Le ${service.name} a refusé la demande. Réessayez : vos points ont été rendus.`, `${service.code}_FAILED`);
  }
  throw new AppError(
    503,
    `Le ${service.name} n’a pas pu aboutir. Vos points ont été rendus.`,
    `${service.code}_OVERLOADED`,
  );
}

/** Réponse JSON conforme au schéma, validée par `parse`. */
export async function generateJsonWithPerplexity<T>(input: {
  service: PerplexityService;
  prompt: string;
  instructions?: string;
  /** Schéma au format de Gemini ou JSON standard : il est converti. */
  responseSchema: Record<string, unknown>;
  parse: (value: unknown) => T;
  timeoutMs: number;
  onModel?: (model: string) => void;
}): Promise<T> {
  let value: T | undefined;
  const { model } = await callAgent({
    ...input,
    accept: (text) => {
      value = input.parse(JSON.parse(unfence(text)));
    },
  });
  if (model) input.onModel?.(model);
  return value as T;
}

/** Texte libre (Markdown), refusé s'il est plus court que `minChars`. */
export async function generateTextWithPerplexity(input: {
  service: PerplexityService;
  prompt: string;
  instructions?: string;
  maxOutputTokens?: number;
  minChars: number;
  timeoutMs: number;
}): Promise<{ text: string; model: string | null }> {
  return callAgent({
    ...input,
    accept: (text) => {
      if (text.length < input.minChars) throw new Error('texte trop court');
    },
  });
}
