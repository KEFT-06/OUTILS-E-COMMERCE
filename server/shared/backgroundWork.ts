import { waitUntil } from '@vercel/functions';

/**
 * Travail qui se poursuit après la réponse.
 *
 * Sur un serveur classique, le processus reste vivant : une promesse laissée de côté
 * continue toute seule. En hébergement sans serveur, l'instance est gelée dès la réponse
 * envoyée, et le travail serait abandonné au milieu — l'hébergeur doit être prévenu qu'il
 * reste quelque chose à finir. C'est le rôle de `waitUntil`, sans effet hors de ce contexte.
 *
 * L'avertissement doit partir tout de suite, dans le fil de la requête : passer par un
 * `await` ferait perdre le contexte d'exécution auquel l'hébergeur rattache le travail.
 *
 * Le travail dispose au plus du temps accordé à la requête (300 s chez Vercel) : au-delà,
 * il est coupé. Les traitements plus longs avancent par tranches, chaque tranche tenant
 * dans ce budget, et reprennent au suivi suivant.
 */
export function runInBackground(work: () => Promise<void>, label: string): void {
  const started = work().catch((error: unknown) => {
    console.error(`[arrière-plan] ${label} a échoué :`, error);
  });
  try {
    waitUntil(started);
  } catch {
    // Hors hébergement sans serveur : le processus reste vivant, la promesse suit son cours.
  }
}
