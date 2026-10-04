import { createHmac } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { auditLogs } from '@server/db/schema';
import { env, isProd } from '@server/env';
import { recordAudit } from '@server/services/audit';
import { PUBLIC_PAGES } from '@server/shared/publicPages';

/**
 * Déclaration du site aux moteurs de recherche (protocole IndexNow : Bing, Yandex, Seznam,
 * Naver, et les moteurs qui s'appuient sur l'index de Bing).
 *
 * Un site neuf, sans lien entrant, peut rester des mois hors des résultats : personne ne dit
 * aux moteurs qu'il existe. Le 04/10/2026, taper l'adresse exacte du site dans Bing ne le
 * trouvait pas. IndexNow permet de le leur dire sans compte ni formulaire : le site publie une
 * clé à « /<clé>.txt », puis envoie la liste de ses pages ; le moteur vérifie la clé et vient lire.
 *
 * Google ne suit pas ce protocole : il lit le plan du site annoncé dans robots.txt, et se
 * déclare par son outil pour propriétaires de sites (balise de validation, voir env.ts).
 */

const ACTION = 'seo.indexnow';
const TIMEOUT_MS = 15_000;
/** Sans nouvelle mise en ligne, la déclaration n'est refaite qu'une fois par semaine. */
const RENEW_AFTER_MS = 7 * 86_400_000;

/** Clé publiée par le site. Donnée par le propriétaire, ou tirée d'un secret du serveur sans le révéler. */
export function indexNowKey(): string | null {
  if (env.INDEXNOW_URL === 'off') return null;
  if (env.INDEXNOW_KEY) return env.INDEXNOW_KEY;
  if (!env.DATA_ENCRYPTION_KEY) return null;
  return createHmac('sha256', env.DATA_ENCRYPTION_KEY).update(`indexnow:${new URL(env.APP_URL).host}`).digest('hex').slice(0, 32);
}

/** Version en ligne : une nouvelle mise en ligne justifie une nouvelle déclaration. */
const release = () => process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? 'sans-version';

export interface IndexNowOutcome {
  submitted: number;
  /** Pourquoi rien n'a été envoyé, quand c'est le cas. */
  skipped?: string;
}

/** Déclare les pages publiques, une fois par mise en ligne (et au plus tard une fois par semaine). */
export async function submitToIndexNow(now = new Date(), options: { force?: boolean } = {}): Promise<IndexNowOutcome> {
  const key = indexNowKey();
  if (!key) return { submitted: 0, skipped: 'déclaration désactivée' };
  if (!isProd && !options.force) return { submitted: 0, skipped: 'hors production' };

  const [last] = await getDb()
    .select({ at: auditLogs.createdAt, details: auditLogs.details })
    .from(auditLogs)
    .where(eq(auditLogs.action, ACTION))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  const sameRelease = last?.details?.release === release();
  if (last && sameRelease && now.getTime() - last.at.getTime() < RENEW_AFTER_MS) return { submitted: 0, skipped: 'déjà déclarée pour cette version' };

  const base = env.APP_URL.replace(/\/+$/, '');
  const urlList = PUBLIC_PAGES.map((page) => `${base}${page.path}`);
  const response = await fetch(env.INDEXNOW_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(base).host, key, keyLocation: `${base}/${key}.txt`, urlList }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 200 : pris en compte ; 202 : reçu, clé en cours de vérification. Le reste est un refus.
  if (response.status !== 200 && response.status !== 202) throw new Error(`déclaration refusée (${response.status})`);

  await recordAudit({
    actor: { id: null, email: 'referencement@site' },
    action: ACTION,
    details: { release: release(), urls: urlList.length, status: response.status },
    client: { ipAddress: null, userAgent: null },
  });
  return { submitted: urlList.length };
}
