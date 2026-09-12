import React, { useState } from 'react';
import { DigitalProductIdea } from '../../types/analysis';
import { motion, AnimatePresence } from 'motion/react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
} from 'recharts';
import {
  Layers,
  BookOpen,
  FileSpreadsheet,
  Video,
  Package,
  Clock,
  Euro,
  Sparkles,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  TrendingUp,
  Percent,
  Gift,
  Sliders as SliderIcon,
  HelpCircle,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

interface DigitalProductsViewProps {
  products: DigitalProductIdea[];
  onSelectProductForAd: (product: DigitalProductIdea) => void;
}

export const DigitalProductsView: React.FC<DigitalProductsViewProps> = ({
  products,
  onSelectProductForAd,
}) => {
  const [selectedProduct, setSelectedProduct] = useState<DigitalProductIdea>(products[0] || null);
  const [salesGoal, setSalesGoal] = useState<number>(50);
  const [customPrice, setCustomPrice] = useState<number>(selectedProduct ? selectedProduct.recommendedPrice : 39);
  const [estimatedMetaCPA, setEstimatedMetaCPA] = useState<number>(12); // Estimated Meta CPA
  const [expandedModule, setExpandedModule] = useState<number | null>(null);

  const handleSelectProduct = (prod: DigitalProductIdea) => {
    setSelectedProduct(prod);
    setCustomPrice(prod.recommendedPrice);
  };

  const getFormatIcon = (type: string) => {
    switch (type) {
      case 'ebook':
        return BookOpen;
      case 'template':
        return FileSpreadsheet;
      case 'masterclass':
        return Video;
      default:
        return Package;
    }
  };

  // Financial calculations
  const grossRevenue = salesGoal * customPrice;
  const totalAdSpend = salesGoal * estimatedMetaCPA;
  const estimatedNetProfit = Math.max(0, grossRevenue - totalAdSpend);
  const netMarginPercent = grossRevenue > 0 ? Math.round((estimatedNetProfit / grossRevenue) * 100) : 0;

  // Chart data for revenue curve
  const projectionData = [10, 25, 50, 75, 100, 150, 200].map((units) => {
    const rev = units * customPrice;
    const ads = units * estimatedMetaCPA;
    const profit = Math.max(0, rev - ads);
    return {
      units: `${units} vtes`,
      ChiffreAffaires: rev,
      DepenseMetaAds: ads,
      BeneficeNet: profit,
    };
  });

  if (!selectedProduct) {
    return (
      <div className="bg-white rounded-3xl p-12 text-center border border-slate-200">
        <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600 font-semibold">Aucun produit digital disponible pour cette thématique.</p>
      </div>
    );
  }

  const FormatIcon = getFormatIcon(selectedProduct.type);

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="amber" className="gap-1.5 py-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Conception de Produits Digitaux à Forte Marge</span>
            </Badge>
            <span className="text-xs text-slate-500 font-medium font-mono">
              Coût de stockage = 0€ · Marge nette &gt; 70%
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight font-display mt-1">
            Studio de Production & Simulateur de Rentabilité
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Concevez, tarifez et simulez la rentabilité de vos e-books, templates Notion et masterclasses avant de lancer vos campagnes Meta Ads.
          </p>
        </div>

        {/* Action Button */}
        <Button
          variant="glow"
          onClick={() => onSelectProductForAd(selectedProduct)}
          className="gap-2 shrink-0 self-start sm:self-auto"
        >
          <Video className="w-4 h-4" />
          <span>Créer Script Vidéo Meta Ads</span>
        </Button>
      </div>

      {/* Product Selection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map((prod) => {
          const isSelected = selectedProduct.id === prod.id;
          const IconComp = getFormatIcon(prod.type);
          return (
            <motion.div
              key={prod.id}
              whileHover={{ y: -2 }}
              onClick={() => handleSelectProduct(prod)}
              className={`cursor-pointer rounded-2xl p-5 border transition-all text-left flex flex-col justify-between ${
                isSelected
                  ? 'bg-white border-indigo-600 ring-2 ring-indigo-500/20 shadow-md'
                  : 'bg-white/80 hover:bg-white border-slate-200 hover:border-slate-300 shadow-xs'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-800">
                    <IconComp className="w-3.5 h-3.5 text-indigo-600" />
                    <span>{prod.typeName}</span>
                  </span>
                  <span className="text-sm font-black text-slate-900 font-mono">
                    {prod.recommendedPrice} €
                  </span>
                </div>

                <h3 className="font-bold text-slate-900 text-base leading-snug line-clamp-2">
                  {prod.title}
                </h3>
                <p className="text-xs text-slate-500 mt-1.5 line-clamp-2">
                  {prod.subtitle}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-emerald-700 font-bold flex items-center gap-1">
                  <Percent className="w-3.5 h-3.5" />
                  <span>{prod.estimatedMarginPercent}% de marge</span>
                </span>
                <span className="text-slate-400 font-medium flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>~{prod.estimatedProductionDays} jours</span>
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Main Selected Product Workbench (Left: Product Architecture, Right: ROI Simulator) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT: Product Content, Modules & Lead Magnet (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Main Info Card */}
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xs space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge variant="indigo" className="font-mono">
                    {selectedProduct.typeName}
                  </Badge>
                  <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                    Marge brute : {selectedProduct.estimatedMarginPercent}%
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-display">
                  {selectedProduct.title}
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  {selectedProduct.subtitle}
                </p>
              </div>

              {/* Direct Action to Meta Ads Video Studio */}
              <Button
                variant="glow"
                size="sm"
                onClick={() => onSelectProductForAd(selectedProduct)}
                className="shrink-0 gap-1.5"
                title="Générer les scripts publicitaires vidéo Meta Ads (AIDA & PAS)"
              >
                <Video className="w-4 h-4" />
                <span>Créer Scripts Ads</span>
              </Button>
            </div>

            {/* Value Proposition & Target Audience */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
                <span className="text-xs font-bold text-slate-600 block mb-1">
                  Audience cible prioritaire :
                </span>
                <p className="text-xs text-slate-800 leading-relaxed font-medium">
                  {selectedProduct.targetAudience}
                </p>
              </div>

              <div className="bg-indigo-50/60 p-4 rounded-2xl border border-indigo-100">
                <span className="text-xs font-bold text-indigo-900 block mb-1">
                  Promesse de transformation :
                </span>
                <p className="text-xs text-indigo-950 leading-relaxed font-medium">
                  {selectedProduct.transformationPromise}
                </p>
              </div>
            </div>

            {/* Table of Contents / Syllabus Modules */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span>Architecture & Modules Prêts à Produire ({selectedProduct.tableOfContents.length})</span>
                </h3>
                <span className="text-[11px] text-slate-400">
                  Cliquez sur un module pour afficher les détails
                </span>
              </div>

              <div className="space-y-2">
                {selectedProduct.tableOfContents.map((mod) => {
                  const isExpanded = expandedModule === mod.moduleNumber;
                  return (
                    <div
                      key={mod.moduleNumber}
                      onClick={() => setExpandedModule(isExpanded ? null : mod.moduleNumber)}
                      className="cursor-pointer bg-slate-50/70 hover:bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white text-xs font-black flex items-center justify-center font-mono">
                            {mod.moduleNumber}
                          </span>
                          <span className="text-xs sm:text-sm font-bold text-slate-900">
                            {mod.title}
                          </span>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        )}
                      </div>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-2.5 pt-2.5 border-t border-slate-200/60 text-xs text-slate-600 pl-8"
                          >
                            {mod.details}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Lead Magnet Box */}
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-5 border border-amber-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                  <Gift className="w-4 h-4 text-amber-600" />
                  Lead Magnet d'Acquisition Gratuit (Pour Capter des Prospects)
                </span>
                <span className="text-[11px] font-bold text-amber-900 bg-white px-2 py-0.5 rounded border border-amber-200">
                  {selectedProduct.leadMagnet.format}
                </span>
              </div>
              <h4 className="font-bold text-slate-900 text-sm">
                « {selectedProduct.leadMagnet.title} »
              </h4>
              <p className="text-xs text-amber-950/90 leading-relaxed">
                {selectedProduct.leadMagnet.hook}
              </p>
            </div>

          </div>

        </div>

        {/* RIGHT: Financial ROI & Meta Ads Simulator (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xs space-y-6">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-slate-900 text-lg font-display">
                Simulateur de Rentabilité & Marge Nette
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Ajustez le prix et l'objectif de vente pour calculer le profit net après dépenses Meta Ads.
            </p>
          </div>

          {/* Sliders & Controls */}
          <div className="space-y-4 bg-slate-50/70 p-5 rounded-2xl border border-slate-200/60 text-xs">
            
            {/* Sales Volume Slider */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="font-bold text-slate-700">Objectif de Ventes :</span>
                <span className="font-mono font-black text-indigo-600 text-sm bg-white px-2.5 py-0.5 rounded border border-indigo-200">
                  {salesGoal} clients
                </span>
              </div>
              <input
                type="range"
                min="5"
                max="200"
                step="5"
                value={salesGoal}
                onChange={(e) => setSalesGoal(Number(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>5 ventes</span>
                <span>100 ventes</span>
                <span>200 ventes</span>
              </div>
            </div>

            {/* Custom Price Slider */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="font-bold text-slate-700">Prix de Vente Unitaire :</span>
                <span className="font-mono font-black text-slate-900 text-sm bg-white px-2.5 py-0.5 rounded border border-slate-200">
                  {customPrice} €
                </span>
              </div>
              <input
                type="range"
                min="9"
                max="199"
                step="5"
                value={customPrice}
                onChange={(e) => setCustomPrice(Number(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>9 €</span>
                <span>97 €</span>
                <span>199 €</span>
              </div>
            </div>

            {/* Meta CPA Estimation */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="font-bold text-slate-700">Coût d'Acquisition Pub (CPA Meta Ads) :</span>
                <span className="font-mono font-bold text-rose-600 text-xs bg-white px-2 py-0.5 rounded border border-rose-200">
                  {estimatedMetaCPA} € / vente
                </span>
              </div>
              <input
                type="range"
                min="4"
                max="40"
                step="2"
                value={estimatedMetaCPA}
                onChange={(e) => setEstimatedMetaCPA(Number(e.target.value))}
                className="w-full accent-rose-600 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>4 € (Viral)</span>
                <span>20 € (Moyen)</span>
                <span>40 € (Compétitif)</span>
              </div>
            </div>

          </div>

          {/* Metric KPI Results */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Chiffre d'Affaires Brut
              </span>
              <span className="text-xl font-black text-slate-900 font-mono mt-1 block">
                {grossRevenue.toLocaleString('fr-FR')} €
              </span>
            </div>

            <div className="bg-rose-50/60 p-4 rounded-2xl border border-rose-100">
              <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider block">
                Budget Pub Meta Ads
              </span>
              <span className="text-xl font-black text-rose-700 font-mono mt-1 block">
                {totalAdSpend.toLocaleString('fr-FR')} €
              </span>
            </div>
          </div>

          {/* Big Net Profit Card */}
          <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white p-6 rounded-3xl shadow-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-100 uppercase tracking-wider">
                Bénéfice Net Estimé
              </span>
              <span className="text-xs font-black bg-white/20 px-2 py-0.5 rounded-full font-mono">
                {netMarginPercent}% de marge nette
              </span>
            </div>

            <div className="text-3xl sm:text-4xl font-black tracking-tight font-mono">
              + {estimatedNetProfit.toLocaleString('fr-FR')} €
            </div>

            <p className="text-xs text-emerald-100/90 leading-relaxed pt-1">
              Sur un produit digital, aucun coût d'emballage ni d'expédition physique n'est prélevé. Le bénéfice est quasi-intégralement encaissable.
            </p>
          </div>

          {/* Recharts Revenue vs Profit Curve */}
          <div className="pt-2">
            <span className="text-xs font-bold text-slate-700 block mb-2">
              Courbe d'Accélération du Profit Net :
            </span>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={projectionData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="profitColor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="units" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <RechartsTooltip
                    content={({ payload }) => {
                      if (!payload || !payload.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-slate-900 text-white p-2.5 rounded-xl text-xs space-y-1">
                          <p className="font-bold">{d.units}</p>
                          <p className="text-emerald-400 font-mono">Profit net : {d.BeneficeNet} €</p>
                          <p className="text-slate-300 font-mono">CA : {d.ChiffreAffaires} €</p>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="BeneficeNet"
                    stroke="#059669"
                    fillOpacity={1}
                    fill="url(#profitColor)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};
