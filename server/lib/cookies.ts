import type { CookieOptions, Request, Response } from 'express';
import { isProd } from '@server/env';

/** Lit un cookie sans dépendance : l'en-tête est court et son format, simple. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Cookies d'authentification :
 *  - httpOnly : illisibles par le JavaScript de la page, donc par un script injecté ;
 *  - SameSite=Strict : jamais envoyés par une requête partie d'un autre site ;
 *  - Secure en production : jamais transmis en clair.
 */
export function authCookieOptions(maxAgeMs: number): CookieOptions {
  return { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/', maxAge: Math.max(0, maxAgeMs) };
}

export function clearAuthCookie(res: Response, name: string): void {
  res.clearCookie(name, { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/' });
}
