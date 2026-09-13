import React, { useState } from 'react';
import { MarketAnalysisReport, MarketRate } from '@/shared/types/analysis';
import {
  ComplianceBlockedError,
  checkReportCompliance,
  exportReportPDF,
} from '@/shared/lib/complianceGate';
import { ReportComplianceVerdict } from '@/shared/types/compliance';
import { ComplianceBlockDialog } from '@/shared/ui/ComplianceBlockDialog';
import { RateBadge } from '@/shared/ui/RateBadge';
import { LegalNotice } from '@/shared/ui/LegalNotice';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import {
  Download,
  Printer,
  Sparkles,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  BarChart3,
  BookOpen,
  Video,
} from 'lucide-react';

interface ReportPDFViewProps {
  report: MarketAnalysisReport;
}

export const ReportPDFView: React.FC<ReportPDFViewProps> = ({ report }) => {
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);
  const [blockedVerdict, setBlockedVerdict] = useState<ReportComplianceVerdict | null>(null);

  const handleDownloadPDF = async () => {
    try {
      setIsDownloading(true);
      await exportReportPDF(report);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3500);
    } catch (err) {
      if (err instanceof ComplianceBlockedError) {
        setBlockedVerdict(err.verdict);
        return;
      }
      console.error('Erreur génération PDF:', err);
      alert('Impossible de générer le PDF. Veuillez réessayer.');
    } finally {
      setIsDownloading(false);
    }
  };

  /**
   * L'impression produit un document diffusable au même titre qu'un
   * téléchargement : elle passe donc par le même contrôle. La laisser libre
   * aurait fait de la fenêtre d'impression le contournement le plus simple du veto.
   */
  const handlePrint = async () => {
    const verdict = await checkReportCompliance(report);

    if (!verdict.exportAllowed) {
      setBlockedVerdict(verdict);
      return;
    }

    window.print();
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      
      {/* Top Controls Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md">
              Dossier Stratégique Illustré
            </span>
            <span className="text-xs text-slate-500 font-medium">
              Export Haute Définition A4
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-display mt-1">
            Rapport PDF avec Visuels & Données Illustratives
          </h1>
          <p className="text-xs text-slate-500">
            Dossier d'aide à la décision complet : analyse des taux, benchmark concurrents, produits digitaux et scripts Meta Ads.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            <Printer className="w-4 h-4" />
            <span>Imprimer</span>
          </button>

          <button
            onClick={handleDownloadPDF}
            disabled={isDownloading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-all disabled:opacity-50"
          >
            {isDownloading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Génération du PDF...</span>
              </>
            ) : downloadSuccess ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-white" />
                <span>Téléchargé avec succès !</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Télécharger le PDF (.pdf)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Printable Preview Document (A4 Mockup) */}
      <div className="bg-white rounded-2xl border border-slate-300 shadow-lg p-6 sm:p-12 max-w-4xl mx-auto space-y-8 font-sans print:shadow-none print:border-none print:p-0">
        
        {/* Document Header */}
        <div className="bg-slate-950 text-white p-6 sm:p-8 rounded-2xl space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400 pb-3 border-b border-slate-800">
            <BrandLogo size="sm" />
            <span className="font-mono">Rapport Officiel · {report.dateCreated}</span>
          </div>

          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight uppercase font-display">
            DOSSIER STRATÉGIQUE D'ANALYSE DE MARCHÉ & VEILLE CONCURRENTIELLE
          </h2>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs">
            <span className="text-emerald-400 font-semibold font-mono">
              Thématique : {report.nicheName}
            </span>
            <span className="bg-emerald-600 text-white px-3 py-1 rounded-full font-bold">
              Verdict : {report.overallVerdict}
            </span>
          </div>
        </div>

        {/* Section 1: Executive Summary */}
        <div className="space-y-2">
          <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider border-b border-slate-200 pb-1.5 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>1. Synthèse Exécutive de la Veille Web</span>
          </h3>
          <p className="text-xs sm:text-sm text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100">
            {report.executiveSummary}
          </p>
        </div>

        {/* Section 2: Notation par Taux */}
        <div className="space-y-3">
          <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider border-b border-slate-200 pb-1.5 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            <span>2. Notation Stratégique par Taux (Demande, Saturation, Rentabilité)</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              report.rates.demand,
              report.rates.saturation,
              report.rates.profitability,
              report.rates.opportunity,
              report.rates.virality,
            ]
              .filter(Boolean)
              .map((rate: MarketRate) => (
                <div key={rate.key} className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">{rate.label}</span>
                    <RateBadge level={rate.level} size="sm" />
                  </div>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="text-base font-black text-slate-900">{rate.score} / 100</span>
                    <span className="text-[11px] text-slate-500 font-medium">Taux {rate.level}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">
                    {rate.description}
                  </p>
                </div>
              ))}
          </div>
        </div>

        {/* Section 3: Illustrative Images Showcase ("Créer un PDF avec des images illustratif") */}
        <div className="space-y-3">
          <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider border-b border-slate-200 pb-1.5 flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-rose-500" />
            <span>3. Images Illustratives & Visuels du Produit Digital</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {report.illustrativeImages.map((img, idx) => (
              <div key={idx} className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                <img
                  src={img.url}
                  alt={img.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-44 object-cover"
                />
                <div className="p-3">
                  <h4 className="font-bold text-xs text-slate-900">{img.title}</h4>
                  <p className="text-[11px] text-slate-600 mt-0.5">{img.caption}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4: Digital Products Overview */}
        <div className="space-y-3">
          <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider border-b border-slate-200 pb-1.5 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-amber-600" />
            <span>4. Produits Digitaux Validés pour la Niche</span>
          </h3>

          <div className="space-y-3">
            {report.digitalProducts.map((prod) => (
              <div key={prod.id} className="p-4 rounded-xl border border-amber-200 bg-amber-50/40">
                <div className="flex items-center justify-between text-xs">
                  <h4 className="font-bold text-slate-900 text-sm">{prod.title}</h4>
                  <span className="font-extrabold text-slate-900 bg-white px-2.5 py-1 rounded-lg border border-amber-300">
                    {prod.recommendedPrice} € (Marge : {prod.estimatedMarginPercent}%)
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-1">
                  Promesse : <span className="font-semibold text-slate-800">{prod.transformationPromise}</span>
                </p>
                <div className="mt-2 text-[11px] text-slate-500 flex flex-wrap gap-2">
                  <span className="bg-white px-2 py-0.5 rounded border border-slate-200">
                    Format : {prod.typeName}
                  </span>
                  <span className="bg-white px-2 py-0.5 rounded border border-slate-200">
                    Lead Magnet : {prod.leadMagnet.title}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 5: Meta Ads Strategy Overview */}
        <div className="space-y-3">
          <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider border-b border-slate-200 pb-1.5 flex items-center gap-2">
            <Video className="w-4 h-4 text-rose-600" />
            <span>5. Scripts Vidéo Publicitaires Meta Ads (AIDA & PAS)</span>
          </h3>

          <div className="space-y-3">
            {report.adCampaigns.map((ad) => (
              <div key={ad.id} className="p-4 rounded-xl border border-sky-200 bg-sky-50/40 text-xs space-y-2">
                <div className="flex items-center justify-between font-bold text-sky-900">
                  <span>Méthode {ad.framework} — Format {ad.aspectRatio} ({ad.durationSeconds}s)</span>
                  <span className="text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                    100% Conforme Meta Ads
                  </span>
                </div>
                <p className="font-bold text-slate-900">
                  Hook 0-3s : « {ad.hookHeadline} »
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {ad.scenes.map((s) => (
                    <div key={s.sceneNumber} className="bg-white p-2 rounded border border-sky-100">
                      <span className="font-bold text-sky-800 block text-[10px]">{s.timing} ({s.phase})</span>
                      <p className="text-[10px] text-slate-700 mt-0.5 line-clamp-2">{s.onScreenText}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Document Footer */}
        <div className="pt-6 border-t border-slate-200 space-y-3">
          {/* Mention légale obligatoire — CdC §9.4. */}
          <LegalNotice variant="block" />
          <p className="text-center text-xs text-slate-400">
            Smart Creator — Intelligence Économique & Studio de Création de Produits Digitaux
          </p>
        </div>

      </div>

      <ComplianceBlockDialog
        verdict={blockedVerdict}
        open={blockedVerdict !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setBlockedVerdict(null);
        }}
      />

    </div>
  );
};
