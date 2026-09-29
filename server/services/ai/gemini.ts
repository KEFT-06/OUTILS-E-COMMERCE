import { env } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';
import { type GoogleRefusal, classifyGoogle429, recordGoogleRefusal } from '@server/services/ai/googleRefusal';

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
 * Tentatives quand Google refuse pour une raison passagère : le modèle principal deux fois,
 * puis le modèle de secours deux fois. Google ne facture pas une réponse en erreur, et la
 * demande n'a rien produit : la répéter ne coûte rien de plus.
 *
 * Seul le 503 (« This model is currently experiencing high demand ») était réessayé. Or un
 * ouvrage long enchaîne des dizaines d'appels, trois à la fois : un seul 429 (débit par
 * minute dépassé), un seul 500 interne ou une connexion coupée faisait échouer toute la
 * rédaction, alors que la même demande passait quelques secondes plus tard.
 *
 * Puis le modèle de dernier recours, deux fois : le principal et le secours sont des versions
 * récentes aux limites par minute serrées, et un ebook de seize sections les dépassait tous les
 * deux — l'utilisateur voyait « service saturé » (29/09/2026). Le dernier recours est d'une
 * génération stable, servie par une autre flotte et aux limites bien plus larges.
 */
type ModelTier = 'primary' | 'fallback' | 'lastResort';
const RETRY_PLAN: readonly { tier: ModelTier; waitMs: number }[] = [
  { tier: 'primary', waitMs: 0 },
  { tier: 'primary', waitMs: 2_000 },
  { tier: 'fallback', waitMs: 0 },
  { tier: 'fallback', waitMs: 4_000 },
  { tier: 'lastResort', waitMs: 0 },
  { tier: 'lastResort', waitMs: 3_000 },
];

/** Refus passagers : débit dépassé, panne interne, surcharge, passerelle expirée. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Attente demandée par Google (RetryInfo) prise en compte, dans cette limite. */
const MAX_PROVIDER_WAIT_MS = 20_000;

/** En deçà, une nouvelle tentative n'aurait pas le temps d'aboutir. */
const MIN_ATTEMPT_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ProviderError {
  /** Pour le journal du serveur : ne contient jamais la clé. */
  message: string;
  /** Délai avant nouvel essai indiqué par Google, en millisecondes. */
  retryDelayMs: number | null;
  /** Nature d'un refus 429 : débit, quota du jour, ou projet sans crédit. */
  refusal: GoogleRefusal | null;
}

/** Erreur du fournisseur : message et délai de nouvel essai (en-tête Retry-After ou RetryInfo). */
async function readProviderError(response: Response): Promise<ProviderError> {
  const payload = (await response.json().catch(() => null)) as {
    error?: { status?: string; message?: string; details?: { '@type'?: string; retryDelay?: string }[] };
  } | null;
  const header = Number(response.headers.get('retry-after'));
  const info = payload?.error?.details?.find((detail) => detail['@type']?.endsWith('RetryInfo'))?.retryDelay;
  const seconds = Number.isFinite(header) && header > 0 ? header : info ? Number.parseFloat(info) : NaN;
  return {
    message: [payload?.error?.status, payload?.error?.message].filter(Boolean).join(' — ').slice(0, 300),
    retryDelayMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
    refusal: response.status === 429 ? classifyGoogle429(payload) : null,
  };
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
  if (!apiKey) throw providerUnavailable('rédaction par IA');
  const { service } = input;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [...(input.media ? [input.media] : []), { text: input.prompt }] }],
    // Température laissée par défaut : les modèles Gemini 3 se dégradent quand on la baisse.
    generationConfig: { responseMimeType: 'application/json', responseSchema: input.responseSchema },
  });
  const fallbackModel = env.GEMINI_FALLBACK_MODEL && env.GEMINI_FALLBACK_MODEL !== env.GEMINI_MODEL ? env.GEMINI_FALLBACK_MODEL : null;
  const lastResortModel =
    env.GEMINI_LAST_RESORT_MODEL && env.GEMINI_LAST_RESORT_MODEL !== env.GEMINI_MODEL && env.GEMINI_LAST_RESORT_MODEL !== fallbackModel
      ? env.GEMINI_LAST_RESORT_MODEL
      : null;
  const modelFor: Record<ModelTier, string | null> = { primary: env.GEMINI_MODEL, fallback: fallbackModel, lastResort: lastResortModel };
  const attempts = RETRY_PLAN.filter((attempt) => modelFor[attempt.tier]);
  const deadline = Date.now() + input.timeoutMs;

  /** Dernier refus passager, pour le message final si toutes les tentatives échouent. */
  let lastStatus: number | null = null;
  let networkFailure = false;
  /*
    Une réponse illisible (JSON tronqué, candidat vide) est redemandée UNE fois. Google la
    facture, contrairement à un refus ; mais elle vient le plus souvent d'une réponse coupée
    par hasard, et une deuxième demande aboutit. Au-delà, c'est la consigne qui pose problème.
  */
  let unreadable = 0;
  let providerWaitMs = 0;
  let model = env.GEMINI_MODEL;

  for (let index = 0; index < attempts.length + unreadable; index++) {
    const attempt = attempts[Math.min(index, attempts.length - 1)]!;
    const waitMs = Math.max(attempt.waitMs, providerWaitMs);
    if (index > 0 && deadline - Date.now() - waitMs < MIN_ATTEMPT_MS) break;
    await sleep(waitMs);
    providerWaitMs = 0;
    model = modelFor[attempt.tier] ?? env.GEMINI_MODEL;
    const url = `${env.GEMINI_API_URL.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
    } catch {
      // Délai épuisé : inutile d'insister. Connexion coupée en route : un nouvel essai a sa chance.
      if (deadline - Date.now() < MIN_ATTEMPT_MS) {
        throw new AppError(504, `Le ${service.name} n’a pas répondu à temps. Réessayez : vos points ont été rendus.`, `${service.code}_TIMEOUT`);
      }
      networkFailure = true;
      console.warn(`[${service.log}] connexion à Google interrompue, tentative ${index + 1}/${attempts.length}`);
      continue;
    }

    if (response.ok) {
      const payload = (await response.json().catch(() => null)) as GeminiPayload | null;
      const text =
        payload?.candidates?.[0]?.content?.parts
          ?.filter((part) => !part.thought)
          .map((part) => part.text ?? '')
          .join('') ?? '';
      try {
        const value = input.parse(JSON.parse(text));
        input.onModel?.(model);
        return value;
      } catch {
        if (unreadable > 0) break;
        unreadable = 1;
        lastStatus = 200;
        console.warn(`[${service.log}] réponse illisible de ${model}, nouvel essai`);
        continue;
      }
    }

    const failure = await readProviderError(response);
    if (!RETRYABLE_STATUS.has(response.status)) {
      console.error(`[${service.log}] le fournisseur a répondu`, response.status, failure.message);
      if (response.status === 401 || response.status === 403) {
        throw new AppError(503, `L’accès au ${service.name} est refusé : clé API invalide sur le serveur.`, `${service.code}_ACCESS_DENIED`);
      }
      throw new AppError(502, `Le ${service.name} a refusé la demande. Réessayez : vos points ont été rendus.`, `${service.code}_FAILED`);
    }
    if (failure.refusal) recordGoogleRefusal(failure.refusal, model, failure.message);
    if (failure.refusal === 'billing') {
      /*
        Projet de la clé sans crédit ni facturation : tous les modèles partagent ce projet.
        Insister faisait « patienter » un ebook vingt minutes pour rien, avec un message de
        saturation. On s'arrête, points rendus, et l'administration voit la vraie cause.
      */
      console.error(`[${service.log}] projet Google sans crédit ni facturation :`, failure.message);
      throw new AppError(503, `Le ${service.name} est momentanément indisponible : l’administrateur en a été informé. Vos points ont été rendus.`, `${service.code}_INSUFFICIENT_CREDITS`);
    }
    lastStatus = response.status;
    networkFailure = false;
    providerWaitMs = Math.min(failure.retryDelayMs ?? 0, MAX_PROVIDER_WAIT_MS);
    console.warn(`[${service.log}] ${model} refus passager ${response.status}, tentative ${index + 1}/${attempts.length} :`, failure.message);
  }

  if (lastStatus === 200) {
    throw new AppError(502, `Réponse illisible du ${service.name}. Réessayez : vos points ont été rendus.`, `${service.code}_UNREADABLE`);
  }
  if (lastStatus === 429) {
    throw new AppError(429, `Le ${service.name} n’a pas pu aboutir. Vos points ont été rendus.`, `${service.code}_RATE_LIMITED`);
  }
  if (lastStatus === 503) {
    throw new AppError(
      503,
      `Le ${service.name} n’a pas pu aboutir. Vos points ont été rendus.`,
      `${service.code}_OVERLOADED`,
    );
  }
  if (networkFailure && lastStatus === null) {
    throw new AppError(504, `Le ${service.name} n’a pas répondu à temps. Réessayez : vos points ont été rendus.`, `${service.code}_TIMEOUT`);
  }
  /*
    Une erreur interne qui résiste aux deux modèles tient le plus souvent à la demande elle-même
    (Google cite une consigne trop longue) : elle ne se réglera pas en attendant.
  */
  if (lastStatus === 500) {
    throw new AppError(502, `Le ${service.name} a refusé la demande. Réessayez : vos points ont été rendus.`, `${service.code}_FAILED`);
  }
  throw new AppError(
    503,
    `Le ${service.name} n’a pas pu aboutir. Vos points ont été rendus.`,
    `${service.code}_UNAVAILABLE`,
  );
}
