import React, { useState } from 'react';
import { Calculator, TrendingUp, AlertTriangle, CheckCircle, Sparkles, DollarSign, ArrowRight } from 'lucide-react';

export const MarginCalculator: React.FC = () => {
  // Configurable parameters
  const [costPrice, setCostPrice] = useState<number>(25.00); // Prix d'achat HT
  const [sellingPrice, setSellingPrice] = useState<number>(79.00); // Prix de vente TTC
  const [vatRate, setVatRate] = useState<number>(20); // 20%
  const [shippingCost, setShippingCost] = useState<number>(4.50); // Emballage + port
  const [adSpendCpa, setAdSpendCpa] = useState<number>(18.00); // Coût d'acquisition pub (CPA)
  const [stripeFeePercent, setStripeFeePercent] = useState<number>(1.5); // 1.5%
  const [stripeFeeFixed, setStripeFeeFixed] = useState<number>(0.25); // 0.25€
  const [monthlyVolume, setMonthlyVolume] = useState<number>(150); // 150 commandes / mois

  // Mathematical calculations
  const priceHT = sellingPrice / (1 + (vatRate / 100));
  const vatAmount = sellingPrice - priceHT;
  const paymentFee = (sellingPrice * (stripeFeePercent / 100)) + stripeFeeFixed;
  const totalCostPerUnit = costPrice + shippingCost + adSpendCpa + paymentFee;
  const netProfit = priceHT - costPrice - shippingCost - adSpendCpa - paymentFee;
  const grossMargin = priceHT - costPrice;
  const grossMarginPercent = priceHT > 0 ? (grossMargin / priceHT) * 100 : 0;
  const netMarginPercent = priceHT > 0 ? (netProfit / priceHT) * 100 : 0;
  const markupMultiplier = costPrice > 0 ? (sellingPrice / costPrice) : 0;
  
  // Break-even ROAS (Return On Ad Spend)
  // Break-even CPA is the maximum you can pay for an ad without losing money (before ads)
  const maxCpaBeforeAds = priceHT - costPrice - shippingCost - paymentFee;
  const breakEvenRoas = maxCpaBeforeAds > 0 ? sellingPrice / maxCpaBeforeAds : 0;

  // Monthly totals
  const monthlyRevenue = sellingPrice * monthlyVolume;
  const monthlyNetProfit = netProfit * monthlyVolume;

  // Presets
  const applyPreset = (cost: number, sell: number, ship: number, cpa: number) => {
    setCostPrice(cost);
    setSellingPrice(sell);
    setShippingCost(ship);
    setAdSpendCpa(cpa);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
        <div>
          <div className="flex items-center space-x-2">
            <Calculator className="w-5 h-5 text-emerald-600" />
            <h1 className="text-xl font-serif font-bold text-stone-900">Simulateur de Marges & ROAS E-Commerce</h1>
          </div>
          <p className="text-xs text-stone-500 mt-0.5">
            Calculez votre rentabilité nette unitaire après coûts d'achat, frais d'envoi, passerelle bancaire, TVA et coût d'acquisition pub.
          </p>
        </div>

        {/* Presets */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-stone-400 mr-1">Préréglages :</span>
          <button
            onClick={() => applyPreset(12, 49, 4.5, 12)}
            className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs rounded-lg font-medium transition-colors"
          >
            Cosmétique Bio
          </button>
          <button
            onClick={() => applyPreset(35, 120, 6, 25)}
            className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs rounded-lg font-medium transition-colors"
          >
            Maroquinerie
          </button>
          <button
            onClick={() => applyPreset(60, 189, 5, 30)}
            className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs rounded-lg font-medium transition-colors"
          >
            High-Tech Audio
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Inputs (7 cols) */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-stone-200 shadow-xs space-y-5 text-xs">
          <h2 className="font-bold text-stone-900 text-sm border-b border-stone-100 pb-3">
            Structure des Coûts du Produit
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Prix d'Achat */}
            <div>
              <label className="block font-semibold text-stone-800 mb-1">
                Prix d'achat fournisseur HT (€)
              </label>
              <input
                type="number"
                step="0.5"
                value={costPrice}
                onChange={(e) => setCostPrice(Math.max(0, Number(e.target.value)))}
                className="w-full px-3 py-2 border border-stone-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-emerald-500/30"
              />
              <span className="text-[11px] text-stone-400 mt-0.5 block">Coût usine unitaire</span>
            </div>

            {/* Prix de Vente TTC */}
            <div>
              <label className="block font-semibold text-stone-800 mb-1">
                Prix de vente client TTC (€)
              </label>
              <input
                type="number"
                step="1"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(Math.max(0, Number(e.target.value)))}
                className="w-full px-3 py-2 border border-stone-300 rounded-xl font-mono text-xs font-bold text-stone-950 focus:ring-2 focus:ring-emerald-500/30"
              />
              <span className="text-[11px] text-stone-400 mt-0.5 block">
                Soit {priceHT.toFixed(2)} € HT (TVA {vatRate}% : {vatAmount.toFixed(2)} €)
              </span>
            </div>

            {/* Frais de Port & Emballage */}
            <div>
              <label className="block font-semibold text-stone-800 mb-1">
                Colis, carton & expédition unitaire (€)
              </label>
              <input
                type="number"
                step="0.5"
                value={shippingCost}
                onChange={(e) => setShippingCost(Math.max(0, Number(e.target.value)))}
                className="w-full px-3 py-2 border border-stone-300 rounded-xl font-mono text-xs"
              />
              <span className="text-[11px] text-stone-400 mt-0.5 block">Carton, calage + affranchissement</span>
            </div>

            {/* Coût Pub par Commande (CPA) */}
            <div>
              <label className="block font-semibold text-stone-800 mb-1">
                CPA Publicité ciblé (Google/Meta/TikTok) (€)
              </label>
              <input
                type="number"
                step="1"
                value={adSpendCpa}
                onChange={(e) => setAdSpendCpa(Math.max(0, Number(e.target.value)))}
                className="w-full px-3 py-2 border border-stone-300 rounded-xl font-mono text-xs"
              />
              <span className="text-[11px] text-stone-400 mt-0.5 block">Coût par achat payé en régie pub</span>
            </div>

            {/* Frais bancaires Stripe */}
            <div>
              <label className="block font-semibold text-stone-800 mb-1">
                Commission Passerelle CB / Stripe
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  step="0.1"
                  value={stripeFeePercent}
                  onChange={(e) => setStripeFeePercent(Number(e.target.value))}
                  className="w-1/2 px-3 py-2 border border-stone-300 rounded-xl font-mono text-xs"
                />
                <span className="text-stone-500 font-mono">% +</span>
                <input
                  type="number"
                  step="0.05"
                  value={stripeFeeFixed}
                  onChange={(e) => setStripeFeeFixed(Number(e.target.value))}
                  className="w-1/2 px-3 py-2 border border-stone-300 rounded-xl font-mono text-xs"
                />
                <span className="text-stone-500 font-mono">€</span>
              </div>
              <span className="text-[11px] text-stone-400 mt-0.5 block">
                Frais déduits : {paymentFee.toFixed(2)} € par vente
              </span>
            </div>

            {/* Volume mensuel */}
            <div>
              <label className="block font-semibold text-stone-800 mb-1">
                Objectif de ventes mensuelles
              </label>
              <input
                type="number"
                step="10"
                min="1"
                value={monthlyVolume}
                onChange={(e) => setMonthlyVolume(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-2 border border-stone-300 rounded-xl font-mono text-xs"
              />
              <span className="text-[11px] text-stone-400 mt-0.5 block">
                Volume de colis expédiés par mois
              </span>
            </div>

          </div>

          {/* Breakdown bar */}
          <div className="pt-4 border-t border-stone-100">
            <span className="font-semibold text-stone-800 text-xs block mb-2">Répartition d'une vente (Prix HT)</span>
            <div className="h-6 w-full rounded-xl overflow-hidden flex text-[10px] font-bold text-white shadow-2xs">
              <div 
                style={{ width: `${Math.max(5, (costPrice / priceHT) * 100)}%` }} 
                className="bg-stone-700 flex items-center justify-center truncate px-1"
                title={`Achat: ${costPrice}€`}
              >
                Achat
              </div>
              <div 
                style={{ width: `${Math.max(5, (shippingCost / priceHT) * 100)}%` }} 
                className="bg-blue-600 flex items-center justify-center truncate px-1"
                title={`Port: ${shippingCost}€`}
              >
                Port
              </div>
              <div 
                style={{ width: `${Math.max(5, (paymentFee / priceHT) * 100)}%` }} 
                className="bg-amber-600 flex items-center justify-center truncate px-1"
                title={`Frais: ${paymentFee.toFixed(2)}€`}
              >
                CB
              </div>
              <div 
                style={{ width: `${Math.max(5, (adSpendCpa / priceHT) * 100)}%` }} 
                className="bg-rose-600 flex items-center justify-center truncate px-1"
                title={`Pub: ${adSpendCpa}€`}
              >
                Pub
              </div>
              <div 
                style={{ width: `${Math.max(5, Math.max(0, netProfit) / priceHT * 100)}%` }} 
                className="bg-emerald-500 flex items-center justify-center truncate px-1"
                title={`Bénéfice Net: ${netProfit.toFixed(2)}€`}
              >
                Net
              </div>
            </div>
          </div>
        </div>

        {/* Right Financial Diagnostics (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          
          {/* Main Profit Card */}
          <div className={`p-6 rounded-2xl border shadow-xs ${
            netProfit > 0 ? 'bg-emerald-950 text-white border-emerald-800' : 'bg-rose-950 text-white border-rose-800'
          }`}>
            <div className="flex items-center justify-between text-xs text-stone-300">
              <span className="uppercase tracking-wider font-semibold">Bénéfice Net par Produit Vendu</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                netProfit > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
              }`}>
                {netProfit > 0 ? 'RENTABLE' : 'DÉFICITAIRE'}
              </span>
            </div>

            <div className="mt-4 flex items-baseline space-x-2">
              <span className="text-4xl font-mono font-bold tracking-tight">
                {netProfit.toFixed(2)} €
              </span>
              <span className="text-sm font-mono text-emerald-300">
                ({netMarginPercent.toFixed(1)}% de marge nette)
              </span>
            </div>

            <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-stone-300 block text-[11px]">Marge Brute :</span>
                <span className="font-mono font-semibold text-white">{grossMargin.toFixed(2)} € ({grossMarginPercent.toFixed(0)}%)</span>
              </div>
              <div>
                <span className="text-stone-300 block text-[11px]">Coeff. Multiplicateur :</span>
                <span className="font-mono font-semibold text-white">x{markupMultiplier.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Break-Even ROAS Card */}
          <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-stone-900">ROAS Minimum (Point Mort Pub)</div>
              <span className="font-mono font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                {breakEvenRoas > 0 ? `${breakEvenRoas.toFixed(2)}x` : 'N/A'}
              </span>
            </div>
            <p className="text-stone-500 text-[11px]">
              Votre publicité doit générer au minimum <strong>{breakEvenRoas.toFixed(2)} € de CA</strong> pour chaque 1,00 € dépensé sur Meta/Google Ads pour être à l'équilibre.
            </p>
            <div className="bg-stone-50 p-2.5 rounded-xl border border-stone-200 text-stone-700 text-[11px]">
              CPA maximum toléré avant perte : <strong className="font-mono">{maxCpaBeforeAds.toFixed(2)} €</strong>
            </div>
          </div>

          {/* Monthly Projection */}
          <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs space-y-3 text-xs">
            <div className="font-semibold text-stone-900">Projection Mensuelle ({monthlyVolume} ventes)</div>
            
            <div className="flex justify-between items-center py-1 border-b border-stone-100">
              <span className="text-stone-500">Chiffre d'Affaires Brut :</span>
              <span className="font-mono font-bold text-stone-900">{monthlyRevenue.toFixed(2)} €</span>
            </div>

            <div className="flex justify-between items-center py-1">
              <span className="text-stone-700 font-semibold">Bénéfice Net Mensuel Réel :</span>
              <span className={`font-mono font-bold text-base ${monthlyNetProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {monthlyNetProfit.toFixed(2)} €
              </span>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};
