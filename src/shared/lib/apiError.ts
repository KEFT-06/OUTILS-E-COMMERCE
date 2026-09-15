/**
 * Erreurs renvoyées par l'API Smart Creator, lues de façon uniforme côté client.
 *
 * Le serveur répond `{ error: { code, message, details } }`. Pour un brief refusé
 * par la conformité, `details` porte les constats bloquants : on les extrait pour
 * que l'écran montre quoi corriger, pas seulement qu'il y a un problème.
 */

export interface ApiFinding {
  category: string;
  matched: string;
  rewriteHint: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly findings: ApiFinding[] = [],
    /** Détails bruts renvoyés par le serveur (motifs d'un mot de passe refusé, délai d'un verrou…). */
    readonly details?: unknown,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function parseFindings(details: unknown): ApiFinding[] {
  if (!Array.isArray(details)) return [];

  return details.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    return typeof record.category === 'string' &&
      typeof record.matched === 'string' &&
      typeof record.rewriteHint === 'string'
      ? [{ category: record.category, matched: record.matched, rewriteHint: record.rewriteHint }]
      : [];
  });
}

export async function readApiError(response: Response, fallback: string): Promise<ApiError> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; details?: unknown } }
    | null;

  return new ApiError(
    payload?.error?.message ?? fallback,
    payload?.error?.code,
    parseFindings(payload?.error?.details),
    payload?.error?.details,
    response.status,
  );
}

/** Convertit n'importe quelle valeur levée en `ApiError` affichable. */
export function toApiError(caught: unknown, fallback: string): ApiError {
  if (caught instanceof ApiError) return caught;
  return new ApiError(caught instanceof Error ? caught.message : fallback);
}
