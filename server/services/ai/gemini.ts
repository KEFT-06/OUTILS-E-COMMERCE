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

/** Média joint à la consigne : fichier encodé, ou vidéo publique désignée par son adresse (YouTube). */
export type GeminiMedia = { inlineData: { mimeType: string; data: string } } | { fileData: { fileUri: string } };

interface GeminiPayload {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
}

/**
 * Tentatives quand Google répond 503 (« This model is currently experiencing high demand ») :
 * le modèle principal deux fois, puis le modèle de secours deux fois. Google ne facture pas une
 * réponse 503, et la demande n'a rien produit : la répéter ne coûte rien de plus.
 */
const OVERLOAD_PLAN = [
  { fallback: false, waitMs: 0 },
  { fallback: false, waitMs: 2_000 },
  { fallback: true, waitMs: 0 },
  { fallback: true, waitMs: 4_000 },
] as const;

/** En deçà, une nouvelle tentative n'aurait pas le temps d'aboutir. */
const MIN_ATTEMPT_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Message d'erreur du fournisseur, pour le journal du serveur : il ne contient jamais la clé. */
async function providerMessage(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: { status?: string; message?: string } } | null;
  return [payload?.error?.status, payload?.error?.message].filter(Boolean).join(' — ').slice(0, 300);
}

export async function generateJson<T>(input: {
  service: GeminiService;
  prompt: string;
  /** Vidéo ou audio à lire avant la consigne. */
  media?: GeminiMedia;
  /** Schéma de réponse au format OpenAPI de Gemini. */
  responseSchema: Record<string, unknown>;
  /** Valide la réponse ; une exception la rend « illisible ». */
  parse: (value: unknown) => T;
  timeoutMs: number;
  /** Modèle qui a produit la réponse : le principal, ou le modèle de secours. */
  onModel?: (model: string) => void;
}): Promise<T> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw providerUnavailable('Gemini');
  const { service } = input;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [...(input.media ? [input.media] : []), { text: input.prompt }] }],
    // Température laissée par défaut : les modèles Gemini 3 se dégradent quand on la baisse.
    generationConfig: { responseMimeType: 'application/json', responseSchema: input.responseSchema },
  });
  const fallbackModel = env.GEMINI_FALLBACK_MODEL && env.GEMINI_FALLBACK_MODEL !== env.GEMINI_MODEL ? env.GEMINI_FALLBACK_MODEL : null;
  const attempts = OVERLOAD_PLAN.filter((attempt) => !attempt.fallback || fallbackModel);
  const deadline = Date.now() + input.timeoutMs;

  let response: Response | null = null;
  let model = env.GEMINI_MODEL;
  for (const [index, attempt] of attempts.entries()) {
    if (index > 0 && deadline - Date.now() - attempt.waitMs < MIN_ATTEMPT_MS) break;
    await sleep(attempt.waitMs);
    model = attempt.fallback && fallbackModel ? fallbackModel : env.GEMINI_MODEL;
    const url = `${env.GEMINI_API_URL.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
    } catch {
      throw new AppError(504, `Le ${service.name} n’a pas répondu à temps. Réessayez : vos points ont été rendus.`, `${service.code}_TIMEOUT`);
    }
    if (response.status !== 503) break;
    console.warn(`[${service.log}] ${model} saturé chez Google, tentative ${index + 1}/${attempts.length} :`, await providerMessage(response));
  }

  if (!response?.ok) {
    const status = response?.status ?? 503;
    // Le message d'une réponse 503 est déjà au journal, tentative par tentative.
    if (status !== 503) console.error(`[${service.log}] le fournisseur a répondu`, status, response ? await providerMessage(response) : '');
    if (status === 401 || status === 403) {
      throw new AppError(503, `L’accès au ${service.name} est refusé : clé API invalide sur le serveur.`, `${service.code}_ACCESS_DENIED`);
    }
    if (status === 429) {
      throw new AppError(429, `Le ${service.name} est saturé. Réessayez dans une minute : vos points ont été rendus.`, `${service.code}_RATE_LIMITED`);
    }
    if (status === 503) {
      throw new AppError(
        503,
        `Le ${service.name} est surchargé chez Google en ce moment. Réessayez dans quelques minutes : vos points ont été rendus.`,
        `${service.code}_OVERLOADED`,
      );
    }
    throw new AppError(502, `Le ${service.name} a refusé la demande. Réessayez : vos points ont été rendus.`, `${service.code}_FAILED`);
  }

  const payload = (await response.json().catch(() => null)) as GeminiPayload | null;
  const text =
    payload?.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text ?? '')
      .join('') ?? '';
  let value: T;
  try {
    value = input.parse(JSON.parse(text));
  } catch {
    throw new AppError(502, `Réponse illisible du ${service.name}. Réessayez : vos points ont été rendus.`, `${service.code}_UNREADABLE`);
  }
  input.onModel?.(model);
  return value;
}
