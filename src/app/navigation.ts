import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Clapperboard,
  FileText,
  Languages,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  Megaphone,
  Package,
  Radar,
  Rocket,
  Store,
  Telescope,
  Users,
} from 'lucide-react';

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
  | 'radar'
  | 'galerie'
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
    id: 'radar',
    path: '/app/radar',
    group: 'voir',
    label: { fr: 'Radar marché', en: 'Market radar' },
    description: { fr: 'Repérer les niches qui accélèrent', en: 'Spot accelerating niches' },
    icon: Radar,
    ready: true,
  },
  {
    id: 'galerie',
    path: '/app/galerie',
    group: 'voir',
    label: { fr: 'Galerie publicitaire', en: 'Ad gallery' },
    description: { fr: 'Publicités, swipe file et annonceurs', en: 'Ads, swipe file and advertisers' },
    icon: LayoutGrid,
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
    label: { fr: 'Storybook africain', en: 'African storybook' },
    description: { fr: 'Contes illustrés ancrés localement', en: 'Locally grounded illustrated tales' },
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
    description: { fr: 'Guides relus par des locuteurs natifs', en: 'Guides reviewed by native speakers' },
    icon: Languages,
    ready: false,
  },
];

export const ACCOUNT_PATH = '/app/compte';

export function findModule(pathname: string): ModuleEntry | undefined {
  return MODULES.find((entry) => pathname === entry.path || pathname.startsWith(`${entry.path}/`));
}

export function pathOf(id: ModuleId): string {
  const entry = MODULES.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Module inconnu : ${id}`);
  return entry.path;
}
