import { AppError, providerUnavailable } from '@server/middleware';
import { type GeminiMedia, type GeminiService, generateJson as generateJsonGemini } from '@server/services/ai/gemini';
import { askGroq, groqConfigured } from '@server/services/ai/groq';
import { providers } from '@server/env';

/**
 * Façade texte : Groq pour les consignes courtes et lots de traduction, Gemini pour le long
 * et tout ce qui joint un média. L'analyse de niche reste hors de cette façade (Perplexity).
 *
 * Seuil ~8k jetons (≈ 32 000 caractères) : au-delà, Groq n'est pas essayé.
 */

/** Caractères au-delà desquels on envoie directement à Gemini (~8k jetons). */
const GROQ_CHAR_LIMIT = 32_000;

export type TextService = GeminiService;

/** Convertit un schéma style Gemini (OBJECT, STRING…) en JSON Schema pour Groq. */
export function toJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const typeMap: Record<string, string> = {
    OBJECT: 'object',
    STRING: 'string',
    NUMBER: 'number',
    INTEGER: 'integer',
    BOOLEAN: 'boolean',
    ARRAY: 'array',
  };
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(obj)) {
      if (key === 'type' && typeof raw === 'string') {
        out.type = typeMap[raw] ?? raw.toLowerCase();
      } else if (key === 'properties' && raw && typeof raw === 'object') {
        out.properties = Object.fromEntries(
          Object.entries(raw as Record<string, unknown>).map(([name, prop]) => [name, walk(prop)]),
        );
      } else if (key === 'items') {
        out.items = walk(raw);
      } else {
        out[key] = walk(raw);
      }
    }
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

function preferGroq(prompt: string, media?: GeminiMedia): boolean {
  if (media) return false;
  if (!groqConfigured()) return false;
  return prompt.length <= GROQ_CHAR_LIMIT;
}

/**
 * JSON structuré. Groq d'abord si le prompt est court ; Gemini sinon, ou en secours.
 */
export async function generateJson<T>(input: {
  service: TextService;
  prompt: string;
  media?: GeminiMedia;
  responseSchema: Record<string, unknown>;
  parse: (value: unknown) => T;
  timeoutMs: number;
  onModel?: (model: string) => void;
  speed?: 'fast';
  attemptTimeoutMs?: number;
  /** Forcer Gemini (analyses longues, ebooks) même sous le seuil. */
  prefer?: 'gemini' | 'auto';
}): Promise<T> {
  if (!providers.gemini && !groqConfigured()) throw providerUnavailable('rédaction automatique');

  const tryGroq = input.prefer !== 'gemini' && preferGroq(input.prompt, input.media);

  if (tryGroq) {
    try {
      const text = await askGroq({
        system: `You are a precise assistant for Smart Creator. Answer with JSON only, matching the required schema. No markdown fences.`,
        prompt: input.prompt,
        maxTokens: 8_000,
        timeoutMs: Math.min(input.timeoutMs, input.attemptTimeoutMs ?? input.timeoutMs),
        retries: 0,
        jsonSchema: toJsonSchema(input.responseSchema),
      });
      const value = input.parse(JSON.parse(text));
      input.onModel?.('groq');
      return value;
    } catch (error) {
      // Sans Gemini, le refus Groq remonte tel quel.
      if (!providers.gemini) {
        if (error instanceof AppError) throw error;
        throw new AppError(502, `Le ${input.service.name} n’a pas pu aboutir. Vos points ont été rendus.`, `${input.service.code}_FAILED`);
      }
      console.warn(`[${input.service.log}] Groq indisponible, repli sur Gemini`);
    }
  }

  if (!providers.gemini) throw providerUnavailable('rédaction automatique');
  return generateJsonGemini(input);
}

/**
 * Texte libre court (consignes FLUX, etc.). Groq d'abord, Gemini en secours via JSON enveloppe.
 */
export async function generateText(input: {
  service: TextService;
  system: string;
  prompt: string;
  timeoutMs: number;
  maxTokens?: number;
}): Promise<string> {
  if (groqConfigured() && input.prompt.length + input.system.length <= GROQ_CHAR_LIMIT) {
    try {
      return await askGroq({
        system: input.system,
        prompt: input.prompt,
        maxTokens: input.maxTokens ?? 2_000,
        timeoutMs: input.timeoutMs,
        retries: 1,
      });
    } catch {
      if (!providers.gemini) throw providerUnavailable(input.service.name);
      console.warn(`[${input.service.log}] Groq indisponible pour texte libre, repli sur Gemini`);
    }
  }
  if (!providers.gemini) throw providerUnavailable(input.service.name);
  const wrapped = await generateJsonGemini({
    service: input.service,
    prompt: `${input.system}\n\n${input.prompt}\n\nRespond with JSON: { "text": "..." }`,
    responseSchema: {
      type: 'OBJECT',
      properties: { text: { type: 'STRING' } },
      required: ['text'],
    },
    parse: (value) => {
      const text = (value as { text?: string })?.text;
      if (typeof text !== 'string' || !text.trim()) throw new Error('empty');
      return text.trim();
    },
    timeoutMs: input.timeoutMs,
  });
  return wrapped;
}
