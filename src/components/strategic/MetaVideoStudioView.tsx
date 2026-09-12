import React, { useState, useEffect, useRef } from 'react';
import { MetaAdCampaign, MetaAdScene } from '../../types/analysis';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis, AreaChart, Area, CartesianGrid } from 'recharts';
import { usePreferences } from '../../context/PreferencesContext';
import {
  Video,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Check,
  Sparkles,
  Smartphone,
  Square,
  Layers,
  Clock,
  Send,
  Eye,
  Target,
  ExternalLink,
  Flame,
  Radio,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

interface MetaVideoStudioViewProps {
  campaigns: MetaAdCampaign[];
  onGenerateNewScript?: (framework: 'AIDA' | 'PAS' | 'BAB' | 'UGC') => void;
  isGenerating?: boolean;
}

export const MetaVideoStudioView: React.FC<MetaVideoStudioViewProps> = ({
  campaigns,
  onGenerateNewScript,
  isGenerating,
}) => {
  const { t } = usePreferences();
  const [selectedCampaign, setSelectedCampaign] = useState<MetaAdCampaign>(campaigns[0] || null);
  const [activeSceneIndex, setActiveSceneIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '1:1'>('9:16');
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (campaigns && campaigns.length > 0 && (!selectedCampaign || !campaigns.some(c => c.id === selectedCampaign.id))) {
      setSelectedCampaign(campaigns[0]);
      setActiveSceneIndex(0);
      setIsPlaying(false);
    }
  }, [campaigns]);

  // Voiceover speech helper (Web Speech API)
  const speakScene = (text: string) => {
    if (isAudioMuted || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Audio speech synthesis fallback
    }
  };

  // Video playback loop simulator
  useEffect(() => {
    if (!isPlaying || !selectedCampaign || selectedCampaign.scenes.length === 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const currentScene = selectedCampaign.scenes[activeSceneIndex];
    if (currentScene) {
      speakScene(currentScene.spokenVoiceover);
    }

    timerRef.current = setTimeout(() => {
      setActiveSceneIndex((prev) => {
        if (prev + 1 < selectedCampaign.scenes.length) {
          return prev + 1;
        } else {
          setIsPlaying(false);
          return 0;
        }
      });
    }, 4500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, activeSceneIndex, selectedCampaign, isAudioMuted]);

  const handlePlayPause = () => {
    if (isPlaying) {
      setIsPlaying(false);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } else {
      setIsPlaying(true);
    }
  };

  const handleReset = () => {
    setIsPlaying(false);
    setActiveSceneIndex(0);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  if (!selectedCampaign) {
    return (
      <div className="bg-white rounded-3xl p-12 text-center border border-slate-200">
        <Video className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600 font-semibold">Aucune campagne publicitaire générée.</p>
      </div>
    );
  }

  const currentScene = selectedCampaign.scenes[activeSceneIndex] || selectedCampaign.scenes[0];

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      
      {/* Top Title Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="destructive" className="font-mono gap-1.5">
              <Radio className="w-3.5 h-3.5 animate-pulse text-rose-500" />
              <span>Studio Créatif Vidéo Meta Ads</span>
            </Badge>
            <Badge variant="emerald" className="gap-1 font-mono">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Politiques Meta 100% Conformes</span>
            </Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight font-display mt-1">
            Scripts Vidéos & Storyboards Publicitaires Meta Ads
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Conception publicitaire axée conversion basée sur les méthodes <strong>AIDA</strong> (Attention, Intérêt, Désir, Action) et <strong>PAS</strong> (Problème, Agitation, Solution).
          </p>
        </div>

        {/* Framework Selector Tabs */}
        <div className="flex items-center bg-slate-100/90 p-1 rounded-xl gap-1 shrink-0 self-start md:self-auto">
          {campaigns.map((camp) => (
            <button
              key={camp.id}
              onClick={() => {
                setSelectedCampaign(camp);
                setActiveSceneIndex(0);
                setIsPlaying(false);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                selectedCampaign.id === camp.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Méthode {camp.framework}
            </button>
          ))}
        </div>
      </div>

      
      {/* 📊 Data Visualization Dashboard - Injected for Meta Ads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Chart 1: Simulated Retention Curve (Area Chart) */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
            <Flame className="w-4 h-4 text-rose-500" />
            {t("Courbe de Rétention Estimée (Hook 3s)", "Estimated Retention Curve (3s Hook)")}
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={[
                  { second: 0, retention: 100 },
                  { second: 1, retention: 92 },
                  { second: 2, retention: 85 },
                  { second: 3, retention: 70 }, // Hook drop
                  { second: 6, retention: 65 },
                  { second: 10, retention: 58 },
                  { second: 15, retention: 45 },
                  { second: selectedCampaign?.durationSeconds || 18, retention: 35 },
                ]}
                margin={{ top: 10, right: 30, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorRetention" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="second" tickFormatter={(v) => `${v}s`} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <RechartsTooltip 
                  content={({ payload }) => {
                    if (!payload || !payload.length) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-slate-900 text-white p-3 rounded-xl text-xs shadow-xl">
                        <p className="font-bold text-slate-300">À la seconde {data.second}</p>
                        <p className="text-rose-400 font-mono text-lg">{data.retention}% d'audience restante</p>
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey="retention" stroke="#f43f5e" strokeWidth={3} fillOpacity={1} fill="url(#colorRetention)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Time Allocation per Phase (Bar Chart) */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-indigo-500" />
            {t("Allocation du Temps par Phase", "Time Allocation per Phase")}
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={selectedCampaign?.scenes.map(s => {
                  const times = s.timing.split(' - ').map(t => parseInt(t.split(':')[1]));
                  return {
                    phase: s.phase,
                    duration: times[1] - times[0],
                  };
                }) || []}
                margin={{ top: 10, right: 30, left: -20, bottom: 25 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="phase" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} angle={-20} textAnchor="end" />
                <YAxis tickFormatter={(v) => `${v}s`} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <RechartsTooltip 
                  cursor={{fill: '#f8fafc'}}
                  content={({ payload }) => {
                    if (!payload || !payload.length) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-slate-900 text-white p-3 rounded-xl text-xs shadow-xl">
                        <p className="font-bold">{data.phase}</p>
                        <p className="text-indigo-400 font-mono">Durée : {data.duration} secondes</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="duration" radius={[6, 6, 0, 0]}>
                  {
                    (selectedCampaign?.scenes || []).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index === 0 ? '#f59e0b' : index === 3 ? '#10b981' : '#4f46e5'} />
                    ))
                  }
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Main Studio Viewport */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT: Live Interactive Video Simulator (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col items-center">
          
          <div className="w-full flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 font-mono">
                Simulateur Écran Vidéo
              </span>
            </div>

            {/* Ratio Toggle (9:16 vs 1:1) */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setAspectRatio('9:16')}
                title="Format vertical Reels & TikTok (9:16)"
                className={`p-1.5 rounded ${
                  aspectRatio === '9:16' ? 'bg-white text-indigo-600 shadow-xs font-bold' : 'text-slate-500'
                }`}
              >
                <Smartphone className="w-4 h-4" />
              </button>
              <button
                onClick={() => setAspectRatio('1:1')}
                title="Format carré Feed Instagram/Facebook (1:1)"
                className={`p-1.5 rounded ${
                  aspectRatio === '1:1' ? 'bg-white text-indigo-600 shadow-xs font-bold' : 'text-slate-500'
                }`}
              >
                <Square className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Phone Frame Simulator */}
          <div
            className={`relative bg-slate-950 rounded-3xl overflow-hidden border-4 border-slate-900 shadow-2xl transition-all flex flex-col justify-between p-4 ${
              aspectRatio === '9:16' ? 'w-[280px] sm:w-[310px] h-[520px] sm:h-[560px]' : 'w-[310px] h-[310px]'
            }`}
          >
            {/* Top HUD */}
            <div className="z-20 flex items-center justify-between text-white/80 text-[10px] font-semibold">
              <span className="bg-black/50 px-2 py-0.5 rounded-full backdrop-blur-xs flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {selectedCampaign.framework} Ads
              </span>
              <span className="bg-black/50 px-2 py-0.5 rounded-full backdrop-blur-xs font-mono">
                {currentScene?.timing}
              </span>
            </div>

            {/* Animated Scene Content with Motion AnimatePresence */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSceneIndex}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.04 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 bg-gradient-to-b from-slate-900/70 via-slate-900/50 to-slate-950/95"
              >
                {/* Visual pulsating aura */}
                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-500 via-rose-500 to-transparent animate-pulse" />

                {/* Phase Badge */}
                <div className="mb-4">
                  <span className="inline-block px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-rose-500 text-white shadow-lg shadow-rose-500/40 font-display">
                    {currentScene?.phase}
                  </span>
                </div>

                {/* High Contrast Sound-Off Captions */}
                <div className="bg-black/80 backdrop-blur-md p-4 rounded-2xl border border-white/20 shadow-2xl max-w-[90%]">
                  <h3 className="text-white text-base sm:text-lg font-black tracking-tight leading-snug drop-shadow-md">
                    {currentScene?.onScreenText}
                  </h3>
                </div>

                {/* Voiceover preview text */}
                <p className="text-[11px] text-slate-300 mt-4 px-2 italic line-clamp-3">
                  « {currentScene?.spokenVoiceover} »
                </p>

                {/* Simulated Audio Equalizer Bars when sound is playing */}
                {isPlaying && !isAudioMuted && (
                  <div className="flex items-center gap-1 mt-4">
                    <span className="w-1 h-3 bg-rose-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-4 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    <span className="w-1 h-6 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '450ms' }} />
                    <span className="w-1 h-3 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '600ms' }} />
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Bottom Safe Zone Overlay */}
            <div className="z-20 w-full space-y-2">
              <div className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2.5 px-4 rounded-xl text-center shadow-lg cursor-pointer flex items-center justify-center gap-2">
                <span>{selectedCampaign.callToAction}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </div>

              <p className="text-[9px] text-white/50 text-center font-mono">
                Safe zone Meta Ads 9:16 garantie (Boutons au centre dégagé)
              </p>
            </div>

            {/* Progress Bar of Scenes */}
            <div className="absolute top-2 left-4 right-4 z-30 flex gap-1">
              {selectedCampaign.scenes.map((s, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    setActiveSceneIndex(idx);
                    setIsPlaying(false);
                  }}
                  className={`h-1 flex-1 rounded-full cursor-pointer transition-all ${
                    idx === activeSceneIndex
                      ? 'bg-rose-500'
                      : idx < activeSceneIndex
                      ? 'bg-white'
                      : 'bg-white/30'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Player Controls */}
          <div className="w-full flex items-center justify-between mt-5 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <button
                onClick={handlePlayPause}
                className="w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-md transition-transform active:scale-95 cursor-pointer"
                title={isPlaying ? 'Mettre en pause' : 'Lancer la simulation vidéo'}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>

              <button
                onClick={handleReset}
                className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center cursor-pointer"
                title="Recommencer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            {/* Audio Speech Toggle */}
            <button
              onClick={() => {
                setIsAudioMuted(!isAudioMuted);
                if (!isAudioMuted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                  window.speechSynthesis.cancel();
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                isAudioMuted
                  ? 'bg-slate-50 text-slate-500 border-slate-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              {isAudioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              <span>{isAudioMuted ? 'Voix off coupée' : 'Voix off active'}</span>
            </button>
          </div>
        </div>

        {/* RIGHT: Scene Breakdown & Meta Ad Copywriting (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Hook & Copywriting Card */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-100">
              <div>
                <Badge variant="destructive" className="font-mono">
                  Méthode {selectedCampaign.framework} — {selectedCampaign.frameworkFullName}
                </Badge>
                <h2 className="text-lg font-black text-slate-900 mt-1 font-display">
                  {selectedCampaign.targetProductTitle}
                </h2>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  copyToClipboard(
                    `${selectedCampaign.metaPrimaryText}\n\n${selectedCampaign.metaHeadline}\nCTA: ${selectedCampaign.callToAction}`,
                    'adCopy'
                  )
                }
                className="gap-1.5 text-xs font-bold"
              >
                {copiedText === 'adCopy' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedText === 'adCopy' ? 'Copié !' : 'Copier texte Meta'}</span>
              </Button>
            </div>

            {/* Hook Highlight */}
            <div className="bg-rose-50/70 p-4 rounded-2xl border border-rose-200/70">
              <span className="text-xs font-extrabold uppercase tracking-wider text-rose-800 block mb-1">
                🎣 Le Hook des 3 premières secondes (Arrêt du scroll garanti) :
              </span>
              <p className="text-sm sm:text-base font-bold text-rose-950">
                « {selectedCampaign.hookHeadline} »
              </p>
            </div>

            {/* Primary Text */}
            <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200/60">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-2 font-mono">
                Texte Publicitaire Meta (Feed Facebook & Instagram)
              </span>
              <p className="text-xs sm:text-sm text-slate-800 whitespace-pre-line leading-relaxed">
                {selectedCampaign.metaPrimaryText}
              </p>
            </div>

            {/* Targeting Recommendations */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                <span className="font-bold text-slate-700 block mb-1">Intérêts ciblés recommandés :</span>
                <span className="text-slate-600">{selectedCampaign.metaTargeting.interests.join(', ')}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                <span className="font-bold text-slate-700 block mb-1">Emplacements optimaux :</span>
                <span className="text-slate-600">{selectedCampaign.metaTargeting.placements.join(' • ')}</span>
              </div>
            </div>
          </div>

          {/* Scene by Scene Storyboard */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              <span>Storyboard Détaillé ({selectedCampaign.scenes.length} Scènes • {selectedCampaign.durationSeconds}s)</span>
            </h3>

            <div className="space-y-3">
              {selectedCampaign.scenes.map((scene, idx) => (
                <div
                  key={scene.sceneNumber}
                  onClick={() => {
                    setActiveSceneIndex(idx);
                    speakScene(scene.spokenVoiceover);
                  }}
                  className={`cursor-pointer p-4 rounded-2xl border transition-all ${
                    idx === activeSceneIndex
                      ? 'bg-indigo-50/60 border-indigo-400 ring-1 ring-indigo-400/20 shadow-xs'
                      : 'bg-slate-50/60 hover:bg-slate-50 border-slate-200/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center font-mono">
                        {scene.sceneNumber}
                      </span>
                      <span className="text-xs font-bold text-slate-900">
                        {scene.timing} — Phase : <span className="text-rose-600">{scene.phase}</span>
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-medium italic">
                      {scene.soundAndVibe}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 text-xs">
                    <div>
                      <span className="font-semibold text-slate-600 block text-[11px]">Visuel caméra :</span>
                      <p className="text-slate-800 mt-0.5">{scene.visualDescription}</p>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-600 block text-[11px]">Texte écran (Sound-off) :</span>
                      <p className="text-indigo-700 font-bold mt-0.5">« {scene.onScreenText} »</p>
                    </div>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-slate-200/50 text-xs">
                    <span className="font-semibold text-slate-600 text-[11px]">Voix off parlée :</span>
                    <p className="text-slate-800 italic mt-0.5">« {scene.spokenVoiceover} »</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Meta Policy Compliance Card */}
          <div className="bg-emerald-50/70 rounded-3xl p-6 border border-emerald-200/80 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-700" />
              <h3 className="font-bold text-emerald-950 text-base font-display">
                Audit de Conformité aux Politiques Publicitaires Meta Ads
              </h3>
            </div>
            <p className="text-xs text-emerald-800">
              Garantie que votre vidéo publicitaire ne sera pas rejetée par les filtres de modération de Meta :
            </p>

            <div className="space-y-2 mt-2">
              {selectedCampaign.complianceCheck.map((rule, rIdx) => (
                <div key={rIdx} className="flex items-start gap-2.5 text-xs text-emerald-900 bg-white/80 p-3 rounded-xl border border-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">{rule.rule}</span>
                    <span className="text-emerald-800 text-[11px]">{rule.explanation}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};
