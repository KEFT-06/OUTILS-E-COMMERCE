import React from 'react';
import { ActiveTab, ViewportMode } from '../types';
import { Monitor, Tablet, Smartphone, Sparkles, LayoutTemplate, Sliders, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  viewport: ViewportMode;
  setViewport: (vp: ViewportMode) => void;
  onOpenBrief: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  viewport,
  setViewport,
  onOpenBrief,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-stone-200 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* Logo & Identity */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('showcase')}>
            <div className="w-10 h-10 rounded-xl bg-stone-900 text-white flex items-center justify-center font-bold text-lg shadow-sm">
              SW
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-stone-900 text-base sm:text-lg tracking-tight">Studio Web</span>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Création Active
                </span>
              </div>
              <p className="text-xs text-stone-500 hidden sm:block">Conception de sites web modernes & performants</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center space-x-1 sm:space-x-2 bg-stone-100 p-1 rounded-xl">
            <button
              id="tab-showcase"
              onClick={() => setActiveTab('showcase')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'showcase'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
              }`}
            >
              <LayoutTemplate className="w-4 h-4" />
              <span>Exemples Réels</span>
            </button>

            <button
              id="tab-builder"
              onClick={() => setActiveTab('builder')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'builder'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Personnaliseur</span>
            </button>

            <button
              id="tab-features"
              onClick={() => setActiveTab('features')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'features'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span className="hidden md:inline">Capacités & Stack</span>
              <span className="md:hidden">Stack</span>
            </button>
          </nav>

          {/* Viewport simulation and Quick Brief CTA */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {activeTab !== 'features' && (
              <div className="hidden lg:flex items-center bg-stone-100 p-1 rounded-lg border border-stone-200">
                <button
                  id="viewport-desktop"
                  onClick={() => setViewport('desktop')}
                  title="Écran Ordinateur"
                  className={`p-1.5 rounded-md transition-colors ${
                    viewport === 'desktop' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-500 hover:text-stone-900'
                  }`}
                >
                  <Monitor className="w-4 h-4" />
                </button>
                <button
                  id="viewport-tablet"
                  onClick={() => setViewport('tablet')}
                  title="Format Tablette (768px)"
                  className={`p-1.5 rounded-md transition-colors ${
                    viewport === 'tablet' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-500 hover:text-stone-900'
                  }`}
                >
                  <Tablet className="w-4 h-4" />
                </button>
                <button
                  id="viewport-mobile"
                  onClick={() => setViewport('mobile')}
                  title="Format Mobile (375px)"
                  className={`p-1.5 rounded-md transition-colors ${
                    viewport === 'mobile' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-500 hover:text-stone-900'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                </button>
              </div>
            )}

            <button
              id="cta-open-brief"
              onClick={onOpenBrief}
              className="flex items-center space-x-1.5 px-3 sm:px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs sm:text-sm font-medium rounded-lg transition-colors shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Décrire mon site</span>
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};
