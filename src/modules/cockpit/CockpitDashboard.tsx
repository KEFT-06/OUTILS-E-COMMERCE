import React from 'react';
import {
  TrendingUp,
  Zap,
  CreditCard,
  Target,
  ArrowUpRight,
  Layers,
} from 'lucide-react';
import { MarketAnalysisReport } from '@/shared/types/analysis';
import { usePreferences } from '@/app/providers/PreferencesContext';
import { useAuth } from '@/features/auth/AuthContext';
import { NoDataState } from '@/shared/ui/NoDataState';

/**
 * Valeur d'un research point, en FCFA.
 *
 * À déplacer en table de configuration serveur avec le reste de la grille
 * tarifaire (CdC §8) : un prix figé dans le bundle client ne peut pas être
 * corrigé sans redéploiement, et se retrouve à diverger de la facturation réelle.
 */
const FCFA_PER_RESEARCH_POINT = 250;

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
  const { user } = useAuth();

  // Le solde vient du profil, source unique partagée avec la page Compte.
  // Il était auparavant réécrit en dur ici — les deux écrans s'en trouvaient
  // contradictoires (38 « restants » au cockpit contre 62 sur le compte).
  const creditsTotal = user?.apiSearchesLimit ?? 0;
  const creditsUsed = user?.apiSearchesUsed ?? 0;
  const creditsRemaining = Math.max(0, creditsTotal - creditsUsed);
  const creditPercentage = creditsTotal > 0 ? (creditsRemaining / creditsTotal) * 100 : 0;

  // Le taux de saturation est le seul des cinq à porter une trace de calcul
  // vérifiable ; c'est donc le seul qu'on affiche comme indicateur de tension.
  const saturation = report.rates.saturation;

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
              <span className="text-slate-900">
                ≈ {(creditsRemaining * FCFA_PER_RESEARCH_POINT).toLocaleString('fr-FR')} FCFA
              </span>
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

        {/* Module 2: Boucle de performance — en attente d'une source de ventes réelles (CdC §26) */}
        <div className="col-span-1 md:col-span-8 bg-white rounded-3xl border border-slate-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">Performance des Ventes</h2>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                  Aucune boutique connectée
                </p>
              </div>
            </div>
          </div>

          {/*
            Ce bloc affichait 485k FCFA de revenus, 124 ventes et un ROI de 3,2x
            sous le libellé « Performance Réelle », attribués à une agrégation
            Maketou & Taliopay. Ces chiffres étaient inventés, et aucun de ces
            deux services ne publie d'API permettant de les obtenir (CdC §6.6).
            Tant qu'un connecteur ne renvoie pas de vraies ventes, on n'affiche rien.
          */}
          <NoDataState
            title="Vos ventes s'afficheront ici"
            reason="Aucune boutique n'est encore reliée à votre compte. Ce tableau restera vide tant qu'une source de ventes réelles ne sera pas connectée — nous préférons ne rien afficher plutôt qu'une estimation."
            milestone="Lot 5 — connecteurs marketplace"
            action={{ label: 'Voir les modules disponibles', onClick: () => onNavigateToModule('radar') }}
          />
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

          {/*
            Les deux autres « marchés suivis » (Formation No-Code, Investissement
            Immo CI) et leurs variations (+12 %, +5 %, -2 %) étaient écrits en dur.
            On n'affiche plus que la niche réellement analysée, avec la tension
            issue de sa trace de calcul — et les niches que l'utilisateur a
            lui-même enregistrées, sans leur inventer de score.
          */}
          <div className="space-y-3">
            <div className="p-3 rounded-xl border bg-indigo-50/50 border-indigo-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-indigo-500" />
                <div>
                  <p className="text-xs font-bold text-slate-900">{report.nicheName}</p>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Tension : <span className="font-bold">{saturation.level}</span>
                    <span className="text-slate-400"> · {saturation.score}/100</span>
                  </p>
                </div>
              </div>
              {saturation.trace ? (
                <span className="text-[10px] font-bold text-slate-500">
                  v{saturation.trace.methodologyVersion}
                </span>
              ) : (
                <span className="text-[10px] font-bold text-amber-600">Méthode non publiée</span>
              )}
            </div>

            {(user?.savedNiches ?? []).slice(0, 3).map((niche) => (
              <div
                key={niche}
                className="p-3 rounded-xl border bg-slate-50 border-slate-100 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                  <p className="text-xs font-bold text-slate-900">{niche}</p>
                </div>
                <span className="text-[10px] font-semibold text-slate-400">Pas encore analysée</span>
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
              <h2 className="text-sm font-bold text-slate-900">Plan d'Action Recommandé</h2>
            </div>
            <button
              onClick={() => onNavigateToModule('veille')}
              className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1"
            >
              Ouvrir l'audit <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>

          {/*
            La timeline était figée (« Générer le rapport ✓ », « Créer les produits
            en attente ») et affichait un état d'avancement que rien ne mesure.
            On rend maintenant le plan réellement porté par le rapport, sans
            prétendre savoir où l'utilisateur en est.
          */}
          {report.strategicActionPlan.length === 0 ? (
            <NoDataState
              title="Aucun plan d'action dans ce rapport"
              reason="Le rapport analysé ne contient pas encore de plan d'action structuré."
              icon={Layers}
            />
          ) : (
            <div className="relative">
              <div className="absolute left-3.5 top-2 bottom-2 w-0.5 bg-slate-100" />
              <div className="space-y-4">
                {report.strategicActionPlan.map((phase, index) => (
                  <div key={phase.phase} className="relative flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-sky-500 border-4 border-white flex items-center justify-center shrink-0 z-10 shadow-sm">
                      <span className="text-[10px] font-black text-white">{index + 1}</span>
                    </div>
                    <div className="pt-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {phase.phase}
                      </p>
                      <p className="text-xs font-bold text-slate-900 mt-0.5">{phase.title}</p>
                      <ul className="mt-1 space-y-0.5">
                        {phase.steps.map((step) => (
                          <li key={step} className="text-[10px] text-slate-500 leading-relaxed">
                            · {step}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
