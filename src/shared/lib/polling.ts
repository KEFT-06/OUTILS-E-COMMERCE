import { readApiError } from '@/shared/lib/apiError';

/**
 * Suivi d'un travail qui tourne sur le serveur (conte illustré, visuel, vidéo).
 *
 * Un raté de suivi n'est pas un échec du travail. Le suivi s'arrêtait au premier raté — réseau
 * mobile qui décroche, instance qui redémarre, fournisseur qui limite le débit — et affichait
 * une erreur alors que le conte ou la vidéo continuait de se fabriquer, puis apparaissait dans
 * la bibliothèque. L'utilisateur croyait à une panne, et relançait en payant une seconde fois.
 */

/** Ratés d'affilée tolérés : au rythme de 5 s, un peu plus d'une minute sans réponse. */
export const MAX_POLL_MISSES = 12;

/**
 * Relit l'état d'un travail. Renvoie null sur un raté passager (réseau, 429, 5xx) : il suffit
 * de relire au passage suivant. Lève sur un refus définitif (introuvable, accès refusé).
 */
export async function pollStatus<T>(url: string, failure: string): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return null;
  }
  if (response.status === 429 || response.status >= 500) return null;
  if (!response.ok) throw await readApiError(response, `${failure} (${response.status}).`);
  return (await response.json().catch(() => null)) as T | null;
}

/** Message quand la connexion reste perdue : le travail, lui, continue et reste retrouvable. */
export const lostTrackMessage = (whereToFind: string) =>
  `La connexion au serveur est perdue depuis plus d’une minute. Le travail continue sans vous : retrouvez-le ${whereToFind}. Si le fournisseur échoue, vos points vous seront rendus automatiquement.`;
