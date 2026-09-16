import { z } from 'zod';
import { env } from '@server/env';
import { AppError } from '@server/middleware';

/**
 * Recherche web des analyses de niche (API Search de Perplexity).
 *
 * L'API renvoie des pages brutes (titre, adresse, extrait, date), sans synthèse :
 * Gemini rédige ensuite à partir de ces seules pages numérotées, et le serveur
 * écarte tout fait dont la source n'existe pas. La recherche Google intégrée à
 * Gemini n'est pas utilisée : ses conditions interdisent de conserver ou d'exporter
 * les résultats, alors qu'un rapport Smart Creator est enregistré et exporté en PDF.
 *
 * Seuls le titre, l'adresse et la date des pages sont gardés dans le rapport ; les
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
/** Extrait par page : assez pour situer une offre ou un prix, sans gonfler la consigne. */
const TOKENS_PER_PAGE = 300;

const resultsSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().catch(''),
        url: z.string().catch(''),
        snippet: z.string().nullish().catch(undefined),
        date: z.string().nullish().catch(undefined),
        last_updated: z.string().nullish().catch(undefined),
      }),
    )
    .catch([]),
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

async function perplexitySearch(query: string, market: string | null) {
  const url = `${env.PERPLEXITY_API_URL.replace(/\/+$/, '')}/search`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.PERPLEXITY_API_KEY ?? ''}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query,
        max_results: RESULTS_PER_QUERY,
        max_tokens_per_page: TOKENS_PER_PAGE,
        // Pays du marché visé : les pages locales (prix en FCFA, offres du pays) remontent d'abord.
        ...(market && /^[A-Z]{2}$/.test(market) ? { country: market } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(504, 'La recherche web n’a pas répondu à temps. Réessayez : vos points ont été rendus.', 'WEB_SEARCH_TIMEOUT');
  }

  if (!response.ok) {
    console.error('[recherche web] le fournisseur a répondu', response.status);
    if (response.status === 401 || response.status === 403) {
      throw new AppError(503, 'L’accès à la recherche web est refusé : clé Perplexity invalide sur le serveur.', 'WEB_SEARCH_ACCESS_DENIED');
    }
    if (response.status === 429) {
      throw new AppError(429, 'La recherche web est saturée. Réessayez dans une minute : vos points ont été rendus.', 'WEB_SEARCH_RATE_LIMITED');
    }
    throw new AppError(502, 'La recherche web a échoué. Réessayez : vos points ont été rendus.', 'WEB_SEARCH_FAILED');
  }

  const parsed = resultsSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.results : [];
}

/** Pages trouvées pour une niche, numérotées et sans doublon. */
export async function searchWeb(input: { query: string; market: string | null; marketName: string | null }): Promise<WebSource[]> {
  const seen = new Set<string>();
  const sources: WebSource[] = [];

  for (const query of researchQueries(input.query, input.marketName)) {
    for (const result of await perplexitySearch(query, input.market)) {
      const url = normalizedUrl(result.url);
      const title = plainText(result.title).slice(0, 200);
      if (!url || !title || seen.has(url)) continue;
      seen.add(url);
      sources.push({
        id: sources.length + 1,
        title,
        url,
        snippet: plainText(result.snippet ?? '').slice(0, 500),
        publishedAt: result.date ?? result.last_updated ?? null,
      });
      if (sources.length >= MAX_SOURCES) return sources;
    }
  }
  return sources;
}
