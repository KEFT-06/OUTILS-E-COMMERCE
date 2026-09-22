import { and, asc, eq, isNull, lt, or } from 'drizzle-orm';
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

/** Surveillances relevées par tour. Borne le travail d'un réveil, le reste attend le suivant. */
const BATCH_SIZE = 20;
/** Pause entre deux boutiques : le radar n'a aucune raison d'être pressé. */
const PAUSE_MS = 1_500;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Relève les surveillances dues. Renvoie ce qui a été tenté et ce qui a abouti. */
export async function sweepDueWatches(now = new Date()): Promise<{ due: number; swept: number; failed: number }> {
  const seuil = new Date(now.getTime() - env.RADAR_SWEEP_INTERVAL_HOURS * 3_600_000);

  const dues = await getDb()
    .select()
    .from(watches)
    .where(and(eq(watches.active, true), or(isNull(watches.lastSweptAt), lt(watches.lastSweptAt, seuil))))
    // Les plus anciennement relevées d'abord : personne n'est oublié quand la file est longue.
    .orderBy(asc(watches.lastSweptAt))
    .limit(BATCH_SIZE);

  let swept = 0;
  let failed = 0;

  for (const [index, watch] of dues.entries()) {
    if (index > 0) await pause(PAUSE_MS);
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

  return { due: dues.length, swept, failed };
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
      .then(async ({ due, swept, failed }) => {
        if (due > 0) console.log(`  Radar : ${swept}/${due} boutiques relevées${failed > 0 ? `, ${failed} en échec` : ''}`);
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
