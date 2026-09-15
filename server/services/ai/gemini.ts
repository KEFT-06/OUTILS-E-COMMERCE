import { env } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';

/**
 * Appel à Gemini (API REST generateContent) avec une réponse JSON structurée,
 * commun à la traduction des guides, à l'analyse de niche et à la rédaction.
 *
 * La clé part en en-tête, jamais dans l'adresse ni dans un journal. Chaque erreur
 * du fournisseur devient un message clair qui rappelle que les points réservés
 * ont été rendus : la facturation rembourse tout appel qui échoue.
 */

export interface GeminiService {
  /** Nom lu par l'utilisateur : « service de traduction », « service d’analyse »… */
  name: string;
  /** Préfixe des codes d'erreur : TRANSLATION, ANALYSIS… */
  code: string;
  /** Étiquette des journaux du serveur. */
  log: string;
}

interface GeminiPayload {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
}

export async function generateJson<T>(input: {
  service: GeminiService;
  prompt: string;
  /** Schéma de réponse au format OpenAPI de Gemini. */
  responseSchema: Record<string, unknown>;
  /** Valide la réponse ; une exception la rend « illisible ». */
  parse: (value: unknown) => T;
  timeoutMs: number;
}): Promise<T> {
  if (!env.GEMINI_API_KEY) throw providerUnavailable('Gemini');
  const { service } = input;
  const url = `${env.GEMINI_API_URL.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        // Température laissée par défaut : les modèles Gemini 3 se dégradent quand on la baisse.
        generationConfig: { responseMimeType: 'application/json', responseSchema: input.responseSchema },
      }),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch {
    throw new AppError(504, `Le ${service.name} n’a pas répondu à temps. Réessayez : vos points ont été rendus.`, `${service.code}_TIMEOUT`);
  }

  if (!response.ok) {
    console.error(`[${service.log}] le fournisseur a répondu`, response.status);
    if (response.status === 401 || response.status === 403) {
      throw new AppError(503, `L’accès au ${service.name} est refusé : clé API invalide sur le serveur.`, `${service.code}_ACCESS_DENIED`);
    }
    if (response.status === 429) {
      throw new AppError(429, `Le ${service.name} est saturé. Réessayez dans une minute : vos points ont été rendus.`, `${service.code}_RATE_LIMITED`);
    }
    throw new AppError(502, `Le ${service.name} a refusé la demande. Réessayez : vos points ont été rendus.`, `${service.code}_FAILED`);
  }

  const payload = (await response.json().catch(() => null)) as GeminiPayload | null;
  const text =
    payload?.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text ?? '')
      .join('') ?? '';
  try {
    return input.parse(JSON.parse(text));
  } catch {
    throw new AppError(502, `Réponse illisible du ${service.name}. Réessayez : vos points ont été rendus.`, `${service.code}_UNREADABLE`);
  }
}
