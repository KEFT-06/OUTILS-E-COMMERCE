import { z } from 'zod';
import { env } from '@server/env';
import { AppError } from '@server/middleware';

/**
 * File d'attente de fal.ai (queue.fal.run), pour les rendus vidéo.
 *
 * Trois adresses, toutes préfixées par l'identifiant du modèle :
 *   POST   /{modèle}                              → dépose la demande, rend un request_id
 *   GET    /{modèle}/requests/{id}/status         → IN_QUEUE, IN_PROGRESS, COMPLETED
 *   GET    /{modèle}/requests/{id}                → le résultat, une fois terminé
 *
 * Deux pièges vérifiés contre l'API :
 *
 *  - l'en-tête est « Authorization: Key <clé> », pas « Bearer ». Un Bearer rend un 401 nu,
 *    que l'on prendrait pour une clé invalide ;
 *  - l'identifiant du modèle fait partie du chemin, y compris pour lire un état. Un
 *    request_id seul ne suffit donc pas à suivre une génération : l'appelant doit dire de
 *    quel modèle elle vient ;
 *  - le suivi se lit sur la RACINE de l'application, pas sur le chemin complet du modèle :
 *    « google/gemini-omni-flash/requests/{id}/status » répond, « google/gemini-omni-flash/v1.1/
 *    text-to-video/requests/{id}/status » rend un 405 (mesuré le 26/10/2026, idem chez Veo 3.1).
 *    Seul le dépôt prend le chemin complet.
 *
 * Plus aucun dépôt depuis le 28/10/2026 (génération de vidéos retirée) : ne reste que le suivi des
 * vidéos d'avant, jusqu'à leur terme et le temps de leur conservation.
 */

const TIMEOUT_MS = 30_000;

/** Les états de la file, tels que l'API les nomme. */
const falStatusSchema = z.object({
  status: z.enum(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']),
  request_id: z.string().min(1),
  queue_position: z.number().int().optional(),
  /** Présent quand le rendu a échoué : l'état dit alors COMPLETED, sans fichier. */
  error: z.unknown().optional(),
});

const falResultSchema = z.object({
  video: z.object({ url: z.string().url() }).optional(),
  images: z.array(z.object({ url: z.string().url() })).optional(),
});

export type FalQueueStatus = z.infer<typeof falStatusSchema>['status'];

export interface FalGeneration {
  requestId: string;
  status: FalQueueStatus;
  /** Renseigné seulement quand le rendu est terminé. */
  mediaUrl?: string;
  mediaType?: 'video' | 'image';
  /** Rendu terminé SANS fichier : refusé par le modèle ou échoué chez fal. Rien n'est facturé par fal. */
  failed?: boolean;
}

/** Identifiant rendu par fal : alphanumérique et tirets, jamais un chemin. */
export const falRequestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, 'Identifiant de génération invalide.');

/** Racine de l'application d'un modèle : ses deux premiers segments, où se lit le suivi. */
export function falAppOf(model: string): string {
  return model.split('/').slice(0, 2).join('/');
}

export function falConfigured(): boolean {
  return Boolean(env.FAL_KEY);
}

function detailOf(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as { detail?: unknown; error?: unknown; message?: unknown };
  const brut = p.detail ?? p.error ?? p.message;
  return (typeof brut === 'string' ? brut : JSON.stringify(brut ?? '')).slice(0, 300);
}

function falFailure(status: number, detail: string): AppError {
  console.error('[fal] le fournisseur a répondu', status, detail);
  if ((status === 401 || status === 403) && !/balance|locked/i.test(detail)) {
    return new AppError(
      503,
      'Le service vidéo refuse l’accès du serveur : l’administrateur doit vérifier sa configuration.',
      'FAL_ACCESS_DENIED',
    );
  }
  // fal.ai est prépayé : sans solde, aucun rendu ne part. Un compte à sec répond 403 « User is
  // locked. Reason: Exhausted balance » (constaté le 26/10/2026), pas 402.
  if (status === 402 || /balance|locked/i.test(detail)) {
    return new AppError(
      503,
      'Le service vidéo est momentanément indisponible. Vos points ont été rendus.',
      'FAL_OUT_OF_CREDIT',
    );
  }
  if (status === 429) {
    return new AppError(429, 'Le rendu vidéo n’a pas pu être lancé. Vos points ont été rendus.', 'FAL_RATE_LIMITED');
  }
  if (status === 404) {
    return new AppError(404, 'Cette génération est introuvable : elle a peut-être expiré.', 'FAL_NOT_FOUND');
  }
  if (status === 400 || status === 422) {
    return new AppError(502, 'La demande a été refusée. Reformulez le brief : vos points ont été rendus.', 'FAL_BAD_INPUT');
  }
  if (status >= 500) {
    return new AppError(503, 'Le rendu vidéo n’a pas pu aboutir. Vos points ont été rendus.', 'FAL_UNAVAILABLE');
  }
  return new AppError(502, 'La demande n’a pas pu être traitée : vos points ont été rendus.', 'FAL_FAILED');
}

async function call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
  if (!falConfigured()) throw new AppError(503, 'Le rendu vidéo n’est pas configuré sur le serveur.', 'FAL_NOT_CONFIGURED');

  let response: Response;
  try {
    response = await fetch(`${env.FAL_API_URL.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        // « Key », pas « Bearer » : vérifié contre l'API.
        Authorization: `Key ${env.FAL_KEY}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(504, 'Le service vidéo n’a pas répondu à temps : vos points ont été rendus.', 'FAL_TIMEOUT');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw falFailure(response.status, detailOf(payload));
  return payload;
}

/**
 * État d'une génération, et son fichier quand elle est terminée. Le résultat n'est lu que
 * sur un état COMPLETED : le demander plus tôt rend un 400 qui ressemble à tort à un échec.
 */
export async function getFalGeneration(model: string, requestId: string): Promise<FalGeneration> {
  const id = falRequestIdSchema.parse(requestId);
  const app = falAppOf(model);
  const etat = falStatusSchema.safeParse(await call(`/${app}/requests/${encodeURIComponent(id)}/status`, 'GET'));
  if (!etat.success) {
    console.error('[fal] état inattendu pour', id);
    throw new AppError(502, 'Réponse inattendue du service vidéo.', 'FAL_UNEXPECTED');
  }
  if (etat.data.status !== 'COMPLETED') return { requestId: id, status: etat.data.status };
  if (etat.data.error) {
    console.error('[fal] rendu échoué', id, detailOf({ error: etat.data.error }));
    return { requestId: id, status: 'COMPLETED', failed: true };
  }

  let brut: unknown;
  try {
    brut = await call(`/${app}/requests/${encodeURIComponent(id)}`, 'GET');
  } catch (error) {
    // Un rendu terminé dont le résultat est refusé (422 : consigne rejetée, 5xx : panne du modèle)
    // a échoué : le dire, pour rendre les points, plutôt que de le sonder sans fin.
    if (error instanceof AppError && ['FAL_BAD_INPUT', 'FAL_UNAVAILABLE', 'FAL_FAILED'].includes(error.code ?? '')) {
      return { requestId: id, status: 'COMPLETED', failed: true };
    }
    throw error;
  }
  const resultat = falResultSchema.safeParse(brut);
  if (!resultat.success) {
    console.error('[fal] résultat inattendu pour', id);
    throw new AppError(502, 'Réponse inattendue du service vidéo.', 'FAL_UNEXPECTED');
  }
  const video = resultat.data.video?.url;
  const image = resultat.data.images?.[0]?.url;
  return {
    requestId: id,
    status: 'COMPLETED',
    ...(video ? { mediaUrl: video, mediaType: 'video' as const } : image ? { mediaUrl: image, mediaType: 'image' as const } : {}),
  };
}
