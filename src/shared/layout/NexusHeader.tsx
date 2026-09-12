import React, { useState, useRef, useEffect } from 'react';
import {
  Compass,
  FileText,
  Video,
  Sparkles,
  Search,
  Download,
  Loader2,
  CheckCircle,
  Layers,
  TrendingUp,
  ChevronDown,
  User,
  Home,
  LogOut,
  Sliders,
  Globe,
  Package,
  Sun,
  Moon,
  Languages
} from 'lucide-react';
import { MarketAnalysisReport } from '@/shared/types/analysis';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import { useAuth } from '@/features/auth/AuthContext';

export type StrategicTab = 'cockpit' | 'radar' | 'veille' | 'products' | 'meta_ads' | 'pdf_report' | 'kit_lancement' | 'distribution' | 'affiliation' | 'storybook' | 'pages_produits' | 'multilingue' | 'campagnes';

interface NexusHeaderProps {
  activeTab: StrategicTab;
  setActiveTab: (tab: StrategicTab) => void;
  currentReport: MarketAnalysisReport;
  allReports: MarketAnalysisReport[];
  onSelectReport: (report: MarketAnalysisReport) => void;
  onSearchNewNiche: (query: string) => Promise<void>;
  isSearching: boolean;
  onExportPDF: () => void;
  isExportingPDF: boolean;
  onOpenAccount?: () => void;
  onOpenLanding?: () => void;
}

interface ModuleInfo {
  id: StrategicTab;
  title: string;
  shortName: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tag: string;
  badgeColor: string;
}

import { usePreferences } from '@/app/providers/PreferencesContext';

export const NexusHeader: React.FC<NexusHeaderProps> = ({
  activeTab,
  setActiveTab,
  currentReport,
  allReports,
  onSelectReport,
  onSearchNewNiche,
  isSearching,
  onExportPDF,
  isExportingPDF,
  onOpenAccount,
  onOpenLanding,
}) => {
  const { user, isAuthenticated, logout, setViewMode } = useAuth();
  const { theme, toggleTheme, language, toggleLanguage, t } = usePreferences();
  const isDarkMode = theme === 'dark';
  const currentLang = language;

  const [searchInput, setSearchInput] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim() || isSearching) return;
    await onSearchNewNiche(searchInput.trim());
    setSearchInput('');
    setShowSearchModal(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 shadow-xs font-sans transition-colors duration-300">
      {/* Top Banner with Brand, Status Pill & Quick Actions */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* Logo & Brand Identity */}
          <div className="flex items-center gap-3.5">
            <button
              onClick={() => {
                if (onOpenLanding) onOpenLanding();
                else setViewMode('landing');
              }}
              className="text-left focus:outline-none"
              title="Aller à la page d'accueil"
            >
              <BrandLogo size="md" />
            </button>
          </div>

          {/* Center / Right: Niche Selector, Live Search & User Menu */}
          <div className="flex items-center gap-2.5">
            {/* Quick Niche Dropdown */}
            <div className="relative hidden lg:block">
              <select
                className="appearance-none bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-medium pl-3 pr-8 py-2 rounded-lg border border-slate-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={currentReport.id}
                onChange={(e) => {
                  const found = allReports.find((r) => r.id === e.target.value);
                  if (found) onSelectReport(found);
                }}
              >
                {allReports.map((r) => (
                  <option key={r.id} value={r.id}>
                    🎯 {r.nicheName.length > 28 ? r.nicheName.substring(0, 26) + '...' : r.nicheName}
                  </option>
                ))}
              </select>
            </div>

            {/* Language Toggle Button */}
            <button
              onClick={toggleLanguage}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-xs border border-slate-200 dark:border-slate-700 transition-colors"
              title={currentLang === 'FR' ? "Passer en Anglais" : "Switch to French"}
            >
              <Languages className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
              <span>{currentLang}</span>
            </button>

            {/* Dark Mode Toggle Button */}
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors"
              title={isDarkMode ? "Passer au thème clair" : "Passer au thème sombre"}
            >
              {isDarkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-indigo-500" />}
            </button>

            {/* AI Web Search Trigger Button */}
            <button
              onClick={() => setShowSearchModal(true)}
              className="flex items-center gap-2 bg-slate-900 hover:bg-indigo-600 text-white text-xs font-semibold px-3 sm:px-4 py-2 rounded-lg transition-colors shadow-xs"
              title={t("Lancer une analyse de veille sur le Web", "Launch a web intelligence analysis")}
            >
              {isSearching ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span className="hidden sm:inline">{t("Recherche...", "Searching...")}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>{t("Analyser une niche", "Analyze a niche")}</span>
                </>
              )}
            </button>

            {/* Quick 1-Click PDF Export */}
            <button
              onClick={onExportPDF}
              disabled={isExportingPDF}
              className="hidden sm:flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors shadow-xs"
              title={t("Télécharger le rapport PDF complet", "Download the complete PDF report")}
            >
              {isExportingPDF ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{t("Dossier PDF", "PDF Report")}</span>
            </button>

            {/* User Profile / Mon Compte Dropdown */}
            <div className="relative" ref={userMenuRef}>
              {isAuthenticated && user ? (
                <button
                  type="button"
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="flex items-center gap-2 p-1 pl-1.5 sm:px-2.5 sm:py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
                >
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-7 h-7 rounded-full object-cover ring-1 ring-slate-300"
                  />
                  <div className="hidden md:block text-left">
                    <p className="text-xs font-bold text-slate-800 leading-tight">
                      {user.name.split(' ')[0]}
                    </p>
                    <span className="text-[10px] text-indigo-600 font-semibold leading-none">
                      {user.plan}
                    </span>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 hidden sm:block transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setViewMode('login')}
                  className="text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-slate-200 dark:border-slate-700"
                >
                  {t("Connexion", "Sign In")}
                </button>
              )}

              {/* User Menu Dropdown */}
              {isUserMenuOpen && isAuthenticated && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 mb-1">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{user?.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user?.email}</p>
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-md text-[9px] font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50">
                      {t("Membre Plan", "Plan Member")} {user?.plan}
                    </span>
                  </div>

                  <div className="space-y-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        if (onOpenAccount) onOpenAccount();
                        else setViewMode('account');
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-2 transition-colors"
                    >
                      <User className="w-4 h-4 text-slate-400" />
                      <span>{t("Mon Compte (Profil)", "My Account (Profile)")}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        if (onOpenLanding) onOpenLanding();
                        else setViewMode('landing');
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-2 transition-colors"
                    >
                      <Home className="w-4 h-4 text-slate-400" />
                      <span>{t("Page d'accueil", "Home Page")}</span>
                    </button>

                    <div className="pt-1 border-t border-slate-100 dark:border-slate-800 mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          logout();
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-600 dark:text-rose-400 flex items-center gap-2 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>{t("Se déconnecter", "Sign out")}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>

        </div>
      </div>

      {/* Modal for Web AI Niche Analysis */}
      {showSearchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Analyse de Veille Stratégique par le Web
                  </h3>
                  <p className="text-xs text-slate-500">
                    Sondez les tendances du web, la concurrence, les taux et les formats de produits digitaux.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSearchModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSearchSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Thématique, Mot-clé ou Produit Digital à sonder
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  <input
                    type="text"
                    required
                    placeholder="Ex: Notion prompts pour agences, formation montage vidéo TikTok, guide santé microbiote..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
                  />
                </div>
              </div>

              {/* Quick suggestion tags */}
              <div>
                <span className="text-[11px] font-semibold text-slate-500 block mb-2">
                  Suggestions à explorer en 1 clic :
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Templates Notion IA & Automatisation',
                    'Guide Nutrition & Fatigue Chronique',
                    'Formation Ads TikTok pour E-Commerçants',
                    'Pack Prompts ChatGPT Copywriting',
                    'Micro-SaaS & Outils No-Code Solopreneurs',
                  ].map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => setSearchInput(sug)}
                      className="text-xs bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 px-2.5 py-1 rounded-md border border-slate-200/80 transition-colors"
                    >
                      + {sug}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <p className="text-[11px] text-slate-500 flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                  Analyse de la demande, notation par taux et scripts Meta Ads inclus
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSearchModal(false)}
                    className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={!searchInput.trim() || isSearching}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-xs disabled:opacity-50"
                  >
                    {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    <span>Lancer la veille Web</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
