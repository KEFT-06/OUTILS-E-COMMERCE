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

declare global {
  interface Window {
    /** Réponses demandées dès le HTML par public/boot.js, avant le chargement de l'application. */
    __smartCreatorEarly?: Record<string, Promise<Response> | undefined>;
  }
}

/** Réponse anticipée par public/boot.js : servie une seule fois, au premier appel. */
function takeEarlyResponse(path: string): Promise<Response> | null {
  if (typeof window === 'undefined') return null;
  const early = window.__smartCreatorEarly?.[path];
  if (!early) return null;
  delete window.__smartCreatorEarly![path];
  return early;
}

export async function apiRequest<T>(
  path: string,
  options: { method?: Method; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  const send = () =>
    fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

  let response: Response;
  try {
    const early = !options.method && !hasBody && !options.signal ? takeEarlyResponse(path) : null;
    // Une demande anticipée qui a échoué (réseau) est simplement refaite.
    response = early ? await early.catch(send) : await send();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Le serveur est injoignable : vérifiez votre connexion.', 'NETWORK_ERROR');
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
