import { useState } from 'react';
import { AlertTriangle, FileDown, FileText, PenSquare, Sparkles, Video } from 'lucide-react';
import { ProductExpertEditor } from '@/modules/m03-studio/ProductExpertEditor';
import { CoverGenerator } from '@/shared/components/CoverGenerator';
import type { CoverView } from '@/shared/lib/covers';
import {
  ProductExportBlockedError,
  type ProductExportFormat,
  type ProductExportVerdict,
  exportProduct,
} from '@/shared/lib/productExport';
import { useProductDrafts } from '@/shared/lib/useProductDrafts';
import type { DigitalProductIdea, MarketAnalysisReport } from '@/shared/types/analysis';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { ProductExportGateDialog } from '@/shared/ui/ProductExportGateDialog';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Barre de production du Studio : modes de création et exports contrôlés.
 *
 * Les modes Génératif et Vidéo → Produit sont affichés, désactivés, avec leur
 * raison : les masquer laisserait croire qu'ils n'ont jamais été prévus.
 */
interface ProductStudioPanelProps {
  /** Produit tel qu'issu du rapport, avant toute retouche. */
  baseProduct: DigitalProductIdea;
  report: MarketAnalysisReport;
}

const UNAVAILABLE_MODES = [
  {
    label: 'Génératif',
    icon: Sparkles,
    reason: 'La génération d’un produit par IA dépend d’un fournisseur de texte, pas encore branché.',
  },
  {
    label: 'Vidéo → Produit',
    icon: Video,
    reason: 'Transcrire une vidéo puis la structurer demande un fournisseur d’IA, pas encore branché.',
  },
] as const;

export function ProductStudioPanel({ baseProduct, report }: ProductStudioPanelProps) {
  const drafts = useProductDrafts();
  const product = drafts.effective(baseProduct);
  const hasDraft = drafts.hasDraft(baseProduct.id);

  const [isExpertOpen, setIsExpertOpen] = useState(false);
  const [exporting, setExporting] = useState<ProductExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [blockedVerdict, setBlockedVerdict] = useState<ProductExportVerdict | null>(null);
  const [cover, setCover] = useState<CoverView | null>(null);

  const handleExport = async (format: ProductExportFormat) => {
    setExporting(format);
    setExportError(null);
    try {
      await exportProduct(product, report, hasDraft, format, cover?.status === 'ready' ? cover.id : null);
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

  return (
    <Card className="py-5">
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-semibold">Mode de création</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled title={UNAVAILABLE_MODES[0].reason} className="border-dashed">
                <Sparkles />
                Génératif
              </Button>
              <Button
                variant={isExpertOpen ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setIsExpertOpen((open) => !open)}
                aria-expanded={isExpertOpen}
              >
                <PenSquare />
                Expert
              </Button>
              <Button variant="outline" size="sm" disabled title={UNAVAILABLE_MODES[1].reason} className="border-dashed">
                <Video />
                Vidéo → Produit
              </Button>
            </div>
            <ul className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
              {UNAVAILABLE_MODES.map((mode) => (
                <li key={mode.label}>
                  <span className="font-medium text-foreground/80">{mode.label}</span> : {mode.reason}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {hasDraft && <Badge variant="brand">Version retouchée</Badge>}
            <Button variant="outline" size="sm" onClick={() => handleExport('pdf')} disabled={exporting !== null}>
              {exporting === 'pdf' ? <Spinner /> : <FileDown />}
              Export PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport('docx')} disabled={exporting !== null}>
              {exporting === 'docx' ? <Spinner /> : <FileText />}
              Export DOCX
            </Button>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Chaque export passe la conformité publicitaire et le contrôle d’originalité, avec un sommaire cliquable et la
          liste des sources. Une couverture générée ouvre le document.
        </p>

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-semibold">Couverture du PDF</p>
          <CoverGenerator
            key={baseProduct.id}
            subject="product"
            subjectId={baseProduct.id}
            title={product.title}
            subtitle={product.subtitle}
            onChange={setCover}
          />
        </div>

        {exportError && (
          <Alert variant="danger">
            <AlertTriangle />
            <AlertTitle>L’export a échoué</AlertTitle>
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
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
      </CardContent>
    </Card>
  );
}
