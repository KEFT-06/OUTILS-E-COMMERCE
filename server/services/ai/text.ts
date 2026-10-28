import { AppError, providerUnavailable } from '@server/middleware';
import { type GeminiMedia, type GeminiService, generateJson as generateJsonGemini } from '@server/services/ai/gemini';
import { GroqError, askGroq, groqConfigured } from '@server/services/ai/groq';
import { providers } from '@server/env';

/**
 * Façade texte : Groq d'abord, pour tout texte ; Gemini seulement pour lire une vidéo ou un audio
 * (Groq ne le sait pas), ou en dernier recours.
 *
 * Décision du propriétaire, 25/10/2026 : « si Gemini a des modèles gratuits on les utilise, sinon
 * on fait sans lui ». Vérifié le même jour avec la clé du site : TOUS les modèles Gemini actuels,
 * gratuits compris, répondent « Your project has been denied access » (403) — le projet Google est
 * bloqué —, et les anciens (2.0 et 2.5 Flash) sont fermés aux nouveaux comptes. L'analyse de niche
 * reste hors de cette façade (Perplexity).
 *
 * Une demande trop longue pour l'offre gratuite de Groq est refusée par askGroq avant de partir
 * (jetons par minute) : pas de seuil de taille ici.
 */

export type TextService = GeminiService;

/** Un rédacteur est-il branché ? Groq, ou Gemini en dernier recours. */
export const textConfigured = (): boolean => groqConfigured() || providers.gemini;

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

/**
 * Ce que lit le client quand ni Groq ni Gemini n'ont pu écrire : jamais « clé API invalide sur le
 * serveur », qui est l'affaire de l'administration.
 */
function unableToWrite(service: TextService, groqFailure: unknown): AppError {
  if (groqFailure instanceof AppError) return groqFailure;
  const reason = groqFailure instanceof GroqError ? groqFailure.reason : null;
  if (reason === 'TOO_LARGE') return new AppError(413, `Ce texte est trop long pour le ${service.name} en une seule fois : vos points ont été rendus. Raccourcissez-le, ou découpez-le.`, `${service.code}_TOO_LONG`);
  if (reason === 'RATE_LIMITED') return new AppError(429, `Le ${service.name} est très demandé en ce moment : vos points ont été rendus.`, `${service.code}_RATE_LIMITED`);
  return new AppError(502, `Le ${service.name} n’a pas pu aboutir : vos points ont été rendus.`, `${service.code}_FAILED`);
}

/** Refus de Gemini qui ne disent rien de la demande : panne, accès bloqué, crédits, quota. */
const GEMINI_OUTAGES = ['_INSUFFICIENT_CREDITS', '_RATE_LIMITED', '_UNAVAILABLE', '_TIMEOUT', '_ACCESS_DENIED'];
function isGeminiOutage(error: unknown): boolean {
  return error instanceof AppError && GEMINI_OUTAGES.some((suffix) => error.code.endsWith(suffix));
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
}): Promise<T> {
  if (!providers.gemini && !groqConfigured()) throw providerUnavailable('rédaction automatique');

  const viaGroq = async (): Promise<T> => {
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
  };

  // Groq d'abord ; Gemini seulement pour une vidéo ou un audio à lire, ou en dernier recours.
  if (!input.media && groqConfigured()) {
    try {
      return await viaGroq();
    } catch (groqFailure) {
      if (!providers.gemini) throw unableToWrite(input.service, groqFailure);
      console.warn(`[${input.service.log}] Groq sans réponse utilisable, dernier recours : Gemini`);
      try {
        return await generateJsonGemini(input);
      } catch (geminiFailure) {
        // Gemini bloqué ou en panne : c'est l'échec de Groq que le client doit comprendre.
        throw isGeminiOutage(geminiFailure) ? unableToWrite(input.service, groqFailure) : geminiFailure;
      }
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
  let groqFailure: unknown = null;
  if (groqConfigured()) {
    try {
      return await askGroq({
        system: input.system,
        prompt: input.prompt,
        maxTokens: input.maxTokens ?? 2_000,
        timeoutMs: input.timeoutMs,
        retries: 1,
      });
    } catch (error) {
      if (!providers.gemini) throw unableToWrite(input.service, error);
      groqFailure = error;
      console.warn(`[${input.service.log}] Groq sans réponse utilisable pour un texte libre, dernier recours : Gemini`);
    }
  }
  if (!providers.gemini) throw providerUnavailable(input.service.name);
  const viaGemini = generateJsonGemini({
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
  try {
    return await viaGemini;
  } catch (geminiFailure) {
    // Gemini bloqué ou en panne : c'est l'échec de Groq que le client doit comprendre.
    throw groqFailure && isGeminiOutage(geminiFailure) ? unableToWrite(input.service, groqFailure) : geminiFailure;
  }
}
