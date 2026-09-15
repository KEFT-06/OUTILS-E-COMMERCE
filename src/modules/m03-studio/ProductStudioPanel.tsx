import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, FileDown, FileText, PenSquare, Sparkles } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { ProductExpertEditor } from '@/modules/m03-studio/ProductExpertEditor';
import { CoverGenerator } from '@/shared/components/CoverGenerator';
import { WritingFindings } from '@/shared/components/WritingFindings';
import { toApiError } from '@/shared/lib/apiError';
import type { CoverView } from '@/shared/lib/covers';
import {
  ProductExportBlockedError,
  type ProductExportFormat,
  type ProductExportVerdict,
  exportProduct,
} from '@/shared/lib/productExport';
import { useProductDrafts } from '@/shared/lib/useProductDrafts';
import { useProviders } from '@/shared/lib/useProviders';
import { type WritingFinding, writingApi } from '@/shared/lib/writing';
import type { DigitalProductIdea, MarketAnalysisReport } from '@/shared/types/analysis';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { ProductExportGateDialog } from '@/shared/ui/ProductExportGateDialog';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Barre de production du Studio : modes de création et exports contrôlés.
 *
 * Mode Génératif : l'IA rédige le contenu de chaque module ; le résultat devient
 * un brouillon à relire dans le mode Expert, jamais une version définitive.
 * Le mode Vidéo → Produit crée un nouveau produit : il se lance depuis l'en-tête du Studio.
 */
interface ProductStudioPanelProps {
  /** Produit dans sa version d'origine, avant toute retouche. */
  baseProduct: DigitalProductIdea;
  /** Rapport dont vient le produit ; null pour un produit créé hors analyse. */
  report: MarketAnalysisReport | null;
  /** Ouvre le mode Expert dès l'affichage (produit qui vient d'être créé). */
  initialExpertOpen?: boolean;
}

export function ProductStudioPanel({ baseProduct, report, initialExpertOpen = false }: ProductStudioPanelProps) {
  const drafts = useProductDrafts();
  const providers = useProviders();
  const { runWithCredits } = useCreditGate();
  const product = drafts.effective(baseProduct);
  const hasDraft = drafts.hasDraft(baseProduct.id);

  const [isExpertOpen, setIsExpertOpen] = useState(initialExpertOpen);
  /** Change après une rédaction : l'éditeur repart du nouveau brouillon. */
  const [editorRevision, setEditorRevision] = useState(0);
  const [exporting, setExporting] = useState<ProductExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [blockedVerdict, setBlockedVerdict] = useState<ProductExportVerdict | null>(null);
  const [cover, setCover] = useState<CoverView | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [findings, setFindings] = useState<WritingFinding[]>([]);

  const textReady = providers?.text ?? false;
  const generativeReason = providers && !textReady ? 'La rédaction par IA n’est pas configurée sur le serveur.' : null;

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

  const generate = async () => {
    setGenerateOpen(false);
    setIsWriting(true);
    try {
      const result = await runWithCredits('product_generation', () =>
        writingApi.product({
          product: {
            title: product.title,
            subtitle: product.subtitle,
            typeName: product.typeName,
            targetAudience: product.targetAudience,
            transformationPromise: product.transformationPromise,
            modules: product.tableOfContents.map((module) => ({ title: module.title || `Module ${module.moduleNumber}`, details: module.details })),
          },
          market: report?.market ?? null,
        }),
      );
      if (!result) return;

      drafts.saveDraft({
        ...product,
        tableOfContents: product.tableOfContents.map((module, index) => ({ ...module, details: result.modules[index]?.details ?? module.details })),
      });
      setFindings(result.findings);
      setEditorRevision((revision) => revision + 1);
      setIsExpertOpen(true);
      toast.success('Contenu rédigé', {
        description:
          result.missing > 0
            ? `${result.missing} module(s) n’ont pas été rédigés et gardent leur texte. Relisez le brouillon avant l’export.`
            : 'Le brouillon est ouvert dans le mode Expert : relisez-le avant l’export.',
      });
    } catch (error) {
      toast.error('La rédaction n’a pas abouti', { description: toApiError(error, 'Réessayez dans un moment.').message });
    } finally {
      setIsWriting(false);
    }
  };

  return (
    <Card className="py-5">
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-semibold">Mode de création</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!textReady || isWriting}
                title={generativeReason ?? undefined}
                className={textReady ? undefined : 'border-dashed'}
                onClick={() => setGenerateOpen(true)}
              >
                {isWriting ? <Spinner /> : <Sparkles />}
                {isWriting ? 'Rédaction…' : 'Génératif'}
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
            </div>
            <ul className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
              <li>
                <span className="font-medium text-foreground/80">Génératif</span> :{' '}
                {generativeReason ?? 'l’IA rédige chaque module à partir du titre, de la promesse et du sommaire, en brouillon à relire.'}
              </li>
              <li>
                <span className="font-medium text-foreground/80">Vidéo → Produit</span> : bouton « Depuis une vidéo », en haut du
                Studio.
              </li>
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

        <WritingFindings findings={findings} />

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
            key={`${baseProduct.id}-${hasDraft}-${editorRevision}`}
            product={product}
            hasDraft={hasDraft}
            writeFailed={drafts.writeFailed}
            onSave={drafts.saveDraft}
            onDiscard={() => drafts.discardDraft(baseProduct.id)}
          />
        )}

        <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Rédiger le contenu du produit</DialogTitle>
              <DialogDescription>
                L’IA rédige les {product.tableOfContents.length} modules de « {product.title} » à partir du titre, de la
                promesse et de vos notes. Le texte actuel des modules est remplacé dans votre brouillon ; la version
                d’origine reste disponible.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Aucun chiffre, témoignage ou promesse de gain n’est demandé à l’IA ; les données locales à ajouter sont
              marquées « [à compléter] ». Le coût en points s’affiche à l’étape suivante.
            </p>
            <DialogFooter className="gap-2 sm:gap-2">
              <DialogClose asChild>
                <Button variant="outline">Annuler</Button>
              </DialogClose>
              <Button onClick={() => void generate()}>
                <Sparkles />
                Continuer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
