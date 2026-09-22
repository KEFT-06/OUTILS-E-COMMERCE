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
 *    quel modèle elle vient.
 *
 * fal.ai ne facture que les rendus réussis : ni les erreurs, ni l'attente en file.
 */

const TIMEOUT_MS = 30_000;

/** Les états de la file, tels que l'API les nomme. */
const falStatusSchema = z.object({
  status: z.enum(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']),
  request_id: z.string().min(1),
  queue_position: z.number().int().optional(),
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
}

/** Identifiant rendu par fal : alphanumérique et tirets, jamais un chemin. */
export const falRequestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, 'Identifiant de génération invalide.');

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
  if (status === 401 || status === 403) {
    return new AppError(
      503,
      'fal.ai refuse la clé du serveur : l’administrateur doit la vérifier (portée « API »).',
      'FAL_ACCESS_DENIED',
    );
  }
  // fal.ai est prépayé : sans solde, aucun rendu ne part.
  if (status === 402) {
    return new AppError(
      503,
      'Le crédit fal.ai du site est épuisé : l’administrateur doit le recharger. Vos points ont été rendus.',
      'FAL_OUT_OF_CREDIT',
    );
  }
  if (status === 429) {
    return new AppError(429, 'fal.ai limite les demandes en ce moment. Réessayez dans une minute : vos points ont été rendus.', 'FAL_RATE_LIMITED');
  }
  if (status === 404) {
    return new AppError(404, 'Cette génération est introuvable chez fal.ai : elle a peut-être expiré.', 'FAL_NOT_FOUND');
  }
  if (status === 400 || status === 422) {
    return new AppError(502, 'fal.ai a refusé la demande. Reformulez le brief : vos points ont été rendus.', 'FAL_BAD_INPUT');
  }
  if (status >= 500) {
    return new AppError(503, 'fal.ai est momentanément indisponible. Réessayez : vos points ont été rendus.', 'FAL_UNAVAILABLE');
  }
  return new AppError(502, 'fal.ai n’a pas pu traiter la demande. Réessayez : vos points ont été rendus.', 'FAL_FAILED');
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
    throw new AppError(504, 'fal.ai n’a pas répondu à temps. Réessayez : vos points ont été rendus.', 'FAL_TIMEOUT');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw falFailure(response.status, detailOf(payload));
  return payload;
}

/** Dépose une demande dans la file. Le modèle fait partie du chemin. */
export async function submitFalGeneration(model: string, input: unknown): Promise<FalGeneration> {
  const payload = await call(`/${model}`, 'POST', input);
  const parsed = falStatusSchema.safeParse(payload);
  if (!parsed.success) {
    console.error('[fal] réponse de dépôt inattendue', JSON.stringify(payload).slice(0, 300));
    throw new AppError(502, 'Réponse inattendue de fal.ai. Vos points ont été rendus.', 'FAL_UNEXPECTED');
  }
  return { requestId: parsed.data.request_id, status: parsed.data.status };
}

/**
 * État d'une génération, et son fichier quand elle est terminée. Le résultat n'est lu que
 * sur un état COMPLETED : le demander plus tôt rend un 400 qui ressemble à tort à un échec.
 */
export async function getFalGeneration(model: string, requestId: string): Promise<FalGeneration> {
  const id = falRequestIdSchema.parse(requestId);
  const etat = falStatusSchema.safeParse(await call(`/${model}/requests/${encodeURIComponent(id)}/status`, 'GET'));
  if (!etat.success) {
    console.error('[fal] état inattendu pour', id);
    throw new AppError(502, 'Réponse inattendue de fal.ai.', 'FAL_UNEXPECTED');
  }
  if (etat.data.status !== 'COMPLETED') return { requestId: id, status: etat.data.status };

  const resultat = falResultSchema.safeParse(await call(`/${model}/requests/${encodeURIComponent(id)}`, 'GET'));
  if (!resultat.success) {
    console.error('[fal] résultat inattendu pour', id);
    throw new AppError(502, 'Réponse inattendue de fal.ai.', 'FAL_UNEXPECTED');
  }
  const video = resultat.data.video?.url;
  const image = resultat.data.images?.[0]?.url;
  return {
    requestId: id,
    status: 'COMPLETED',
    ...(video ? { mediaUrl: video, mediaType: 'video' as const } : image ? { mediaUrl: image, mediaType: 'image' as const } : {}),
  };
}
