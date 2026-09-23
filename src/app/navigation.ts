import type { LucideIcon } from 'lucide-react';
import {
  PlugZap,
  Banknote,
  BookOpen,
  Clapperboard,
  Compass,
  Eye,
  FileText,
  Film,
  Gauge,
  History,
  Languages,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  Package,
  Radar,
  Rocket,
  ShieldAlert,
  Store,
  Telescope,
  Users,
  UsersRound,
  ChartLine,
  Mail,
} from 'lucide-react';
import type { Permission } from '@/shared/types/auth';

/**
 * Carte de l'application : chaque écran a une adresse, un groupe et un libellé.
 *
 * Les groupes suivent le parcours vendu sur l'accueil — VOIR le marché, CRÉER
 * le produit, le VENDRE. La barre latérale, la palette ⌘K, le fil d'Ariane et la
 * barre mobile lisent tous cette même liste : un module ajouté ici apparaît
 * partout, un module retiré disparaît partout.
 */

export type ModuleGroup = 'voir' | 'creer' | 'vendre';

export type ModuleId =
  | 'cockpit'
  | 'niches'
  | 'radar'
  | 'espionnage'
  | 'analyse'
  | 'dossier-pdf'
  | 'studio'
  | 'creatifs'
  | 'storybook'
  | 'pages-produits'
  | 'kit-lancement'
  | 'campagnes'
  | 'distribution'
  | 'affiliation'
  | 'multilingue';

export interface Bilingual {
  fr: string;
  en: string;
}

export interface ModuleEntry {
  id: ModuleId;
  path: `/app/${string}`;
  group: ModuleGroup;
  label: Bilingual;
  description: Bilingual;
  icon: LucideIcon;
  /** false : écran pas encore construit, affiché « bientôt ». */
  ready: boolean;
}

export const MODULE_GROUPS: readonly { id: ModuleGroup; label: Bilingual }[] = [
  { id: 'voir', label: { fr: 'Voir', en: 'See' } },
  { id: 'creer', label: { fr: 'Créer', en: 'Create' } },
  { id: 'vendre', label: { fr: 'Vendre', en: 'Sell' } },
];

export const MODULES: readonly ModuleEntry[] = [
  {
    id: 'cockpit',
    path: '/app/cockpit',
    group: 'voir',
    label: { fr: 'Cockpit', en: 'Cockpit' },
    description: { fr: 'Solde, ventes et plan d’action', en: 'Balance, sales and action plan' },
    icon: LayoutDashboard,
    ready: true,
  },
  {
    id: 'niches',
    path: '/app/niches',
    group: 'voir',
    label: { fr: 'Niches', en: 'Niches' },
    description: { fr: 'Toutes les niches, tous secteurs', en: 'Every niche, every sector' },
    icon: Compass,
    ready: true,
  },
  {
    id: 'radar',
    path: '/app/radar',
    group: 'voir',
    label: { fr: 'Radar', en: 'Radar' },
    description: { fr: 'Ce qui bouge chez vos concurrents', en: 'What moves at your competitors' },
    icon: Radar,
    ready: true,
  },
  {
    id: 'espionnage',
    path: '/app/espionnage',
    group: 'voir',
    label: { fr: 'Espionnage', en: 'Ad spy' },
    description: { fr: 'Les publicités qui tournent chez les autres', en: 'Ads running at others' },
    icon: Eye,
    ready: true,
  },
  {
    id: 'analyse',
    path: '/app/analyse',
    group: 'voir',
    label: { fr: 'Analyse stratégique', en: 'Strategic analysis' },
    description: { fr: 'Les 5 taux et la concurrence', en: 'The 5 rates and competition' },
    icon: Telescope,
    ready: true,
  },
  {
    id: 'dossier-pdf',
    path: '/app/dossier-pdf',
    group: 'voir',
    label: { fr: 'Dossier PDF', en: 'PDF report' },
    description: { fr: 'Le rapport A4 à télécharger', en: 'The downloadable A4 report' },
    icon: FileText,
    ready: true,
  },
  {
    id: 'studio',
    path: '/app/studio',
    group: 'creer',
    label: { fr: 'Studio de création', en: 'Creation studio' },
    description: { fr: 'Ebooks, templates et rentabilité', en: 'Ebooks, templates and profitability' },
    icon: Package,
    ready: true,
  },
  {
    id: 'creatifs',
    path: '/app/creatifs',
    group: 'creer',
    label: { fr: 'Créatifs publicitaires', en: 'Ad creatives' },
    description: { fr: 'Visuels, vidéos et scripts', en: 'Visuals, videos and scripts' },
    icon: Clapperboard,
    ready: true,
  },
  {
    id: 'storybook',
    path: '/app/storybook',
    group: 'creer',
    label: { fr: 'Storybook illustré', en: 'Illustrated storybook' },
    description: { fr: 'Contes illustrés ancrés dans un pays', en: 'Illustrated tales grounded in a country' },
    icon: BookOpen,
    ready: true,
  },
  {
    id: 'pages-produits',
    path: '/app/pages-produits',
    group: 'creer',
    label: { fr: 'Pages produits', en: 'Product pages' },
    description: { fr: 'Pages de vente en 7 sections', en: '7-section sales pages' },
    icon: LayoutTemplate,
    ready: true,
  },
  {
    id: 'kit-lancement',
    path: '/app/kit-lancement',
    group: 'vendre',
    label: { fr: 'Kit de lancement', en: 'Launch kit' },
    description: { fr: 'Textes, scripts et boutons par marché', en: 'Copy, scripts and buttons by market' },
    icon: Rocket,
    ready: true,
  },
  {
    id: 'campagnes',
    path: '/app/campagnes',
    group: 'vendre',
    label: { fr: 'Structures de campagnes', en: 'Campaign structures' },
    description: { fr: 'Modèles Meta et TikTok', en: 'Meta and TikTok templates' },
    icon: Megaphone,
    ready: true,
  },
  {
    id: 'distribution',
    path: '/app/distribution',
    group: 'vendre',
    label: { fr: 'Distribution', en: 'Distribution' },
    description: { fr: 'Catalogue et ventes des marketplaces', en: 'Marketplace catalogue and sales' },
    icon: Store,
    ready: true,
  },
  {
    id: 'affiliation',
    path: '/app/affiliation',
    group: 'vendre',
    label: { fr: 'Affiliation', en: 'Affiliation' },
    description: { fr: 'Liens UTM, suivi et invitations', en: 'UTM links, tracking and invitations' },
    icon: Users,
    ready: true,
  },
  {
    id: 'multilingue',
    path: '/app/multilingue',
    group: 'creer',
    label: { fr: 'Guides multilingues', en: 'Multilingual guides' },
    description: { fr: 'Traduire, relire et exporter vos guides', en: 'Translate, review and export your guides' },
    icon: Languages,
    ready: true,
  },
];

export const ACCOUNT_PATH = '/app/compte';

/**
 * Administration : visible des seuls comptes qui détiennent le privilège de la
 * section. Le serveur refuse de toute façon ; masquer évite de proposer une porte
 * fermée.
 */
export interface AdminSection {
  id: 'overview' | 'users' | 'connections' | 'messages' | 'audience' | 'revenue' | 'content' | 'services' | 'security';
  path: `/app/admin${string}`;
  label: string;
  description: string;
  icon: LucideIcon;
  permission: Permission;
}

export const ADMIN_PATH = '/app/admin';

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: 'overview',
    path: '/app/admin',
    label: 'Vue d’ensemble',
    description: 'Revenus, utilisateurs en ligne et contenus créés',
    icon: Gauge,
    permission: 'admin.dashboard.read',
  },
  {
    id: 'users',
    path: '/app/admin/utilisateurs',
    label: 'Utilisateurs',
    description: 'Comptes, paliers, crédits et privilèges',
    icon: UsersRound,
    permission: 'admin.users.read',
  },
  {
    id: 'connections',
    path: '/app/admin/connexions',
    label: 'Connexions',
    description: 'Heures de connexion et de déconnexion de chaque utilisateur',
    icon: History,
    permission: 'admin.users.read',
  },
  {
    id: 'messages',
    path: '/app/admin/messages',
    label: 'Messages',
    description: 'Messages reçus par la page Contact',
    icon: Mail,
    permission: 'admin.users.read',
  },
  {
    id: 'audience',
    path: '/app/admin/audience',
    label: 'Audience',
    description: 'Visiteurs du site, pages vues et inscriptions, sans cookie',
    icon: ChartLine,
    permission: 'admin.dashboard.read',
  },
  {
    id: 'revenue',
    path: '/app/admin/revenus',
    label: 'Revenus',
    description: 'Abonnements par jour, mois et année',
    icon: Banknote,
    permission: 'admin.revenue.read',
  },
  {
    id: 'content',
    path: '/app/admin/contenus',
    label: 'Contenus créés',
    description: 'Vidéos, visuels, ebooks, storybooks et fichiers',
    icon: Film,
    permission: 'admin.dashboard.read',
  },
  {
    id: 'services',
    path: '/app/admin/services',
    label: 'État des services',
    description: 'IA et services branchés, clés, crédits et adresse IP',
    icon: PlugZap,
    permission: 'admin.security.read',
  },
  {
    id: 'security',
    path: '/app/admin/securite',
    label: 'Sécurité',
    description: 'Connexions, verrous et journal d’audit',
    icon: ShieldAlert,
    permission: 'admin.security.read',
  },
];

export function findAdminSection(pathname: string): AdminSection | undefined {
  if (pathname === ADMIN_PATH || pathname === `${ADMIN_PATH}/`) return ADMIN_SECTIONS[0];
  return ADMIN_SECTIONS.slice(1).find((section) => pathname === section.path || pathname.startsWith(`${section.path}/`));
}

export function visibleAdminSections(permissions: readonly Permission[]): AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => permissions.includes(section.permission));
}

export function findModule(pathname: string): ModuleEntry | undefined {
  return MODULES.find((entry) => pathname === entry.path || pathname.startsWith(`${entry.path}/`));
}

export function pathOf(id: ModuleId): string {
  const entry = MODULES.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Module inconnu : ${id}`);
  return entry.path;
}
