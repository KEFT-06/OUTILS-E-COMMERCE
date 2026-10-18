import { desc, eq } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { auditLogs } from '@server/db/schema';
import { isServerless } from '@server/env';
import { detectAlerts, feedWatchState, salesWatchState, wallWatchState, type watchState } from '@server/services/alerts';
import { resumeReportDocuments } from '@server/services/analysis/document';
import { resumeMobileCheckouts } from '@server/services/billing/mobile';
import { MARKET_RUN_AUDIT_ACTION, indexDiscoveredStores, reportMarketRun } from '@server/services/market';
import { sweepDueWatches } from '@server/services/radar/sweeper';
import { runInBackground } from '@server/shared/backgroundWork';

/**
 * Un passage de veille : ce qui doit avancer sans que personne ne clique — rapports longs quittés
 * en route, paiements Mobile Money validés hors écran, surveillances du radar, relevés de l'index,
 * alertes.
 *
 * Deux constats du 12/10/2026 l'ont fait réécrire ainsi :
 *
 *  1. Le passage n'avait pas de durée bornée. Quand les vitrines mettaient du temps à refuser, la
 *     somme de ses étapes dépassait les 280 s que l'atelier lui accorde : celui-ci relevait « le
 *     site n'a pas répondu » deux fois de suite, sans que rien ne soit cassé. Chaque étape reçoit
 *     désormais ce qu'il reste du temps du passage, et rend la main à l'heure — son travail déjà
 *     fait est gardé.
 *  2. L'atelier est programmé toutes les demi-heures, mais son hébergeur ne l'a lancé que quatre
 *     fois en quatorze heures. Le passage part donc AUSSI quand quelqu'un consulte les alertes, le
 *     radar ou l'espionnage, s'il n'y en a pas eu depuis une demi-heure : la veille suit l'usage
 *     du site, et ne dépend plus d'un seul déclencheur.
 */

/** Temps d'un passage demandé par l'atelier : sous les 280 s qu'il attend. */
export const WATCH_PASS_MS = 200_000;
/** Temps d'un passage lancé à la consultation : il vit après la réponse, dans le temps de la fonction. */
const ON_VISIT_PASS_MS = 90_000;
/** En deçà, un nouveau passage n'apprendrait rien. */
export const WATCH_EVERY_MS = 30 * 60_000;

export interface WatchPassReport {
  surveillances: Awaited<ReturnType<typeof sweepDueWatches>> | null;
  releves: Awaited<ReturnType<typeof indexDiscoveredStores>> | null;
  alertes: number | null;
  /** Ce que la veille sait à cet instant ; une lecture manquée laisse ses chiffres absents, sans emporter les autres. */
  etat: Partial<Awaited<ReturnType<typeof watchState>>>;
  /** Durée de chaque étape, en millisecondes : dit où le temps du passage est allé. */
  durees: Record<string, number>;
  /** Paliers activés par des paiements Mobile Money validés hors écran. */
  paiements: number | null;
  /** Étapes qui n'ont pas rendu la main à temps : leur travail continue, le passage ne les attend pas. */
  enRetard: string[];
  /**
   * Étapes qui ont échoué, avec le code de l'erreur quand elle en porte un (jamais son message :
   * ce compte rendu est affiché par un atelier public).
   */
  enEchec: { etape: string; code: string | null }[];
}

/**
 * Une étape d'un passage, attendue au plus `ms` : un échec ou un retard ne coûte que cette étape.
 * En retard, son nom est noté dans `late` et le passage continue sans elle — son travail, lui,
 * se poursuit et ce qu'il enregistre est gardé.
 */
export async function boundedStep<T>(
  label: string,
  ms: number,
  work: () => Promise<T>,
  late: string[],
  failed: { etape: string; code: string | null }[] = [],
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      late.push(label);
      resolve(null);
    }, ms);
  });
  try {
    return await Promise.race([
      work().catch((error: unknown) => {
        console.warn(`[veille] ${label} :`, error instanceof Error ? error.message : error);
        // Un code (celui de la base, ou le nôtre) situe la panne sans rien dire des données.
        const code = (error as { code?: unknown } | null)?.code;
        failed.push({ etape: label, code: typeof code === 'string' && /^[A-Za-z0-9_]{2,40}$/.test(code) ? code : null });
        return null;
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runWatchPass(source: string, budgetMs = WATCH_PASS_MS): Promise<WatchPassReport> {
  const end = Date.now() + budgetMs;
  const late: string[] = [];
  const failed: { etape: string; code: string | null }[] = [];
  /** Ce qu'il reste du passage, plafonné : une étape ne prend jamais le temps des suivantes. */
  const left = (cap: number) => Math.max(2_000, Math.min(cap, end - Date.now()));
  const durees: Record<string, number> = {};
  const step = async <T>(label: string, ms: number, work: () => Promise<T>) => {
    const started = Date.now();
    try {
      return await boundedStep(label, ms, work, late, failed);
    } finally {
      durees[label] = Date.now() - started;
    }
  };

  await step('reprise des rapports', left(20_000), () => resumeReportDocuments());
  // L'argent d'abord : un paiement validé hors écran n'attend pas le lendemain.
  const paiements = await step('paiements Mobile Money', left(30_000), () => resumeMobileCheckouts({ limit: 5 }));

  const sweepMs = left(Math.min(45_000, budgetMs * 0.25));
  const surveillances = await step('surveillances', sweepMs + 10_000, () => sweepDueWatches(new Date(), sweepMs));

  // Les relevés prennent ce qu'il reste, moins de quoi calculer les alertes et écrire le compte rendu.
  const indexMs = Math.max(5_000, left(budgetMs * 0.45) - 35_000);
  const releves = await step('index du marché', indexMs + 25_000, () => indexDiscoveredStores(indexMs, new Date(), { storeCapMs: 20_000, storeMinMs: 8_000 }));

  const alertes = await step('alertes', left(30_000), () => detectAlerts());
  await step('compte rendu', left(10_000), () => reportMarketRun(source, releves, alertes));
  // Trois lectures séparées : celle qui manque ne retire pas les deux autres du compte rendu.
  const etat = {
    ...((await step('état des ventes', left(8_000), () => salesWatchState())) ?? {}),
    ...((await step('état des publicités', left(8_000), () => wallWatchState())) ?? {}),
    ...((await step('état des alertes', left(8_000), () => feedWatchState())) ?? {}),
  };
  return { surveillances, releves, alertes, etat, paiements, enRetard: late, enEchec: failed, durees };
}

/** Un passage est-il dû ? Faux tant que le dernier, quelle qu'en soit l'origine, a moins d'une demi-heure. */
export function watchIsDue(lastPassAt: Date | null, now = new Date()): boolean {
  return !lastPassAt || now.getTime() - lastPassAt.getTime() >= WATCH_EVERY_MS;
}

let lastVisitCheck = 0;

/**
 * Veille à la consultation : appelée par les écrans qui montrent ce que la veille produit. Au plus
 * une vérification toutes les dix minutes par instance, et un passage seulement s'il est dû.
 *
 * Réservée à l'hébergement sans serveur, où rien d'autre ne tourne entre deux visites : sur un
 * serveur classique, le passage se demande par son adresse.
 */
export function watchOnVisit(): void {
  if (!isServerless || Date.now() - lastVisitCheck < 10 * 60_000) return;
  lastVisitCheck = Date.now();
  runInBackground(async () => {
    const [last] = await getDb().select({ at: auditLogs.createdAt }).from(auditLogs).where(eq(auditLogs.action, MARKET_RUN_AUDIT_ACTION)).orderBy(desc(auditLogs.createdAt)).limit(1);
    if (!watchIsDue(last?.at ?? null)) return;
    await runWatchPass('veille à la consultation', ON_VISIT_PASS_MS);
  }, 'veille à la consultation');
}
