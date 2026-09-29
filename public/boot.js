/*
 * Démarrage anticipé : la session est demandée dès la lecture du HTML, pendant que les scripts
 * de l'application se téléchargent, au lieu d'attendre qu'ils aient fini (une demi-seconde à
 * une seconde de gagnée sur les connexions mobiles). src/shared/lib/api.ts reprend la réponse.
 * Fichier séparé, et non script en ligne : la politique de sécurité n'autorise que 'self'.
 */
(function () {
  try {
    window.__smartCreatorEarly = { '/api/auth/me': fetch('/api/auth/me', { credentials: 'same-origin' }) };
  } catch (error) {
    // Navigateur trop ancien : l'application fera la demande elle-même.
  }
})();
