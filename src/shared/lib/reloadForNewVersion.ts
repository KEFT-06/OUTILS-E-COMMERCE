const RECHARGEMENT = 'sc.rechargementVersion';

/**
 * Le site a été redéployé depuis l'ouverture de l'onglet (un fichier d'écran a changé de
 * nom) : on recharge une fois, sans rien demander. La date du dernier essai, gardée pour
 * l'onglet, empêche de boucler si le fichier manquait pour une autre raison (réseau coupé).
 *
 * @returns true si la page va se recharger.
 */
export function reloadOnceForNewVersion(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RECHARGEMENT) ?? 0);
    if (Date.now() - last < 60_000) return false;
    window.sessionStorage.setItem(RECHARGEMENT, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
