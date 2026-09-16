import { z } from 'zod';
import { env } from '@server/env';
import { AppError, providerUnavailable } from '@server/middleware';

/**
 * Client de l'API publique Higgsfield — feuille de route 4.1 et 4.2.
 *
 * Écrit d'après la spécification OpenAPI et la documentation publiques (docs.higgsfield.ai),
 * puis vérifié contre l'API réelle le 16 septembre 2026 : authentification, adresses des
 * modèles, corps des demandes et réponse « not_enough_credits » d'un compte sans crédits.
 * La spécification publiée n'est pas toujours à jour (résolution des images : voir
 * VISUAL_RESOLUTION dans server/services/creatives).
 *
 * Règles de la documentation appliquées ici :
 *  - Une soumission n'accepte pas de clé d'idempotence. Un POST n'est donc jamais
 *    rejoué automatiquement : après un délai ambigu, la génération a peut-être
 *    démarré, et la relancer la ferait payer deux fois.
 *  - Les générations « failed » et « nsfw » ne sont pas facturées par Higgsfield.
 *  - Les fichiers produits ne sont conservés qu'environ sept jours.
 */

const SUBMIT_TIMEOUT_MS = 30_000;
const MEDIA_TIMEOUT_MS = 120_000;

const mediaSchema = z.object({ url: z.string().url() });

/** Champs non déclarés écartés par zod : seuls ceux-ci circulent dans l'application. */
const requestStatusSchema = z.object({
  request_id: z.string().min(1),
  status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled']),
  error: z.string().nullable().optional(),
  images: z.array(mediaSchema).optional(),
  video: mediaSchema.optional(),
});

export type HiggsfieldStatus = z.infer<typeof requestStatusSchema>;

/** Les identifiants de requête Higgsfield sont des UUID : tout autre format est refusé. */
export const requestIdSchema = z.string().uuid('Identifiant de génération invalide.');

function authorization(): string {
  const keyId = env.HIGGSFIELD_API_KEY_ID;
  const keySecret = env.HIGGSFIELD_API_KEY_SECRET;
  if (!keyId || !keySecret) throw providerUnavailable('Higgsfield');
  return `Key ${keyId}:${keySecret}`;
}

/** Les erreurs portent `detail`, chaîne ou liste pour les erreurs de validation. */
function detailMessage(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const detail = (payload as { detail?: unknown }).detail;

  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) =>
        typeof item === 'object' && item !== null && 'msg' in item
          ? String((item as { msg: unknown }).msg)
          : String(item),
      )
      .join(' ; ');
  }
  return undefined;
}

/**
 * Traduit une erreur Higgsfield. Identifiants refusés et crédits épuisés
 * deviennent des 503 : ce sont des problèmes de configuration du serveur, pas
 * des erreurs de l'utilisateur.
 */
function higgsfieldFailure(status: number, detail: string | undefined): AppError {
  console.error('[higgsfield] le fournisseur a répondu', status, detail?.slice(0, 300) ?? '');
  if (status === 401) {
    return new AppError(
      503,
      "L'accès à Higgsfield est refusé : identifiants API invalides sur le serveur.",
      'HIGGSFIELD_ACCESS_DENIED',
    );
  }
  if (status === 403 && (!detail || /credit/i.test(detail))) {
    return new AppError(
      503,
      "Le compte Higgsfield du serveur n'a plus assez de crédits. Aucun point ne vous est retiré.",
      'HIGGSFIELD_INSUFFICIENT_CREDITS',
    );
  }
  if (status === 403) {
    return new AppError(503, `Higgsfield refuse cette demande au compte du serveur : ${detail}`, 'HIGGSFIELD_FORBIDDEN');
  }
  if (status === 404) {
    return new AppError(404, 'Génération ou modèle introuvable chez Higgsfield.', 'HIGGSFIELD_NOT_FOUND');
  }
  if (status === 400 && detail && /concurrent/i.test(detail)) {
    return new AppError(
      429,
      'Trop de générations sont déjà en cours sur le compte du serveur. Réessayez dans quelques instants.',
      'HIGGSFIELD_CONCURRENCY_LIMIT',
    );
  }
  if (status === 400 || status === 422) {
    return new AppError(
      502,
      `Higgsfield a refusé la demande${detail ? ` : ${detail}` : '.'}`,
      'HIGGSFIELD_REJECTED_REQUEST',
    );
  }
  if (status === 423 || status === 503) {
    return new AppError(
      503,
      'Le modèle Higgsfield est temporairement indisponible. Réessayez plus tard.',
      'HIGGSFIELD_MODEL_UNAVAILABLE',
    );
  }
  return new AppError(502, 'Higgsfield est momentanément indisponible.', 'HIGGSFIELD_UNAVAILABLE');
}

async function call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
  const headers = {
    Authorization: authorization(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  let response: Response;
  try {
    response = await fetch(`${env.HIGGSFIELD_API_URL}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch {
    throw method === 'POST'
      ? new AppError(
          504,
          "Higgsfield n'a pas répondu à temps. La génération a peut-être démarré : ne la relancez pas immédiatement.",
          'HIGGSFIELD_SUBMISSION_UNCERTAIN',
        )
      : new AppError(502, 'Higgsfield est injoignable.', 'HIGGSFIELD_UNREACHABLE');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw higgsfieldFailure(response.status, detailMessage(payload));
  }

  return response.json();
}

function parseStatus(payload: unknown): HiggsfieldStatus {
  const parsed = requestStatusSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError(502, 'Réponse inattendue de Higgsfield.', 'HIGGSFIELD_UNEXPECTED_RESPONSE');
  }
  return parsed.data;
}

/** Soumet une génération au modèle `modelPath` (ex. `/kling-video/v2.1/master/text-to-video`). */
export async function submitGeneration(
  modelPath: string,
  input: Record<string, unknown>,
): Promise<HiggsfieldStatus> {
  return parseStatus(await call(modelPath, 'POST', input));
}

export async function getGenerationStatus(requestId: string): Promise<HiggsfieldStatus> {
  return parseStatus(await call(`/requests/${encodeURIComponent(requestId)}/status`, 'GET'));
}

/** Récupère un fichier produit, pour le relayer au navigateur. */
export async function fetchMedia(url: string): Promise<Response> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new AppError(502, 'Lien de fichier invalide renvoyé par Higgsfield.', 'HIGGSFIELD_UNEXPECTED_RESPONSE');
  }
  if (target.protocol !== 'https:') {
    throw new AppError(502, 'Lien de fichier non sécurisé renvoyé par Higgsfield.', 'HIGGSFIELD_UNEXPECTED_RESPONSE');
  }

  let response: Response;
  try {
    response = await fetch(target, { signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) });
  } catch {
    throw new AppError(502, 'Le fichier généré est injoignable.', 'CREATIVE_FILE_UNREACHABLE');
  }

  if (!response.ok || !response.body) {
    throw [403, 404, 410].includes(response.status)
      ? new AppError(
          410,
          "Le fichier n'est plus disponible chez le fournisseur, qui ne le conserve qu'environ sept jours.",
          'CREATIVE_FILE_EXPIRED',
        )
      : new AppError(502, 'Le fichier généré est injoignable.', 'CREATIVE_FILE_UNREACHABLE');
  }

  return response;
}
