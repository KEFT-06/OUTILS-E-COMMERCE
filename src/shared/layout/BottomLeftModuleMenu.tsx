import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Radar,
  Telescope,
  Package,
  Clapperboard,
  FileText,
  Rocket,
  Store,
  Users,
  BookOpen,
  LayoutTemplate,
  Languages,
  Megaphone,
  Grid3x3,
  LayoutGrid,
  X,
  ChevronRight,
} from 'lucide-react';
import type { StrategicTab } from '@/shared/layout/NexusHeader';
import { usePreferences } from '@/app/providers/PreferencesContext';

interface BottomLeftModuleMenuProps {
  activeTab: StrategicTab;
  setActiveTab: (tab: StrategicTab) => void;
  currentNicheName: string;
}

interface ModuleEntry {
  id: StrategicTab;
  num: string;
  fr: string;
  en: string;
  descFr: string;
  descEn: string;
  icon: React.ComponentType<{ className?: string }>;
  /** false = module encore en placeholder (cf. docs/ROADMAP.md) */
  ready: boolean;
}

/**
 * Les 14 entrées correspondent une à une aux onglets rendus par App.tsx.
 * L'ordre suit la numérotation du cahier des charges, pas l'ordre d'implémentation :
 * la galerie partage le numéro 01 parce qu'elle fait partie du module Radar.
 */
const MODULES: readonly ModuleEntry[] = [
  { id: 'cockpit', num: '00', fr: 'Cockpit Créateur', en: 'Creator Cockpit', descFr: 'Performances, solde IA et plan d’action', descEn: 'Performance, AI balance and action plan', icon: LayoutDashboard, ready: true },
  { id: 'radar', num: '01', fr: 'Radar Marché', en: 'Market Radar', descFr: 'Détection des niches en accélération', descEn: 'Detection of accelerating niches', icon: Radar, ready: true },
  { id: 'ad_gallery', num: '01', fr: 'Galerie Publicitaire', en: 'Ad Gallery', descFr: 'Publicités, swipe file et fiches annonceurs', descEn: 'Ads, swipe file and advertiser sheets', icon: LayoutGrid, ready: true },
  { id: 'veille', num: '02', fr: 'Analyse Stratégique', en: 'Strategic Analysis', descFr: 'Les 5 taux et le benchmark concurrentiel', descEn: 'The 5 rates and competitive benchmark', icon: Telescope, ready: true },
  { id: 'products', num: '03', fr: 'Studio de Création', en: 'Creation Studio', descFr: 'Ebooks, templates et rentabilité', descEn: 'Ebooks, templates and profitability', icon: Package, ready: true },
  { id: 'meta_ads', num: '04', fr: 'Créatifs Publicitaires', en: 'Ad Creatives', descFr: 'Scripts vidéo AIDA et PAS', descEn: 'AIDA and PAS video scripts', icon: Clapperboard, ready: true },
  { id: 'kit_lancement', num: '05', fr: 'Kit de Lancement', en: 'Launch Kit', descFr: 'Copie publicitaire et pages de vente', descEn: 'Ad copy and sales pages', icon: Rocket, ready: false },
  { id: 'distribution', num: '06', fr: 'Distribution', en: 'Distribution', descFr: 'Connecteurs marketplace', descEn: 'Marketplace connectors', icon: Store, ready: true },
  { id: 'affiliation', num: '07', fr: 'Affiliation', en: 'Affiliate Program', descFr: 'Liens UTM et commissions', descEn: 'UTM links and commissions', icon: Users, ready: false },
  { id: 'storybook', num: '08', fr: 'Storybook Africain', en: 'African Storybook', descFr: 'Contes illustrés ancrés culturellement', descEn: 'Culturally grounded illustrated tales', icon: BookOpen, ready: true },
  { id: 'pages_produits', num: '09', fr: 'Pages Produits', en: 'Product Pages', descFr: 'Pages orientées conversion', descEn: 'Conversion-oriented pages', icon: LayoutTemplate, ready: true },
  { id: 'multilingue', num: '10', fr: 'Guides Multilingues', en: 'Multilingual Guides', descFr: 'Tiers A, B et C avec relecteurs natifs', descEn: 'Tiers A, B and C with native reviewers', icon: Languages, ready: false },
  { id: 'campagnes', num: '11', fr: 'Structures de Campagnes', en: 'Campaign Structures', descFr: 'Blueprints Meta et TikTok', descEn: 'Meta and TikTok blueprints', icon: Megaphone, ready: true },
  { id: 'pdf_report', num: '12', fr: 'Dossier PDF Illustré', en: 'Illustrated PDF Report', descFr: 'Export haute définition A4', descEn: 'High-definition A4 export', icon: FileText, ready: true },
] as const;

export const BottomLeftModuleMenu: React.FC<BottomLeftModuleMenuProps> = ({
  activeTab,
  setActiveTab,
  currentNicheName,
}) => {
  const { t, language } = usePreferences();
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, close]);

  const current = MODULES.find((m) => m.id === activeTab) ?? MODULES[0];

  const handleSelect = (id: StrategicTab) => {
    setActiveTab(id);
    setIsOpen(false);
  };

  return (
    <div className="fixed bottom-5 left-5 z-50 print:hidden">
      {isOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={t('Navigation entre les modules', 'Module navigation')}
          className="glass-1 mb-3 w-[min(22rem,calc(100vw-2.5rem))] overflow-hidden rounded-3xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="min-w-0">
              <p className="font-display text-sm font-black tracking-tight text-[var(--text-primary)]">
                {t('Modules Smart Creator', 'Smart Creator Modules')}
              </p>
              <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                {t('Niche active', 'Active niche')} : {currentNicheName}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t('Fermer le menu', 'Close menu')}
              className="shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-slate-500/10 hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <ul className="max-h-[min(26rem,60vh)] overflow-y-auto p-2">
            {MODULES.map((mod) => {
              const Icon = mod.icon;
              const isActive = mod.id === activeTab;
              return (
                <li key={mod.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(mod.id)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                      isActive
                        ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300'
                        : 'text-[var(--text-primary)] hover:bg-slate-500/8'
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        isActive ? 'bg-indigo-600 text-white' : 'bg-slate-500/10 text-[var(--text-muted)]'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold text-[var(--text-muted)]">
                          {mod.num}
                        </span>
                        <span className="truncate text-xs font-bold">
                          {language === 'EN' ? mod.en : mod.fr}
                        </span>
                        {!mod.ready && (
                          <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                            {t('bientôt', 'soon')}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">
                        {language === 'EN' ? mod.descEn : mod.descFr}
                      </span>
                    </span>

                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="glass-1 flex items-center gap-3 rounded-2xl py-2.5 pl-3 pr-4 transition-transform hover:scale-[1.02] active:scale-[0.98]"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <Grid3x3 className="h-4 w-4" />
        </span>
        <span className="text-left">
          <span className="block font-mono text-[10px] font-bold leading-none text-[var(--text-muted)]">
            {t('MODULE', 'MODULE')} {current.num}
          </span>
          <span className="mt-0.5 block text-xs font-bold leading-none text-[var(--text-primary)]">
            {language === 'EN' ? current.en : current.fr}
          </span>
        </span>
      </button>
    </div>
  );
};
