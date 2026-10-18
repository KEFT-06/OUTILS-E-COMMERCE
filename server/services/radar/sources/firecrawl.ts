import { AsyncLocalStorage } from 'node:async_hooks';
import { lt, sql } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { providerDailyUsage } from '@server/db/schema';
import { env } from '@server/env';
import { AppError } from '@server/middleware';

/**
 * Lecture d'une page de vitrine par Firecrawl.
 *
 * La plateforme Chariow refuse le serveur du site depuis le 11/10/2026 (« réponse 500/403
 * (cloudflare) ») : plus aucune vente relevée, plus d'alerte de vente. Le propriétaire a décidé le
 * 18/10/2026 de lire les vitrines par Firecrawl. Mesuré ce jour-là : la page d'une boutique, son
 * catalogue et la fiche d'un produit répondent tous (une boutique : 508 ventes, contre 394 au
 * dernier relevé du 6 octobre).
 *
 * Lecture ORDINAIRE seulement (« proxy basic ») : si la plateforme refuse aussi Firecrawl, le radar
 * le dit et s'arrête, il ne se déguise pas. Une page = un crédit : un plafond quotidien, partagé par
 * toutes les instances du serveur, protège le forfait. Ce qu'un client attend (sa surveillance, la
 * boutique qu'il ouvre) passe avant l'index du marché, qui n'en prend que les deux tiers.
 */

export type ReadPriority = 'client' | 'index';

const priority = new AsyncLocalStorage<ReadPriority>();

/** Les lectures faites dans `work` comptent comme celles de l'index du marché (servies après les clients). */
export function asMarketIndexRead<T>(work: () => Promise<T>): Promise<T> {
  return priority.run('index', work);
}

export const firecrawlConfigured = (): boolean => Boolean(env.FIRECRAWL_API_KEY);

const PROVIDER = 'firecrawl';
const today = (now: Date) => now.toISOString().slice(0, 10);

/** Plafond du jour pour une lecture de cette priorité. */
export function dailyPagesFor(level: ReadPriority): number {
  const cap = env.RADAR_FIRECRAWL_DAILY_PAGES;
  return level === 'index' ? Math.floor((cap * 2) / 3) : cap;
}

/**
 * Réserve une page du plafond du jour. Atomique entre instances : l'incrément n'a lieu que sous le
 * plafond, et rien n'est rendu quand il est atteint.
 */
export async function reserveFirecrawlPage(level: ReadPriority = priority.getStore() ?? 'client', now = new Date()): Promise<boolean> {
  const limit = dailyPagesFor(level);
  if (limit <= 0) return false;
  const rows = await getDb()
    .insert(providerDailyUsage)
    .values({ day: today(now), provider: PROVIDER, units: 1 })
    .onConflictDoUpdate({
      target: [providerDailyUsage.day, providerDailyUsage.provider],
      set: { units: sql`${providerDailyUsage.units} + 1` },
      setWhere: lt(providerDailyUsage.units, limit),
    })
    .returning({ units: providerDailyUsage.units });
  return rows.length > 0;
}

/** Pages lues aujourd'hui par Firecrawl, pour l'administration. */
export async function firecrawlPagesToday(now = new Date()): Promise<number> {
  const rows = await getDb().select({ units: providerDailyUsage.units }).from(providerDailyUsage).where(sql`${providerDailyUsage.day} = ${today(now)} and ${providerDailyUsage.provider} = ${PROVIDER}`);
  return rows[0]?.units ?? 0;
}

/** Plafond atteint ou crédits épuisés : ni la boutique ni la surveillance n'y sont pour rien. */
export const BUDGET_CODE = 'RADAR_SOURCE_BUDGET';

const budgetReached = (message: string) => new AppError(429, message, BUDGET_CODE);

export interface FetchedPage {
  /** Statut de la page lue chez la plateforme (et non celui de Firecrawl). */
  status: number;
  body: string;
}

/**
 * Une page de vitrine lue par Firecrawl. Lève une erreur de plafond (`RADAR_SOURCE_BUDGET`) quand
 * le plafond du jour ou le forfait est épuisé ; rend le statut de la page sinon, à l'appelant de
 * l'interpréter comme une lecture directe.
 */
export async function fetchViaFirecrawl(url: string): Promise<FetchedPage> {
  if (!(await reserveFirecrawlPage())) throw budgetReached('Le relevé des vitrines a atteint son plafond du jour : il reprendra demain.');
  let response: Response;
  try {
    response = await fetch(`${env.FIRECRAWL_API_URL.replace(/\/+$/, '')}/v2/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
      // maxAge 0 : une page fraîche, les ventes d'aujourd'hui et non celles d'un cache.
      body: JSON.stringify({ url, formats: ['rawHtml'], onlyMainContent: false, proxy: 'basic', maxAge: 0, timeout: 45_000 }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { status: 0, body: '' };
  }
  // Forfait épuisé chez Firecrawl : la lecture reprendra au renouvellement, rien n'est en panne chez la boutique.
  if (response.status === 402) throw budgetReached('Le relevé des vitrines a épuisé son forfait : il reprendra au renouvellement.');
  if (response.status === 429) throw new AppError(429, 'La plateforme limite les consultations : le radar réessaiera.', 'RADAR_SOURCE_RATE_LIMITED');
  const payload = (await response.json().catch(() => null)) as { success?: boolean; data?: { rawHtml?: string; metadata?: { statusCode?: number } } } | null;
  if (!response.ok || !payload?.success) {
    console.warn(`[radar] Firecrawl a répondu ${response.status}`);
    return { status: 0, body: '' };
  }
  return { status: Number(payload.data?.metadata?.statusCode ?? 200), body: String(payload.data?.rawHtml ?? '') };
}

/** Le JSON d'une réponse d'API lue par Firecrawl : brut, ou placé dans un « pre » quand il l'a rendu en page. */
export function jsonOfPage(body: string): unknown {
  const brut = body.trim();
  if (!brut.startsWith('<')) return JSON.parse(brut) as unknown;
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(brut)?.[1] ?? '';
  const texte = pre.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return JSON.parse(texte) as unknown;
}
