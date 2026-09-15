import { z } from 'zod';
import { env } from '@server/env';
import { AppError } from '@server/middleware';

/**
 * Recherche web des analyses de niche (Brave Search API).
 *
 * Pourquoi pas la recherche Google intégrée à Gemini : ses conditions interdisent
 * de conserver, de modifier ou de diffuser les résultats, alors qu'un rapport
 * Smart Creator est enregistré, restructuré et exporté en PDF. Brave vend des
 * offres qui autorisent le stockage ; le choix de l'offre revient au propriétaire.
 *
 * Seuls le titre, l'adresse et l'âge des pages sont gardés dans le rapport ; les
 * extraits ne servent qu'à la rédaction et ne sont pas conservés.
 */

export interface WebSource {
  /** Numéro cité dans le rapport, à partir de 1. */
  id: number;
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
}

const TIMEOUT_MS = 20_000;
const RESULTS_PER_QUERY = 8;
const MAX_SOURCES = 15;
/** L'offre gratuite de Brave accepte une requête par seconde. */
const PAUSE_MS = 1_100;

const resultsSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string().catch(''),
            url: z.string().catch(''),
            description: z.string().optional().catch(undefined),
            page_age: z.string().optional().catch(undefined),
            age: z.string().optional().catch(undefined),
          }),
        )
        .catch([]),
    })
    .optional()
    .catch(undefined),
});

/** Requêtes lancées pour une niche : le marché, les offres existantes, les attentes des clients. */
export function researchQueries(query: string, marketName: string | null): string[] {
  const where = marketName ? ` ${marketName}` : '';
  return [`${query}${where}`, `${query} ebook formation prix${where}`, `${query} avis clients difficultés`];
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function braveSearch(query: string) {
  const params = new URLSearchParams({ q: query, count: String(RESULTS_PER_QUERY), safesearch: 'moderate' });
  const url = `${env.BRAVE_SEARCH_API_URL.replace(/\/+$/, '')}/res/v1/web/search?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY ?? '' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(504, 'La recherche web n’a pas répondu à temps. Réessayez : vos points ont été rendus.', 'WEB_SEARCH_TIMEOUT');
  }

  if (!response.ok) {
    console.error('[recherche web] le fournisseur a répondu', response.status);
    if (response.status === 401 || response.status === 403) {
      throw new AppError(503, 'L’accès à la recherche web est refusé : clé Brave Search invalide sur le serveur.', 'WEB_SEARCH_ACCESS_DENIED');
    }
    if (response.status === 429) {
      throw new AppError(429, 'La recherche web est saturée. Réessayez dans une minute : vos points ont été rendus.', 'WEB_SEARCH_RATE_LIMITED');
    }
    throw new AppError(502, 'La recherche web a échoué. Réessayez : vos points ont été rendus.', 'WEB_SEARCH_FAILED');
  }

  const parsed = resultsSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? (parsed.data.web?.results ?? []) : [];
}

/** Pages trouvées pour une niche, numérotées et sans doublon. */
export async function searchWeb(input: { query: string; marketName: string | null }): Promise<WebSource[]> {
  const seen = new Set<string>();
  const sources: WebSource[] = [];

  for (const [index, query] of researchQueries(input.query, input.marketName).entries()) {
    if (index > 0) await pause(PAUSE_MS);
    for (const result of await braveSearch(query)) {
      const url = normalizedUrl(result.url);
      const title = plainText(result.title).slice(0, 200);
      if (!url || !title || seen.has(url)) continue;
      seen.add(url);
      sources.push({
        id: sources.length + 1,
        title,
        url,
        snippet: plainText(result.description ?? '').slice(0, 500),
        publishedAt: result.page_age ?? result.age ?? null,
      });
      if (sources.length >= MAX_SOURCES) return sources;
    }
  }
  return sources;
}
