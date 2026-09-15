import { ApiError, readApiError } from '@/shared/lib/apiError';

/**
 * Appel à l'API Smart Creator.
 *
 * La session voyage dans un cookie httpOnly : le code du navigateur ne la voit
 * jamais et n'a rien à stocker. Une session expirée déclenche un événement que
 * le contexte d'authentification écoute pour renvoyer vers la connexion.
 */

export const SESSION_EXPIRED_EVENT = 'smartcreator:session-expiree';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function apiRequest<T>(
  path: string,
  options: { method?: Method; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const hasBody = options.body !== undefined;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.', 'NETWORK_ERROR');
  }

  if (!response.ok) {
    const error = await readApiError(response, `La requête a échoué (${response.status}).`);
    if (error.code === 'AUTH_REQUIRED') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Motifs de refus d'un mot de passe, renvoyés par le serveur. */
export function passwordProblemsOf(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'WEAK_PASSWORD') return [];
  const problems = (error.details as { problems?: unknown } | undefined)?.problems;
  return Array.isArray(problems) ? problems.filter((item): item is string => typeof item === 'string') : [];
}
