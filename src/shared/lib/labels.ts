/**
 * Libellés français des valeurs techniques renvoyées par l'API (raisons de
 * mouvements de points, types de contenus, formats, moyens de paiement, actions
 * du journal). Une valeur inconnue s'affiche telle quelle plutôt que vide.
 */

export const CREDIT_REASON_LABELS: Record<string, string> = {
  plan_cycle: 'Quota mensuel',
  usage: 'Utilisation',
  refund: 'Points rendus',
  admin_grant: 'Ajustement par l’administration',
  plan_change: 'Changement de palier',
};

export const GENERATION_KIND_LABELS: Record<string, string> = {
  video: 'Vidéos',
  image: 'Visuels',
  storybook: 'Storybooks',
  ebook: 'Ebooks',
  product_page: 'Pages produits',
  report_pdf: 'Dossiers PDF',
  swipe_file: 'Swipe files',
  launch_kit: 'Kits de lancement',
  ad_scan: 'Collectes de publicités',
  guide_translation: 'Traductions de guides',
  cover: 'Couvertures',
  niche_analysis: 'Analyses de niche',
  product_writing: 'Rédactions de produits',
  launch_kit_writing: 'Rédactions de kits de lancement',
};

export const FILE_FORMAT_LABELS: Record<string, string> = {
  mp4: 'Vidéo MP4',
  mp3: 'Audio MP3',
  png: 'Image PNG',
  pdf: 'Document PDF',
  docx: 'Document Word',
  html: 'Page HTML',
  csv: 'Tableur CSV',
  txt: 'Texte',
  lien: 'Lien de consultation',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  mobile_money: 'Mobile Money',
  card: 'Carte bancaire',
  bank_transfer: 'Virement',
  cash: 'Espèces',
  chariow: 'Chariow',
  other: 'Autre',
};

export const GENERATION_STATUS_LABELS: Record<string, string> = {
  pending: 'En cours',
  completed: 'Terminée',
  failed: 'Échouée',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'admin.bootstrap_created': 'Compte administrateur créé (ligne de commande)',
  'admin.bootstrap_promoted': 'Compte promu administrateur (ligne de commande)',
  'user.created': 'Compte créé',
  'user.plan_changed': 'Palier modifié',
  'user.suspended': 'Compte bloqué',
  'user.reactivated': 'Compte débloqué',
  'credits.granted': 'Points ajoutés',
  'credits.removed': 'Points retirés',
  'credits.plan_refilled': 'Quota mensuel rechargé',
  'feature.granted': 'Fonction accordée',
  'feature.revoked': 'Fonction retirée',
  'feature.reset': 'Fonction remise selon le palier',
  'permissions.updated': 'Privilèges modifiés',
  'role.changed': 'Rôle modifié',
  'sessions.revoked': 'Sessions fermées',
  'password.link_created': 'Lien de mot de passe créé',
  'two_factor.reset': 'Double authentification réinitialisée',
  'payment.recorded': 'Paiement enregistré',
  'payment.refunded': 'Paiement remboursé',
  'security.unlocked': 'Verrou de connexion levé',
  'creative.viewed': 'Vidéo ou visuel d’un compte ouvert',
  'creative.downloaded': 'Vidéo ou visuel d’un compte téléchargé',
};

export function labelOf(labels: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '—';
  return labels[value] ?? value;
}
