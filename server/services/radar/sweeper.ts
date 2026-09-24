import { and, asc, count, eq, isNull, lt, or } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { watches } from '@server/db/schema';
import { env } from '@server/env';
import { sendDueRadarDigests } from '@server/services/radar/alerts';
import { discoveryIsDue, runDiscovery } from '@server/services/radar/discovery';
import { sweepWatch } from '@server/services/radar/sweep';

/**
 * Le radar ne dort pas.
 *
 * Personne ne clique ici : ce balayage relève de lui-même chaque surveillance dont le
 * dernier passage est assez ancien, et c'est ce qui donne au produit sa seule donnée
 * inrattrapable — l'histoire. Un concurrent qui retire un produit aujourd'hui ne
 * laissera aucune trace ailleurs : la vitrine ne montre que le présent.
 *
 * Deux choix de politesse envers les sites observés, qui sont ceux de tiers :
 *   · un seul passage par boutique et par jour (RADAR_SWEEP_INTERVAL_HOURS) ;
 *   · les boutiques sont relevées une par une, avec une pause, jamais en rafale.
 */

/**
 * Ce qu'un tour peut relever au plus. Garde-fou, pas objectif : c'est le temps qui arrête
 * la boucle en pratique.
 */
const BATCH_MAX = 250;

/**
 * Temps qu'un tour s'autorise.
 *
 * Il y avait ici un nombre fixe de vingt boutiques par tour. Sur un hébergement sans
 * serveur, où le seul réveil est le planificateur — et où l'offre Hobby de Vercel
 * n'autorise QU'UN cron par jour — cela plafonnait la plateforme entière à vingt relevés
 * quotidiens. Un seul compte Max (vingt boutiques) consommait toute la capacité du site.
 *
 * Le pire n'était pas le plafond, mais son silence : le tri par `lastSweptAt` fait tourner
 * la file, si bien qu'avec cent boutiques chacune était relevée tous les cinq jours. Le
 * produit promet un relevé quotidien, et rien à l'écran ne disait le contraire.
 *
 * Une durée plutôt qu'un compte : elle s'adapte à la lenteur du réseau et au temps que
 * l'hébergeur accorde, là où un nombre fixe est juste une fois et faux partout ailleurs.
 */
const BUDGET_MS = 240_000;

/**
 * Pause entre deux boutiques. Elle protège l'API de vitrine, qui est la même pour toutes :
 * ce sont des sous-domaines, pas des serveurs différents.
 *
 * Elle valait une seconde et demie, soit près de trente secondes de budget passées à ne
 * rien faire. Quatre cents millisecondes tiennent la cadence sous trois requêtes par
 * seconde — ce qu'une API publique de JSON absorbe sans y penser.
 */
const PAUSE_MS = 400;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface SweepRunOutcome {
  due: number;
  swept: number;
  failed: number;
  /**
   * Surveillances encore dues à la fin du tour. Au-dessus de zéro, la file n'a pas été
   * vidée : c'est ce chiffre qu'il faut lire avant de croire le radar à jour.
   */
  remaining: number;
}

/** Relève les surveillances dues. Renvoie ce qui a été tenté, ce qui a abouti, et ce qui attend. */
export async function sweepDueWatches(now = new Date(), budgetMs = BUDGET_MS): Promise<SweepRunOutcome> {
  const seuil = new Date(now.getTime() - env.RADAR_SWEEP_INTERVAL_HOURS * 3_600_000);
  const dues = and(eq(watches.active, true), or(isNull(watches.lastSweptAt), lt(watches.lastSweptAt, seuil)));

  const [total] = await getDb().select({ value: count() }).from(watches).where(dues);
  const due = Number(total?.value ?? 0);

  const lot = await getDb()
    .select()
    .from(watches)
    .where(dues)
    // Les plus anciennement relevées d'abord : personne n'est oublié quand la file est longue.
    .orderBy(asc(watches.lastSweptAt))
    .limit(BATCH_MAX);

  const echeance = Date.now() + budgetMs;
  let swept = 0;
  let failed = 0;
  let traitees = 0;

  for (const [index, watch] of lot.entries()) {
    // Le temps restant se vérifie AVANT de commencer : couper un relevé en cours laisserait
    // une transaction ouverte et de fausses disparitions derrière elle.
    if (Date.now() >= echeance) break;
    if (index > 0) await pause(PAUSE_MS);
    traitees += 1;
    try {
      await sweepWatch(watch, new Date());
      swept += 1;
    } catch (error) {
      // L'échec est déjà inscrit sur la surveillance par sweepWatch : ici on continue,
      // sinon une boutique fermée empêcherait de relever toutes les suivantes.
      failed += 1;
      console.warn('[radar] relevé en échec :', watch.label, error instanceof Error ? error.message : error);
    }
  }

  return { due, swept, failed, remaining: Math.max(0, due - traitees) };
}

/**
 * Lance le balayage périodique. Renvoie la fonction d'arrêt.
 *
 * Le réveil est bien plus fréquent que l'intervalle de relevé : c'est la date du dernier
 * passage qui décide, pas le rythme du minuteur. Un serveur redémarré trois fois dans la
 * journée ne relève donc pas trois fois la même boutique.
 */
export function startRadarSweeper(intervalMs = 30 * 60_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    sweepDueWatches()
      .then(async ({ due, swept, failed, remaining }) => {
        if (due > 0)
          console.log(
            `  Radar : ${swept}/${due} boutiques relevées` +
              `${failed > 0 ? `, ${failed} en échec` : ''}` +
              // Une file non vidée est ce qu'il faut voir en premier : le radar n'est pas à jour.
              `${remaining > 0 ? `, ${remaining} EN ATTENTE du prochain tour` : ''}`,
          );
        // Les résumés partent APRÈS les relevés : les événements du jour sont déjà écrits,
        // donc le message dit ce qui vient d'être constaté et pas ce qui l'était hier.
        const { sent } = await sendDueRadarDigests();
        if (sent > 0) console.log(`  Radar : ${sent} résumé${sent > 1 ? 's' : ''} envoyé${sent > 1 ? 's' : ''}`);

        // Découverte de nouvelles boutiques : payante au résultat, donc pilotée par le seul
        // rythme configuré et jamais par une action d'utilisateur.
        if (await discoveryIsDue()) {
          const { adsExamined, storesFound, storesNew } = await runDiscovery();
          console.log(
            `  Radar : découverte sur ${adsExamined} publicités — ${storesFound} boutiques, dont ${storesNew} nouvelle${storesNew > 1 ? 's' : ''}`,
          );
        }
      })
      .catch((error: unknown) => console.error('[radar] balayage interrompu :', error))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
