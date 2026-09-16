/**
 * Privilèges d'administration.
 *
 * Un compte « admin » les détient tous. Un compte « user » peut en recevoir
 * certains, un par un, pour déléguer sans tout ouvrir : un membre de l'équipe qui
 * recharge des crédits n'a pas besoin de voir les revenus.
 *
 * Deux pouvoirs restent réservés au rôle admin et ne se délèguent pas : changer le
 * rôle d'un compte et attribuer des privilèges. Délégués, ils permettraient à
 * quiconque les reçoit de s'accorder tout le reste.
 */

export const PERMISSIONS = {
  'admin.dashboard.read': {
    label: 'Voir le tableau de bord',
    description: 'Indicateurs d’usage, contenus créés et utilisateurs en ligne.',
  },
  'admin.users.read': {
    label: 'Consulter les utilisateurs',
    description: 'Liste des comptes, fiches, sessions et consommation de crédits.',
  },
  'admin.users.manage': {
    label: 'Gérer les utilisateurs',
    description: 'Changer le palier, bloquer, ouvrir ou retirer une fonction, déconnecter, créer un lien de réinitialisation.',
  },
  'admin.credits.grant': {
    label: 'Recharger des crédits',
    description: 'Ajouter ou retirer des points sur le solde d’un utilisateur.',
  },
  'admin.revenue.read': {
    label: 'Voir les revenus',
    description: 'Chiffre d’affaires des abonnements par jour, mois et année, et liste des paiements.',
  },
  'admin.payments.record': {
    label: 'Enregistrer des paiements',
    description: 'Saisir un paiement d’abonnement, qui active le palier, ou le rembourser.',
  },
  'admin.content.view': {
    label: 'Voir les vidéos et visuels créés',
    description: 'Ouvrir et télécharger les vidéos et visuels générés par les comptes. Chaque ouverture est inscrite au journal d’audit.',
  },
  'admin.security.read': {
    label: 'Voir la sécurité et le journal',
    description: 'Tentatives de connexion, verrous et journal des actions d’administration.',
  },
  'guides.review': {
    label: 'Relire des guides (réseau de relecteurs)',
    description:
      'Prendre en charge les demandes de relecture native dans ses langues maternelles, et corriger les traductions confiées. Le relecteur ne voit un guide qu’après l’avoir pris en charge.',
  },
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_IDS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

export function effectivePermissions(role: 'user' | 'admin', granted: readonly string[]): Permission[] {
  return role === 'admin' ? [...PERMISSION_IDS] : granted.filter(isPermission);
}
