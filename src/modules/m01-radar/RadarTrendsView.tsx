import React, { useMemo, useState } from 'react';
import {
  RadarScanResult,
} from '@/shared/types/analysis';
import {
  Flame,
  Target,
  BarChart3,
  TrendingUp,
  Search,
  Sparkles,
  Globe,
  ExternalLink,
  Zap,
  ArrowRight,
  Video,
  FileText,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis } from 'recharts';
import { usePreferences } from '@/app/providers/PreferencesContext';

interface RadarTrendsViewProps {
  initialScanData?: RadarScanResult | null;
  onSelectNicheForFullAnalysis: (nicheName: string) => Promise<void>;
  onNavigateToMetaAds: (productTitle: string) => void;
  isAnalyzingNiche: boolean;
}

const CATEGORY_FILTERS = [
  { id: 'all', label: 'Toutes les catégories', icon: '🌐' },
  { id: 'ia', label: 'IA & Automatisation', icon: '🤖' },
  { id: 'productivity', label: 'Productivité & Notion', icon: '⚡' },
  { id: 'creators', label: 'Créateurs & Vidéos 9:16', icon: '🎬' },
  { id: 'health', label: 'Santé & Biohacking', icon: '🌿' },
  { id: 'finance', label: 'Finance & Investissement', icon: '📈' },
  { id: 'business', label: 'Business & Freelance', icon: '💼' },
];

export const RadarTrendsView: React.FC<RadarTrendsViewProps> = ({
  initialScanData,
  onSelectNicheForFullAnalysis,
  onNavigateToMetaAds,
  isAnalyzingNiche,
}) => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [scanResult, setScanResult] = useState<RadarScanResult | null>(initialScanData || null);
  const [isScanning, setIsScanning] = useState(false);
  const { t } = usePreferences();
  const [scanStep, setScanStep] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);

  /**
   * Classement des niches pour le graphique en barres.
   *
   * Calculé UNE fois et réutilisé pour les données ET pour les <Cell>.
   * Auparavant les barres étaient triées mais les couleurs mappées sur le
   * tableau non trié : la barre de tête n'avait pas la couleur de tête.
   */
  const topNiches = useMemo(
    () =>
      (scanResult?.niches ?? [])
        .map((n) => ({
          name: n.nicheName.length > 15 ? `${n.nicheName.substring(0, 15)}...` : n.nicheName,
          score: n.explosionScore,
          rawName: n.nicheName,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5),
    [scanResult],
  );

  // Scanning stages simulation for UX polish
  const scanSteps = [
    'Interrogation de Google Trends (requêtes en accélération et signaux breakout)...',
    'Fouille des campagnes Meta Ads Library & vidéos TikTok #digitalproducts...',
    'Extraction des best-sellers sur Gumroad, Etsy Digital & Notion Marketplace...',
    'Calcul des indices de vélocité, saturation concurrentielle et marges nettes...',
  ];

  const handleLaunchScan = async (categoryFilter?: string, queryOverride?: string) => {
    setIsScanning(true);
    setScanStep(0);
    setScanError(null);

    const stepInterval = setInterval(() => {
      setScanStep((prev) => (prev < scanSteps.length - 1 ? prev + 1 : prev));
    }, 700);

    try {
      const response = await fetch('/api/radar-trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: categoryFilter || (selectedCategory !== 'all' ? selectedCategory : undefined),
          customQuery: queryOverride !== undefined ? queryOverride : searchQuery,
        }),
      });

      if (response.ok) {
        const data: RadarScanResult = await response.json();
        setScanResult(data);
        return;
      }

      // Un échec doit être VU par l'utilisateur. Auparavant, un statut non-ok
      // était silencieusement ignoré : l'écran restait vide sans explication.
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;

      setScanError(
        payload?.error?.message ??
          t(
            'Le scan de marché est momentanément indisponible. Réessayez dans quelques instants.',
            'Market scanning is temporarily unavailable. Please try again shortly.',
          ),
      );
    } catch {
      setScanError(
        t(
          'Impossible de joindre le serveur. Vérifiez votre connexion.',
          'Could not reach the server. Check your connection.',
        ),
      );
    } finally {
      clearInterval(stepInterval);
      setIsScanning(false);
      setScanStep(0);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Banner : Radar & Live Web Explorer */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-850 to-indigo-950 text-white p-6 sm:p-8 border border-slate-800 shadow-xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>RADAR WEB EN TEMPS RÉEL · GOOGLE TRENDS, META ADS, TIKTOK, GUMROAD</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-black text-white tracking-tight">
              Détecteur de Niches & Produits Digitaux Gagnants
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Fouillez le web en direct pour identifier les opportunités numériques qui explosent en ce moment :
              templates, packs de prompts IA, formations accélérées et guides spécialisés à marge nette &gt; 95%.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <button
              onClick={() => handleLaunchScan()}
              disabled={isScanning}
              className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-5 py-3 rounded-xl transition-all shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {isScanning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Fouille du Web en cours...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-slate-950" />
                  <span>Scanner les Tendances Live</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Scan Status Bar when running */}
        <AnimatePresence>
          {isScanning && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-6 pt-6 border-t border-slate-800"
            >
              <div className="flex items-center gap-3 text-xs text-emerald-300 font-mono">
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                <span className="font-semibold">{scanSteps[scanStep]}</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5 mt-3 overflow-hidden">
                <div
                  className="bg-emerald-400 h-full transition-all duration-500 rounded-full"
                  style={{ width: `${((scanStep + 1) / scanSteps.length) * 100}%` }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input
              type="text"
              placeholder="Rechercher une niche ou mot-clé précis (ex: Notion IA, prompts Midjourney, guide santé sommeil...)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLaunchScan();
              }}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-50/60"
            />
          </div>

          <button
            onClick={() => handleLaunchScan()}
            disabled={isScanning}
            className="w-full md:w-auto flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-5 py-3 rounded-lg transition-colors whitespace-nowrap"
          >
            <Search className="w-3.5 h-3.5 text-emerald-400" />
            <span>Explorer le Web</span>
          </button>
        </div>

        {/* Categories Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
          {CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setSelectedCategory(cat.id);
                handleLaunchScan(cat.id);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                selectedCategory === cat.id
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* État d'erreur — un échec silencieux est pire qu'un message d'erreur */}
      {scanError && !isScanning && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-300/70 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
              {t('Scan interrompu', 'Scan interrupted')}
            </p>
            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">{scanError}</p>
          </div>
          <button
            type="button"
            onClick={() => handleLaunchScan()}
            className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-700"
          >
            {t('Réessayer', 'Retry')}
          </button>
        </div>
      )}

      {/* Scan Results Overview Header */}
      {scanResult && (
        <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-emerald-200/60">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-900">
                Résultats du Scan Web
              </span>
              <span className="text-xs text-emerald-700">· {scanResult.timestamp}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs text-emerald-800 font-medium">
              <span className="font-bold">{scanResult.niches.length} Niches Gagnantes</span>
              <span>· Plateformes sondées : {scanResult.platformsScanned.join(', ')}</span>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-emerald-950 font-medium leading-relaxed mt-3">
            💡 <span className="font-bold">Constat de l'Analyste :</span> {scanResult.executiveTakeaway}
          </p>
          {scanResult.webQueriesUsed && scanResult.webQueriesUsed.length > 0 && (
            <div className="mt-3 pt-3 border-t border-emerald-200/60 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-emerald-800">Requêtes Web explorées :</span>
              {scanResult.webQueriesUsed.map((q, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white text-emerald-900 text-[11px] font-mono border border-emerald-200"
                >
                  <Search className="w-2.5 h-2.5 text-emerald-600" />
                  {q}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      
      {/* 📊 Data Visualization Dashboard - Injected */ }
      {scanResult && !isScanning && scanResult.niches.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700 mt-6 mb-6">
          
          {/* Chart 1: Explosion Score vs Volume (Scatter Plot / Bubble Chart) */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
              <Target className="w-4 h-4 text-indigo-500" />
              Matrice d'Opportunité (Volume vs Explosion)
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: -20 }}>
                  <XAxis 
                    type="number" 
                    dataKey="score" 
                    name="Score Explosion" 
                    domain={[0, 100]} 
                    tick={{ fill: '#64748b', fontSize: 11 }} 
                  />
                  <YAxis 
                    type="number" 
                    dataKey="volume" 
                    name="Volume (K)" 
                    tick={{ fill: '#64748b', fontSize: 11 }} 
                  />
                  <ZAxis type="number" range={[100, 500]} />
                  <RechartsTooltip 
                    cursor={{ strokeDasharray: '3 3' }} 
                    content={({ payload }) => {
                      if (!payload || !payload.length) return null;
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 text-white p-3 rounded-xl text-xs shadow-xl">
                          <p className="font-bold">{data.name}</p>
                          <p className="text-indigo-300">Score Explosion: {data.score}</p>
                          <p className="text-emerald-300">Volume est.: {data.rawVolume}</p>
                        </div>
                      );
                    }}
                  />
                  <Scatter 
                    data={scanResult.niches.map(n => {
                      const numVol = parseInt(n.searchVolumeEstimated.replace(/[^0-9]/g, ''), 10) || 5000;
                      return {
                        name: n.nicheName,
                        score: n.explosionScore,
                        volume: numVol / 1000,
                        rawVolume: n.searchVolumeEstimated,
                        fill: n.explosionScore > 85 ? '#f59e0b' : (n.explosionScore > 70 ? '#4f46e5' : '#10b981')
                      };
                    })}
                  >
                    {
                      scanResult.niches.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.explosionScore > 85 ? '#f59e0b' : (entry.explosionScore > 70 ? '#4f46e5' : '#10b981')} />
                      ))
                    }
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Top Niches by Score (Bar Chart) */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-emerald-500" />
              Classement des Niches par Score
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topNiches}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 30, bottom: 5 }}
                >
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <RechartsTooltip 
                    cursor={{fill: 'transparent'}}
                    content={({ payload }) => {
                      if (!payload || !payload.length) return null;
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 text-white p-3 rounded-xl text-xs shadow-xl">
                          <p className="font-bold">{data.rawName}</p>
                          <p className="text-emerald-400 font-mono">Score : {data.score}/100</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="score" radius={[0, 6, 6, 0]} barSize={24}>
                    {topNiches.map((entry, index) => (
                      <Cell key={entry.rawName} fill={index === 0 ? '#10b981' : '#4f46e5'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Niches Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {scanResult?.niches.map((niche) => {
          return (
            <div
              key={niche.id}
              className="bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all p-5 sm:p-6 space-y-5 flex flex-col justify-between"
            >
              {/* Header with Title & Explosion Score */}
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100 mb-1.5">
                      {niche.category}
                    </span>
                    <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-snug">
                      {niche.nicheName}
                    </h2>
                  </div>

                  {/* Explosion Velocity Badge */}
                  <div className="flex flex-col items-end shrink-0">
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-700 text-xs font-bold border border-amber-500/20">
                      <Flame className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
                      <span>{niche.explosionScore}/100</span>
                    </div>
                    <span className="text-[10px] text-amber-700 font-semibold uppercase mt-0.5">
                      Vélocité {niche.trendVelocity}
                    </span>
                  </div>
                </div>

                {/* Growth Signal Pill */}
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
                  <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-semibold text-slate-800">{niche.growthSignal}</span>
                </div>

                {/* Key Metrics Row */}
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="text-[10px] text-slate-500 block uppercase font-medium">Recherches</span>
                    <span className="font-bold text-slate-800">{niche.searchVolumeEstimated}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="text-[10px] text-slate-500 block uppercase font-medium">Saturation</span>
                    <span
                      className={`font-bold ${
                        niche.saturationLevel === 'Faible'
                          ? 'text-emerald-600'
                          : niche.saturationLevel === 'Moyenne'
                          ? 'text-amber-600'
                          : 'text-rose-600'
                      }`}
                    >
                      {niche.saturationLevel}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="text-[10px] text-slate-500 block uppercase font-medium">Marge Nette</span>
                    <span className="font-bold text-emerald-600">{niche.estimatedMargin}</span>
                  </div>
                </div>

                {/* Analytical Explanation of Why It Explodes */}
                <div className="space-y-1">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    <span>Pourquoi cette niche explose en ce moment :</span>
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">{niche.whyItExplodes}</p>
                </div>

                {/* Concrete Digital Products That Crush It */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Top Produits Digitaux Détectés :</span>
                  </h3>
                  <div className="space-y-2">
                    {niche.topDigitalProducts.map((prod, pIdx) => {
                      return (
                        <div
                          key={pIdx}
                          className="p-3 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-900">{prod.title}</span>
                              <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800">
                                {prod.format}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500">{prod.keyFeature}</p>
                            <span className="text-[10px] text-slate-400">Cible : {prod.targetAudience}</span>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                            <span className="text-xs font-black text-emerald-700 font-mono">
                              {prod.priceEstimated} €
                            </span>
                            <button
                              onClick={() => onNavigateToMetaAds(prod.title)}
                              className="text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
                              title="Générer les scripts publicitaires Meta Ads & TikTok (AIDA & PAS)"
                            >
                              <Video className="w-3 h-3" />
                              <span>Script Pub</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Viral Angles for Meta Ads & TikTok */}
                {niche.viralAngles && niche.viralAngles.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <Video className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Angles Publicitaires & Hooks Viraux :</span>
                    </h3>
                    <div className="space-y-1">
                      {niche.viralAngles.map((angle, aIdx) => (
                        <div key={aIdx} className="text-xs text-slate-600 flex items-start gap-1.5">
                          <span className="text-indigo-500 font-bold shrink-0">▸</span>
                          <span>{angle}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Verified Grounding Sources Links */}
                {niche.sources && niche.sources.length > 0 && (
                  <div className="pt-2 border-t border-slate-100">
                    <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                      Sources Web & Plateformes sondées :
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {niche.sources.map((src, sIdx) => (
                        <a
                          key={sIdx}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 bg-indigo-50/70 hover:bg-indigo-100 px-2 py-0.5 rounded border border-indigo-200/60 transition-colors"
                        >
                          <Globe className="w-3 h-3" />
                          <span>{src.title.length > 28 ? src.title.substring(0, 26) + '...' : src.title}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Actions Row */}
              <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                <button
                  onClick={() => onSelectNicheForFullAnalysis(niche.nicheName)}
                  disabled={isAnalyzingNiche}
                  className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-indigo-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors shadow-xs"
                >
                  <FileText className="w-3.5 h-3.5 text-amber-300" />
                  <span>Générer Dossier Stratégique & 5 Taux</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() =>
                    onNavigateToMetaAds(
                      niche.topDigitalProducts?.[0]?.title || niche.nicheName
                    )
                  }
                  className="flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-2.5 rounded-xl transition-colors"
                >
                  <Video className="w-3.5 h-3.5 text-slate-600" />
                  <span>Script Meta Ads</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
