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
    if (response.status !== 204) console.warn(`[collecteur] passage à la demande refusé (réponse ${response.status}) : la recherche attendra le passage de la nuit.`);
    return response.status === 204;
  } catch (error) {
    console.warn('[collecteur] passage à la demande impossible :', error instanceof Error ? error.message : error);
    return false;
  }
}
