import React, { useState } from 'react';
import { AlertTriangle, FileDown, FileText, Loader2, PenSquare, Sparkles, Video } from 'lucide-react';
import { ProductExpertEditor } from '@/modules/m03-studio/ProductExpertEditor';
import {
  ProductExportBlockedError,
  ProductExportFormat,
  ProductExportVerdict,
  exportProduct,
} from '@/shared/lib/productExport';
import { useProductDrafts } from '@/shared/lib/useProductDrafts';
import { DigitalProductIdea, MarketAnalysisReport } from '@/shared/types/analysis';
import { ProductExportGateDialog } from '@/shared/ui/ProductExportGateDialog';

/**
 * Barre de production du Studio : modes de création (3.1) et exports contrôlés (3.2, 3.3).
 *
 * Les modes Génératif et Vidéo → Produit sont affichés, désactivés, avec leur
 * raison. Les masquer laisserait croire qu'ils n'ont jamais été prévus ; les
 * activer sans fournisseur produirait un bouton qui échoue à chaque clic.
 */
interface ProductStudioPanelProps {
  /** Produit tel qu'issu du rapport, avant toute retouche. */
  baseProduct: DigitalProductIdea;
  report: MarketAnalysisReport;
}

const UNAVAILABLE_MODES = {
  generative: {
    label: 'Génératif',
    icon: Sparkles,
    reason:
      "La génération d'un produit par IA n'est pas encore implémentée ; elle dépend d'un fournisseur de texte.",
  },
  video: {
    label: 'Vidéo → Produit',
    icon: Video,
    reason:
      "Suppose de transcrire une vidéo puis de la structurer par IA : aucun fournisseur n'est encore branché.",
  },
} as const;

export const ProductStudioPanel: React.FC<ProductStudioPanelProps> = ({ baseProduct, report }) => {
  const drafts = useProductDrafts();
  const product = drafts.effective(baseProduct);
  const hasDraft = drafts.hasDraft(baseProduct.id);

  const [isExpertOpen, setIsExpertOpen] = useState(false);
  const [exporting, setExporting] = useState<ProductExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [blockedVerdict, setBlockedVerdict] = useState<ProductExportVerdict | null>(null);

  const handleExport = async (format: ProductExportFormat) => {
    setExporting(format);
    setExportError(null);

    try {
      await exportProduct(product, report, hasDraft, format);
    } catch (error) {
      if (error instanceof ProductExportBlockedError) {
        setBlockedVerdict(error.verdict);
        return;
      }
      setExportError(error instanceof Error ? error.message : "L'export a échoué.");
    } finally {
      setExporting(null);
    }
  };

  const unavailableModeButton = (mode: (typeof UNAVAILABLE_MODES)[keyof typeof UNAVAILABLE_MODES]) => {
    const Icon = mode.icon;
    return (
      <button
        type="button"
        disabled
        title={mode.reason}
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-dashed border-slate-200 px-3 py-2 text-xs font-bold text-slate-400"
      >
        <Icon className="h-3.5 w-3.5" />
        {mode.label}
      </button>
    );
  };

  return (
    <section className="space-y-4 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Mode de création</p>
          <div className="flex flex-wrap gap-2">
            {unavailableModeButton(UNAVAILABLE_MODES.generative)}
            <button
              type="button"
              onClick={() => setIsExpertOpen((open) => !open)}
              aria-expanded={isExpertOpen}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
                isExpertOpen
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:border-indigo-300'
              }`}
            >
              <PenSquare className="h-3.5 w-3.5" />
              Expert
            </button>
            {unavailableModeButton(UNAVAILABLE_MODES.video)}
          </div>
          <ul className="space-y-0.5 text-[11px] leading-relaxed text-slate-400">
            <li>
              <strong className="font-semibold">{UNAVAILABLE_MODES.generative.label}</strong> —{' '}
              {UNAVAILABLE_MODES.generative.reason}
            </li>
            <li>
              <strong className="font-semibold">{UNAVAILABLE_MODES.video.label}</strong> —{' '}
              {UNAVAILABLE_MODES.video.reason}
            </li>
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {hasDraft && (
            <span className="rounded-md bg-indigo-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
              Version retouchée
            </span>
          )}
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            disabled={exporting !== null}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Export PDF
          </button>
          <button
            type="button"
            onClick={() => handleExport('docx')}
            disabled={exporting !== null}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting === 'docx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            Export DOCX
          </button>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-400">
        Chaque export passe la conformité publicitaire et le contrôle d'originalité, et inclut un
        sommaire cliquable et la liste des sources.
      </p>

      {exportError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <p className="text-xs leading-relaxed text-rose-900">{exportError}</p>
        </div>
      )}

      {isExpertOpen && (
        <ProductExpertEditor
          key={`${baseProduct.id}-${hasDraft}`}
          product={product}
          hasDraft={hasDraft}
          writeFailed={drafts.writeFailed}
          onSave={drafts.saveDraft}
          onDiscard={() => drafts.discardDraft(baseProduct.id)}
        />
      )}

      <ProductExportGateDialog
        verdict={blockedVerdict}
        open={blockedVerdict !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setBlockedVerdict(null);
        }}
      />
    </section>
  );
};
