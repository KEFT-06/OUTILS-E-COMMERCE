import React from 'react';
import {
  TrendingUp,
  Zap,
  ShoppingBag,
  CreditCard,
  Target,
  ArrowUpRight,
  Sparkles,
  BarChart3,
  Layers,
  Activity,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { MarketAnalysisReport } from '../../types/analysis';
import { usePreferences } from '../../context/PreferencesContext';

interface CockpitDashboardProps {
  report: MarketAnalysisReport;
  onNavigateToModule: (module: 'radar' | 'veille' | 'products' | 'meta_ads' | 'pdf_report') => void;
  onOpenBilling: () => void;
}

export const CockpitDashboard: React.FC<CockpitDashboardProps> = ({
  report,
  onNavigateToModule,
  onOpenBilling,
}) => {
  const { t } = usePreferences();
  // Mock Data pour le tableau de bord
  const creditsRemaining = 38;
  const creditsTotal = 100;
  const creditPercentage = (creditsRemaining / creditsTotal) * 100;

  const salesData = [
    { date: 'Lun', sales: 120 },
    { date: 'Mar', sales: 180 },
    { date: 'Mer', sales: 140 },
    { date: 'Jeu', sales: 240 },
    { date: 'Ven', sales: 310 },
    { date: 'Sam', sales: 280 },
    { date: 'Dim', sales: 390 },
  ];

  const maxSales = Math.max(...salesData.map(d => d.sales));

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header Dashboard */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Cockpit Créateur
          </h1>
          <p className="text-slate-500 mt-1">
            Vision consolidée de vos performances et ressources.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-white px-4 py-2 rounded-xl border border-slate-200/80 shadow-sm flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-slate-700">{t('Système En Ligne', 'System Online')}</span>
          </div>
        </div>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        
        {/* Module 1: Simulateur Crédits IA (Section 41) */}
        <div className="col-span-1 md:col-span-4 bg-white rounded-3xl border border-slate-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
            <Zap className="w-24 h-24 text-amber-500" />
          </div>
          
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <Zap className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">Solde IA (Research Points)</h2>
            </div>
            
            <div className="flex items-end gap-2 mb-2">
              <span className="text-4xl font-black tracking-tighter text-slate-900">{creditsRemaining}</span>
              <span className="text-sm font-semibold text-slate-500 mb-1">/ {creditsTotal} pts</span>
            </div>
            
            <div className="w-full bg-slate-100 rounded-full h-2.5 mb-2 overflow-hidden">
              <div 
                className={`h-2.5 rounded-full transition-all duration-1000 ${
                  creditPercentage > 50 ? 'bg-emerald-500' : creditPercentage > 20 ? 'bg-amber-500' : 'bg-rose-500'
                }`}
                style={{ width: `${creditPercentage}%` }}
              ></div>
            </div>
            
            <div className="flex items-center justify-between text-[11px] font-semibold mb-6">
              <span className="text-slate-500">Équivalent estimé :</span>
              <span className="text-slate-900">≈ 12 500 FCFA</span>
            </div>
            
            <button 
              onClick={onOpenBilling}
              className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-indigo-600 text-white text-xs font-bold transition-colors flex items-center justify-center gap-2"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Recharger le solde</span>
            </button>
          </div>
        </div>

        {/* Module 2: Boucle de Performance Réelle (Section 26) */}
        <div className="col-span-1 md:col-span-8 bg-white rounded-3xl border border-slate-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">Performance Réelle des Ventes</h2>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Agrégation Maketou & Taliopay</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-bold border border-emerald-100">
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>+24.5% ce mois</span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
              <p className="text-xs text-slate-500 font-semibold mb-1">Revenus (30j)</p>
              <p className="text-2xl font-black text-slate-900 tracking-tight">485k <span className="text-sm text-slate-500 font-semibold">FCFA</span></p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
              <p className="text-xs text-slate-500 font-semibold mb-1">Ventes nettes</p>
              <p className="text-2xl font-black text-slate-900 tracking-tight">124</p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
              <p className="text-xs text-slate-500 font-semibold mb-1">ROI Publicitaire</p>
              <p className="text-2xl font-black text-slate-900 tracking-tight">3.2x</p>
            </div>
          </div>

          {/* Mini Chart UI (CSS Grid bars) */}
          <div className="h-24 flex items-end justify-between gap-2">
            {salesData.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2 group">
                <div className="w-full bg-slate-100 rounded-t-md relative flex-1 flex items-end">
                  <div 
                    className="w-full bg-indigo-500/80 group-hover:bg-indigo-600 rounded-t-md transition-all duration-300 relative"
                    style={{ height: `${(d.sales / maxSales) * 100}%` }}
                  >
                    <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] font-bold py-1 px-2 rounded-md whitespace-nowrap transition-opacity">
                      {d.sales} ventes
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-slate-400">{d.date}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Module 3: Radar & Marchés Suivis */}
        <div className="col-span-1 md:col-span-6 bg-white rounded-3xl border border-slate-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Target className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">Marchés Suivis & Alertes</h2>
            </div>
            <button 
              onClick={() => onNavigateToModule('radar')}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              Voir le Radar <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3">
            {[
              { name: report.nicheName, score: 'Très Élevé', trend: '+12%', active: true },
              { name: 'Formation No-Code', score: 'Élevé', trend: '+5%', active: false },
              { name: 'Investissement Immo CI', score: 'Moyen', trend: '-2%', active: false },
            ].map((niche, i) => (
              <div key={i} className={`p-3 rounded-xl border flex items-center justify-between ${niche.active ? 'bg-indigo-50/50 border-indigo-200' : 'bg-slate-50 border-slate-100'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${niche.active ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                  <div>
                    <p className="text-xs font-bold text-slate-900">{niche.name}</p>
                    <p className="text-[10px] text-slate-500 font-medium">Tension: <span className="font-bold">{niche.score}</span></p>
                  </div>
                </div>
                <div className={`text-xs font-bold ${niche.trend.startsWith('+') ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {niche.trend}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Module 4: Plan d'Action en cours */}
        <div className="col-span-1 md:col-span-6 bg-white rounded-3xl border border-slate-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">Plan d'Action Actuel</h2>
            </div>
            <button 
              onClick={() => onNavigateToModule('veille')}
              className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1"
            >
              Ouvrir l'audit <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>

          <div className="relative">
            <div className="absolute left-3.5 top-2 bottom-2 w-0.5 bg-slate-100" />
            <div className="space-y-4">
              <div className="relative flex gap-3">
                <div className="w-7 h-7 rounded-full bg-emerald-500 border-4 border-white flex items-center justify-center shrink-0 z-10 shadow-sm">
                  <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="pt-1.5">
                  <p className="text-xs font-bold text-slate-900 line-through opacity-70">Générer le rapport d'analyse IA</p>
                </div>
              </div>
              
              <div className="relative flex gap-3">
                <div className="w-7 h-7 rounded-full bg-indigo-500 border-4 border-white flex items-center justify-center shrink-0 z-10 shadow-sm ring-2 ring-indigo-100">
                  <Clock className="w-3 h-3 text-white" />
                </div>
                <div className="pt-1.5">
                  <p className="text-xs font-bold text-indigo-950">Créer les produits digitaux</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Ebook & Landing page en attente</p>
                  <button 
                    onClick={() => onNavigateToModule('products')}
                    className="mt-2 text-[10px] font-bold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-md border border-indigo-100 hover:bg-indigo-100 transition-colors"
                  >
                    Démarrer la création
                  </button>
                </div>
              </div>

              <div className="relative flex gap-3">
                <div className="w-7 h-7 rounded-full bg-slate-100 border-4 border-white flex items-center justify-center shrink-0 z-10">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                </div>
                <div className="pt-1.5">
                  <p className="text-xs font-bold text-slate-400">Lancer la campagne Meta Ads</p>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
