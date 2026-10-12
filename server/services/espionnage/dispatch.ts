import { env } from '@server/env';

/**
 * Appel du collecteur maison à la demande.
 *
 * Le collecteur (dossier collecteur/, Crawlee + Playwright) ne peut pas tourner chez l'hébergeur
 * du site : il lui faut un navigateur. Il tourne dans un atelier GitHub, chaque nuit. Quand un
 * client lance une recherche que la lecture payante ne sert pas, attendre la nuit serait le
 * laisser sans réponse fraîche : le site peut donc demander un passage tout de suite, limité aux
 * recherches en attente. Il aboutit en quelques minutes.
 *
 * Il faut pour cela un jeton GitHub (COLLECTOR_DISPATCH_TOKEN) autorisé à lancer les ateliers du
 * dépôt. Sans lui, rien ne casse : les recherches en attente sont lues au passage de la nuit.
 */

export function collectorDispatchConfigured(): boolean {
  return Boolean(env.COLLECTOR_DISPATCH_TOKEN);
}

/** Dernier refus d'un lancement à la demande (jeton périmé, droits retirés), sur cette instance. */
let refusedAt = 0;
const REFUSAL_MEMORY_MS = 30 * 60_000;

/**
 * Le collecteur peut-il passer « dans quelques minutes » ? Faux sans jeton, et faux tant qu'un
 * lancement vient d'être refusé : l'écran annonce alors le prochain passage programmé, pas une
 * lecture imminente qui ne viendra pas.
 */
export function collectorDispatchWorking(now = Date.now()): boolean {
  return collectorDispatchConfigured() && now - refusedAt > REFUSAL_MEMORY_MS;
}

/** Oublie un refus passé (tests). */
export function resetCollectorDispatch(): void {
  refusedAt = 0;
}

/** Demande un passage du collecteur pour les recherches en attente. Ne lève jamais. */
export async function requestCollectorPassage(): Promise<boolean> {
  if (!env.COLLECTOR_DISPATCH_TOKEN) return false;
  const url = `${env.GITHUB_API_URL.replace(/\/+$/, '')}/repos/${env.COLLECTOR_REPOSITORY}/actions/workflows/${env.COLLECTOR_WORKFLOW}/dispatches`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.COLLECTOR_DISPATCH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'SmartCreator',
      },
      body: JSON.stringify({ ref: env.COLLECTOR_REF, inputs: { demandes: 'oui' } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 204) {
      refusedAt = Date.now();
      console.warn(`[collecteur] passage à la demande refusé (réponse ${response.status}) : la recherche attendra le prochain passage programmé.`);
      return false;
    }
    refusedAt = 0;
    return true;
  } catch (error) {
    refusedAt = Date.now();
    console.warn('[collecteur] passage à la demande impossible :', error instanceof Error ? error.message : error);
    return false;
  }
}
