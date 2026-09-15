/**
 * Fin d'une session : pourquoi une personne n'est plus connectée.
 *
 * Module pur, partagé avec le site : l'historique des connexions de
 * l'administration affiche ces mêmes libellés.
 */

export const SESSION_END_REASONS = [
  'logout',
  'logout_all',
  'revoked_by_user',
  'revoked_by_staff',
  'suspended',
  'password_changed',
  'password_reset',
  'second_factor_changed',
  'second_factor_reset',
  'privileges_changed',
  'role_changed',
  'replaced',
  'idle',
  'expired',
] as const;

export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

export const SESSION_END_LABELS: Record<SessionEndReason, string> = {
  logout: 'Déconnexion',
  logout_all: 'Déconnexion de tous les appareils',
  revoked_by_user: 'Fermée depuis Mon compte',
  revoked_by_staff: 'Déconnectée par l’équipe',
  suspended: 'Compte bloqué',
  password_changed: 'Mot de passe changé',
  password_reset: 'Mot de passe réinitialisé',
  second_factor_changed: 'Second facteur modifié',
  second_factor_reset: 'Second facteur réinitialisé',
  privileges_changed: 'Privilèges modifiés',
  role_changed: 'Rôle modifié',
  replaced: 'Nouvelle connexion sur ce navigateur',
  idle: 'Inactivité',
  expired: 'Durée maximale atteinte',
};

/**
 * Fins sans geste de la personne : un site ne sait pas quand un onglet se ferme.
 * L'heure de déconnexion retenue est alors celle de sa dernière activité.
 */
export const PASSIVE_END_REASONS: readonly SessionEndReason[] = ['idle', 'expired'];

export function sessionEndLabel(reason: string | null): string {
  if (!reason) return 'Session ouverte';
  return (SESSION_END_LABELS as Record<string, string>)[reason] ?? reason;
}
