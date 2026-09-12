import React, { useState } from 'react';
import { MarketAnalysisReport, MarketRate } from '@/shared/types/analysis';
import { RateBadge } from '@/shared/ui/RateBadge';
import { motion } from 'motion/react';
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  ShieldCheck,
  Zap,
  Target,
  Users,
  Search,
  AlertCircle,
  CheckCircle2,
  BarChart3,
  ArrowUpRight,
  Sparkles,
  Flame,
  Award,
  ChevronRight,
  Layers,
  PieChart,
  Activity,
  Globe,
  Compass,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/shared/ui/tooltip';

interface StrategicAnalysisViewProps {
  report: MarketAnalysisReport;
  onNavigateToProducts: () => void;
  onNavigateToMetaAds: () => void;
}

export const StrategicAnalysisView: React.FC<StrategicAnalysisViewProps> = ({
  report,
  onNavigateToProducts,
  onNavigateToMetaAds,
}) => {
  const [activeAnalysisView, setActiveAnalysisView] = useState<'grid' | 'radar'>('grid');

  const ratesList: MarketRate[] = [
    report.rates.demand,
    report.rates.saturation,
    report.rates.profitability,
    report.rates.opportunity,
    report.rates.virality,
  ].filter(Boolean);

  // Data formatted for the Radar Chart
  const radarData = ratesList.map((rate) => ({
    subject: rate.label.replace('Taux de ', '').replace('Taux d\'', ''),
    score: rate.score,
    fullMark: 100,
    level: rate.level,
  }));

  // Data formatted for search keyword momentum bar chart
  const searchTrendData = report.searchTrends.map((st) => {
    // extract numeric volume approx for chart
    const numericVol = parseInt(st.volume.replace(/[^0-9]/g, ''), 10) || 10000;
    const growthNum = parseInt(st.growthRate.replace(/[^0-9]/g, ''), 10) || 50;
    return {
      keyword: st.keyword.length > 20 ? st.keyword.substring(0, 18) + '...' : st.keyword,
      volume: numericVol,
      displayVolume: st.volume,
      growth: growthNum,
      displayGrowth: st.growthRate,
      intent: st.intent,
      type: st.growthType,
    };
  });

  const getVerdictBadge = (verdict: string) => {
    switch (verdict) {
      case 'Opportunité Exceptionnelle':
        return (
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-emerald-500 text-white shadow-md shadow-emerald-500/25">
            <Flame className="w-4 h-4 animate-bounce" />
            <span>{verdict}</span>
          </span>
        );
      case 'Opportunité Forte':
        return (
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-blue-600 text-white shadow-md shadow-blue-500/25">
            <Award className="w-4 h-4" />
            <span>{verdict}</span>
          </span>
        );
      case 'Marché Compétitif':
        return (
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-amber-500 text-white shadow-md shadow-amber-500/25">
            <Activity className="w-4 h-4" />
            <span>{verdict}</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-slate-800 text-white">
            <Target className="w-4 h-4" />
            <span>{verdict}</span>
          </span>
        );
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-8 animate-in fade-in duration-200">
        
        {/* Top Hero Section: Executive Intelligence Banner */}
        <motion.section
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xs relative overflow-hidden"
        >
          {/* Subtle background glow */}
          <div className="absolute -right-20 -top-20 w-80 h-80 bg-gradient-to-bl from-indigo-100/60 via-sky-50/40 to-transparent rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-100">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="indigo" className="gap-1.5 py-1">
                  <Compass className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Veille Stratégique Web & E-Commerce</span>
                </Badge>
                <span className="text-xs text-slate-400 font-medium font-mono">
                  Édition du {report.dateCreated}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-slate-900 tracking-tight font-display">
                {report.nicheName}
              </h1>

              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Search className="w-3.5 h-3.5 text-indigo-500" />
                <span>Requête analysée :</span>
                <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md font-mono">
                  « {report.query} »
                </span>
              </div>
            </div>

            {/* Overall Verdict Badge */}
            <div className="shrink-0 flex flex-col items-start lg:items-end gap-1.5 bg-slate-50/80 p-4 rounded-2xl border border-slate-200/60">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Verdict de Veille Concurrentielle :
              </span>
              {getVerdictBadge(report.overallVerdict)}
            </div>
          </div>

          {/* Executive Summary Card */}
          <div className="mt-6">
            <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Synthèse d'Analyse Concurrentielle & Potentiel de Monétisation</span>
            </h2>
            <div className="bg-slate-50/70 p-4 sm:p-5 rounded-2xl border border-slate-200/70 text-slate-800 text-xs sm:text-sm leading-relaxed">
              {report.executiveSummary}
            </div>
          </div>

          {/* Quick Actions Bar */}
          <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Signaux web croisés avec l'algorithme publicitaire Meta et les volumes de recherche</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onNavigateToProducts}
                className="gap-1.5 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
              >
                <span>Produits digitaux ({report.digitalProducts.length})</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>

              <Button
                variant="glow"
                size="sm"
                onClick={onNavigateToMetaAds}
                className="gap-1.5"
              >
                <span>Vidéos Meta Ads</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </motion.section>

        {/* SECTION 1: Le Système de Notation par Taux (avec Radar Chart Recharts) */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-display flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-indigo-600" />
                  <span>Système de Notation par Taux Stratégiques</span>
                </h2>
                <Badge variant="emerald" className="hidden sm:inline-flex">
                  5 Indicateurs Validés
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Évaluation par échelle normalisée : <strong>Faible</strong> • <strong>Moyen</strong> • <strong>Élevé</strong> • <strong>Très élevé</strong>
              </p>
            </div>

            {/* Switch between Card Grid & Radar View */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1 shrink-0 self-start sm:self-auto">
              <button
                onClick={() => setActiveAnalysisView('grid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeAnalysisView === 'grid'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Grille des Taux
              </button>
              <button
                onClick={() => setActiveAnalysisView('radar')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeAnalysisView === 'radar'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Radar Stratégique
              </button>
            </div>
          </div>

          {/* Dynamic View: Grid vs Radar Chart */}
          {activeAnalysisView === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {ratesList.map((rate, idx) => {
                const getRateColor = () => {
                  switch (rate.level) {
                    case 'Très élevé':
                      return 'bg-emerald-500';
                    case 'Élevé':
                      return 'bg-blue-500';
                    case 'Moyen':
                      return 'bg-amber-500';
                    case 'Faible':
                      return 'bg-rose-500';
                    default:
                      return 'bg-indigo-500';
                  }
                };

                return (
                  <motion.div
                    key={rate.key}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: idx * 0.05 }}
                    className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:shadow-sm hover:border-indigo-300 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                          {rate.label}
                        </span>
                        <RateBadge level={rate.level} size="md" />
                      </div>

                      {/* Score display */}
                      <div className="my-3 space-y-1.5">
                        <div className="flex items-baseline justify-between">
                          <span className="text-2xl sm:text-3xl font-black text-slate-900 font-display">
                            {rate.score}
                            <span className="text-xs font-medium text-slate-400"> / 100</span>
                          </span>
                          <span className="text-xs font-bold text-slate-600">
                            Taux {rate.level}
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-2 rounded-full transition-all duration-700 ${getRateColor()}`}
                            style={{ width: `${rate.score}%` }}
                          />
                        </div>
                      </div>

                      <p className="text-xs text-slate-600 leading-relaxed mt-2.5">
                        {rate.description}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Orientation :</span>
                      <span className="font-semibold text-slate-700 flex items-center gap-1 font-mono">
                        {rate.trend === 'up' && <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
                        {rate.trend === 'stable' && <span className="w-2.5 h-0.5 bg-slate-400 inline-block" />}
                        {rate.trend === 'up' ? 'En hausse' : rate.trend === 'stable' ? 'Stable' : 'Repli'}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            /* Recharts Radar Chart View */
            <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-7 h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis
                      dataKey="subject"
                      tick={{ fill: '#334155', fontSize: 12, fontWeight: 600 }}
                    />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#cbd5e1" />
                    <Radar
                      name="Score Stratégique"
                      dataKey="score"
                      stroke="#4f46e5"
                      fill="#6366f1"
                      fillOpacity={0.4}
                    />
                    <RechartsTooltip
                      content={({ payload }) => {
                        if (!payload || !payload.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-slate-900 text-white p-2.5 rounded-xl text-xs shadow-lg space-y-1">
                            <span className="font-bold block">{data.subject}</span>
                            <span className="text-indigo-300 font-mono">Score : {data.score}/100</span>
                            <span className="text-emerald-400 block font-semibold">Taux : {data.level}</span>
                          </div>
                        );
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              <div className="lg:col-span-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  Interprétation du Radar Décisionnel
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Ce diagramme en toile d'araignée cartographie l'équilibre entre la demande brute, la rentabilité numérique et la saturation concurrentielle. Plus l'aire bleue s'étend vers les bords extérieurs, plus le retour sur investissement estimé est élevé.
                </p>

                <div className="space-y-2 pt-2">
                  {ratesList.map((r) => (
                    <div key={r.key} className="flex items-center justify-between text-xs py-1 border-b border-slate-100">
                      <span className="font-medium text-slate-700">{r.label}</span>
                      <RateBadge level={r.level} size="sm" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* SECTION 2: Requêtes & Mots-Clés avec Recharts Momentum Visualizer */}
        <section className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-display flex items-center gap-2">
                <Search className="w-5 h-5 text-indigo-600" />
                <span>Volumes de Recherche & Mots-Clés à Forte Intention</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Données de volume mensuel et intentions d'achat détectées sur le web
              </p>
            </div>
            <Badge variant="blue">Volumes Mensuels Estimés</Badge>
          </div>

          {/* Recharts Bar Chart for Keyword Volumes */}
          <div className="h-64 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={searchTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 25 }}>
                <XAxis
                  dataKey="keyword"
                  tick={{ fill: '#475569', fontSize: 11, fontWeight: 500 }}
                  interval={0}
                  angle={-10}
                  textAnchor="end"
                />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <RechartsTooltip
                  content={({ payload }) => {
                    if (!payload || !payload.length) return null;
                    const item = payload[0].payload;
                    return (
                      <div className="bg-slate-900 text-white p-3 rounded-xl text-xs shadow-xl space-y-1">
                        <p className="font-bold text-slate-100">« {item.keyword} »</p>
                        <p className="text-emerald-400 font-mono">Volume : {item.displayVolume}</p>
                        <p className="text-sky-300 font-mono">Croissance : {item.displayGrowth}</p>
                        <p className="text-slate-400 capitalize">Intention : {item.intent}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="volume" radius={[8, 8, 0, 0]}>
                  {searchTrendData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={index === 0 ? '#4f46e5' : index === 1 ? '#0284c7' : '#059669'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table List of Keywords */}
          <div className="overflow-x-auto pt-2">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                  <th className="pb-3 pl-2">Mot-clé / Requête d'acheteur</th>
                  <th className="pb-3">Volume Mensuel</th>
                  <th className="pb-3">Dynamique de Croissance</th>
                  <th className="pb-3">Type de Tendance</th>
                  <th className="pb-3 pr-2 text-right">Intention d'achat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.searchTrends.map((st, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 pl-2 font-bold text-slate-900">
                      <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 shrink-0" />
                        <span>« {st.keyword} »</span>
                      </span>
                    </td>
                    <td className="py-3.5 text-slate-600 font-mono font-medium">
                      {st.volume}
                    </td>
                    <td className="py-3.5 font-bold text-emerald-600 font-mono">
                      {st.growthRate}
                    </td>
                    <td className="py-3.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          st.growthType === 'explosive'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : st.growthType === 'steady'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {st.growthType === 'explosive' && '🔥 Explosion'}
                        {st.growthType === 'steady' && '📈 Croissance régulière'}
                        {st.growthType === 'niche' && '🎯 Hyper-ciblé'}
                      </span>
                    </td>
                    <td className="py-3.5 pr-2 text-right font-semibold text-slate-700">
                      <span className="px-2 py-1 rounded-md bg-slate-100 text-[11px]">
                        {st.intent === 'transactional' && '💳 Transactionnelle'}
                        {st.intent === 'commercial' && '🛒 Commerciale'}
                        {st.intent === 'informational' && 'ℹ️ Informationnelle'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* SECTION 3: Radar Concurrentiel & Angles d'Attaque Gagnants */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-display flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-600" />
              <span>Benchmark Concurrentiel & Failles Exploitables</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Analyse des points forts et faiblesses des concurrents pour concevoir votre offre différenciante
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {report.competitors.map((comp) => (
              <motion.div
                key={comp.id}
                whileHover={{ y: -2 }}
                className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-100">
                    <div>
                      <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                        <span>{comp.name}</span>
                        <span className="text-xs font-normal text-slate-400 font-mono">{comp.urlOrHandle}</span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">{comp.positioning}</p>
                    </div>
                    <Badge variant="amber" className="shrink-0 font-mono">
                      {comp.priceRange}
                    </Badge>
                  </div>

                  {/* Strengths and Weaknesses */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                    <div className="bg-slate-50/80 p-3.5 rounded-xl border border-slate-100">
                      <span className="text-xs font-bold text-slate-700 block mb-1.5 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        Points forts constatés :
                      </span>
                      <ul className="space-y-1 text-xs text-slate-600">
                        {comp.strengths.map((s, i) => (
                          <li key={i} className="flex items-center gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-slate-400" />
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-rose-50/50 p-3.5 rounded-xl border border-rose-100">
                      <span className="text-xs font-bold text-rose-700 block mb-1.5 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                        Frustrations clients :
                      </span>
                      <ul className="space-y-1 text-xs text-rose-800">
                        {comp.weaknesses.map((w, i) => (
                          <li key={i} className="flex items-center gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-rose-400" />
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Winning Angle */}
                <div className="bg-gradient-to-r from-emerald-50 to-teal-50 p-4 rounded-2xl border border-emerald-200/80">
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-800 block mb-1 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-emerald-600" />
                    Angle d'Attaque Stratégique pour votre produit digital :
                  </span>
                  <p className="text-xs sm:text-sm text-emerald-950 font-medium">
                    {comp.exploitableGaps[0] || 'Proposer une version simplifiée et concrète, prête à l\'emploi en moins de 15 minutes.'}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* SECTION 4: Roadmap de Lancement en 3 Phases */}
        <section className="bg-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl space-y-6 relative overflow-hidden">
          <div className="absolute right-0 top-0 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

          <div>
            <Badge variant="indigo" className="mb-2">
              Feuille de Route Exécutive
            </Badge>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight font-display text-white">
              Plan d'Action de Lancement en 3 Phases
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl">
              Chronologie recommandée pour valider l'intérêt du marché, acquérir vos premiers acheteurs avec Meta Ads et maximiser la marge.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative z-10">
            {report.strategicActionPlan.map((plan, idx) => (
              <div
                key={idx}
                className="bg-white/10 backdrop-blur-md rounded-2xl p-5 border border-white/10 flex flex-col justify-between"
              >
                <div>
                  <span className="text-xs font-bold text-indigo-300 block mb-1 font-mono">
                    {plan.phase}
                  </span>
                  <h4 className="font-bold text-base text-white mb-3">
                    {plan.title}
                  </h4>
                  <ul className="space-y-2 text-xs text-slate-200">
                    {plan.steps.map((step, sIdx) => (
                      <li key={sIdx} className="flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full bg-indigo-500/40 text-indigo-200 flex items-center justify-center shrink-0 font-bold text-[10px] mt-0.5">
                          {sIdx + 1}
                        </span>
                        <span className="leading-snug">{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 5: Sources Web & Citations Réelles (Google Search Grounding) */}
        {report.groundingSources && report.groundingSources.length > 0 && (
          <section className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center gap-2 text-indigo-700">
              <Globe className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-900">
                Sources Web & Données Réelles Sondées (Google Search Grounding)
              </h3>
            </div>
            <p className="text-xs text-slate-500">
              Cette analyse a été consolidée en temps réel à partir des signaux du web, des plateformes de vente digitale et des réseaux sociaux suivants :
            </p>
            <div className="flex flex-wrap gap-2.5 pt-1">
              {report.groundingSources.map((src, sIdx) => (
                <a
                  key={sIdx}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-xs text-slate-700 hover:text-indigo-700 transition-colors"
                >
                  <Globe className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span className="font-medium truncate max-w-xs">{src.title}</span>
                  <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
                </a>
              ))}
            </div>
          </section>
        )}

      </div>
    </TooltipProvider>
  );
};
