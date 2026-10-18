import type { Permission } from '@/shared/types/auth';

/**
 * Ce qu'un membre de l'équipe peut faire sur un compte, depuis la liste des utilisateurs (menu « ⋯ »)
 * comme depuis sa fiche : mêmes règles que le serveur.
 *
 * Le 18/10/2026, le propriétaire ne trouvait ni « Bloquer », ni « Supprimer », ni « Recharger » : ils
 * n'étaient que sur la fiche d'un compte, que rien dans la liste ne désignait. Le menu de chaque ligne
 * mène à la fiche, la fenêtre demandée déjà ouverte.
 */

export type UserAction = 'points' | 'palier' | 'deconnecter' | 'bloquer' | 'supprimer';

const USER_ACTIONS: readonly UserAction[] = ['points', 'palier', 'deconnecter', 'bloquer', 'supprimer'];

export interface ActionViewer {
  id: string;
  role: string;
  permissions: readonly Permission[];
}

export interface ActionTarget {
  id: string;
  role: string;
}

/** Fonction pure : les actions que `viewer` peut mener sur `target`, dans l'ordre du menu. */
export function userActionsFor(viewer: ActionViewer, target: ActionTarget): UserAction[] {
  const isAdmin = viewer.role === 'admin';
  const isSelf = viewer.id === target.id;
  // Un compte administrateur ne se modifie que par un administrateur.
  if (!isAdmin && (target.role === 'admin' || isSelf)) return [];
  const has = (permission: Permission) => viewer.permissions.includes(permission);
  const actions: UserAction[] = [];
  if (has('admin.credits.grant')) actions.push('points');
  if (has('admin.users.manage')) actions.push('palier');
  // Sur son propre compte : ni se déconnecter, ni se bloquer, ni se supprimer d'ici (Mon compte s'en charge).
  if (has('admin.users.manage') && !isSelf) actions.push('deconnecter', 'bloquer');
  if (isAdmin && !isSelf) actions.push('supprimer');
  return actions;
}

/** Adresse de la fiche, la fenêtre de l'action déjà ouverte. */
export const userActionHref = (userId: string, action: UserAction) => `/app/admin/utilisateurs/${userId}?action=${action}`;

/** L'action demandée par l'adresse, ou null. */
export function readUserAction(value: string | null): UserAction | null {
  return USER_ACTIONS.find((action) => action === value) ?? null;
}
