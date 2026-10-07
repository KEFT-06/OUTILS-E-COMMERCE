import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, BookOpen, FileDown, FileText, PenSquare, Sparkles } from 'lucide-react';
import { LongformEbookPanel } from '@/modules/studio/LongformEbookPanel';
import { ProductExpertEditor } from '@/modules/studio/ProductExpertEditor';
import { ProductPreviewPanel } from '@/modules/studio/ProductPreviewPanel';
import { useEbookJob } from '@/modules/studio/useEbookJob';
import { BookCover } from '@/shared/components/BookCover';
import { CoverGenerator } from '@/shared/components/CoverGenerator';
import { downloadBookCover } from '@/shared/lib/downloadBookCover';
import { rememberProductCover } from '@/shared/stores/useProductCovers';
import { WritingFindings } from '@/shared/components/WritingFindings';
import { type CoverView, coversApi } from '@/shared/lib/covers';
import {
  ProductExportBlockedError,
  type ProductExportFormat,
  type ProductExportVerdict,
  exportProduct,
} from '@/modules/studio/export/productExport';
import { useProductDrafts } from '@/shared/stores/useProductDrafts';
import { useProviders } from '@/shared/hooks/useProviders';
import type { EbookResult, WritingFinding } from '@/shared/lib/writing';
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
import { ProductExportGateDialog } from '@/modules/studio/ProductExportGateDialog';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Barre de production du Studio : modes de création et exports contrôlés.
 *
 * Mode Génératif : le contenu de chaque module est rédigé, puis l'ouvrage s'ouvre dans
 * « Voir l'ebook » — on le lit composé comme un livre, on le corrige et on le télécharge au même
 * endroit. Le mode Expert reste pour retravailler le plan lui-même (titres, ordre des modules).
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
  const product = drafts.effective(baseProduct);
  const hasDraft = drafts.hasDraft(baseProduct.id);

  const [isExpertOpen, setIsExpertOpen] = useState(initialExpertOpen);
  /** Change après une rédaction : l'éditeur repart du nouveau brouillon. */
  const [editorRevision, setEditorRevision] = useState(0);
  const [exporting, setExporting] = useState<ProductExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [blockedVerdict, setBlockedVerdict] = useState<ProductExportVerdict | null>(null);
  const [cover, setCover] = useState<CoverView | null>(null);
  const [downloadingCover, setDownloadingCover] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  /** Vrai quand l'ouvrage vient d'être rédigé : la vue s'ouvre et vient à l'écran d'elle-même. */
  const [justWritten, setJustWritten] = useState(false);
  const [findings, setFindings] = useState<WritingFinding[]>([]);
  /** Pages du dernier ebook long rédigé : sert à proposer de l'allonger. */
  const [writtenPages, setWrittenPages] = useState<number | null>(null);

  const textReady = providers?.text ?? false;
  const generativeReason = providers && !textReady ? 'La rédaction automatique est momentanément indisponible.' : null;

  /** `version` : l'ouvrage tel qu'il est à l'écran dans « Voir l'ebook », corrections en attente comprises. */
  const handleExport = async (format: ProductExportFormat, version: DigitalProductIdea = product) => {
    setExporting(format);
    setExportError(null);
    try {
      await exportProduct(version, report, format, cover?.status === 'ready' ? cover.id : null);
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

  /**
   * Le texte rédigé rejoint le brouillon, et l'ouvrage s'ouvre pour être LU : c'est là qu'on le
   * corrige et qu'on le télécharge.
   *
   * Contenu d'un produit dont l'auteur avait un plan : on ne remplace que le contenu, module par
   * module, et son sommaire reste le sien. Sinon — produit saisi sans plan, ou ebook long — le
   * plan de l'ouvrage DEVIENT le sommaire, en gardant la numérotation attendue par l'éditeur et
   * l'export.
   */
  const receive = (result: EbookResult) => {
    const keepsPlan = result.kind === 'product' && product.tableOfContents.length > 0;
    const contentOf = (position: number) => result.chapters.find((chapter) => chapter.index === position)?.content;
    const missing = keepsPlan ? product.tableOfContents.filter((_, index) => !contentOf(index + 1)).length : 0;
    drafts.saveDraft({
      ...product,
      tableOfContents: keepsPlan
        ? product.tableOfContents.map((module, index) => ({ ...module, details: contentOf(index + 1) ?? module.details }))
        : result.chapters.map((chapter, index) => ({ moduleNumber: index + 1, title: chapter.title, details: chapter.content })),
    });
    setFindings(result.findings);
    setEditorRevision((revision) => revision + 1);
    setIsExpertOpen(false);
    setIsPreviewOpen(true);
    setJustWritten(true);
    setWrittenPages(result.kind === 'ebook' ? result.pages : null);
    toast.success('Votre ebook est prêt', {
      description:
        missing > 0
          ? `${missing} module(s) n’ont pas été rédigés et gardent leur texte. Lisez-le ci-dessous, corrigez-le, puis téléchargez-le.`
          : `${result.pages} pages environ. Lisez-le ci-dessous, corrigez ce qui doit l’être, puis téléchargez-le.`,
    });
  };

  const writing = useEbookJob({ productId: baseProduct.id, onWritten: receive });
  const isWriting = writing.isRunning || writing.isStarting;

  /**
   * « Génératif » : le contenu de chaque module, écrit sur le serveur module par module et
   * enregistré à mesure. Une coupure ne coûte plus rien : la rédaction reprend d'elle-même.
   */
  const generate = () => {
    setGenerateOpen(false);
    const chapters = product.tableOfContents.map((module) => ({ title: module.title || `Module ${module.moduleNumber}`, details: module.details }));
    void writing.start('product_generation', {
      kind: 'product',
      productId: baseProduct.id,
      title: product.title,
      subtitle: product.subtitle,
      typeName: product.typeName,
      targetAudience: product.targetAudience,
      transformationPromise: product.transformationPromise,
      chapters,
      market: report?.market ?? null,
      // La longueur d'un produit est fixée par le serveur d'après ses modules : cette valeur n'est qu'indicative.
      targetPages: Math.max(3, chapters.length * 2),
    });
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
              {/*
                L'aperçu n'est pas un quatrième mode de création : c'est l'endroit où l'on LIT ce
                qu'on vient d'écrire, avant de le télécharger. Il vient donc après les deux modes.
              */}
              <Button
                variant={isPreviewOpen ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => {
                  setJustWritten(false);
                  setIsPreviewOpen((open) => !open);
                }}
                aria-expanded={isPreviewOpen}
              >
                <BookOpen />
                Voir l’ebook
              </Button>
            </div>
            <ul className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
              <li>
                <span className="font-medium text-foreground/80">Génératif</span> :{' '}
                {generativeReason ?? 'chaque module est rédigé à partir du titre, de la promesse et du sommaire.'}
              </li>
              <li>
                <span className="font-medium text-foreground/80">Voir l’ebook</span> : l’ouvrage composé comme un livre, à lire, corriger
                et télécharger au même endroit.
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

        <WritingFindings findings={findings} />

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-semibold">Couverture</p>
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="w-36 shrink-0 space-y-2 sm:w-40">
              <BookCover
                title={product.title}
                subtitle={product.subtitle}
                label={product.typeName}
                imageUrl={cover?.status === 'ready' ? coversApi.imageUrl(cover) : null}
                seed={baseProduct.id}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={downloadingCover}
                onClick={() => {
                  setDownloadingCover(true);
                  void downloadBookCover({
                    imageUrl: cover?.status === 'ready' ? coversApi.imageUrl(cover) : null,
                    text: { title: product.title, subtitle: product.subtitle, label: product.typeName },
                    seed: baseProduct.id,
                  })
                    .catch(() => toast.error('La couverture n’a pas pu être téléchargée', { description: 'Relancez le téléchargement.' }))
                    .finally(() => setDownloadingCover(false));
                }}
              >
                {downloadingCover ? <Spinner /> : <FileDown />}
                Télécharger
              </Button>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Cette couverture ouvre le PDF et le DOCX, et accompagne le produit partout sur le site. Ajoutez-lui une illustration :
                le titre reste posé dessus.
              </p>
              <CoverGenerator
                key={baseProduct.id}
                subject="product"
                subjectId={baseProduct.id}
                title={product.title}
                subtitle={product.subtitle}
                hidePreview
                onChange={(next) => {
                  setCover(next);
                  rememberProductCover(baseProduct.id, next);
                }}
              />
            </div>
          </div>
        </div>

        {exportError && (
          <Alert variant="danger">
            <AlertTriangle />
            <AlertTitle>L’export a échoué</AlertTitle>
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
        )}

        {textReady && (
          <LongformEbookPanel product={product} market={report?.market ?? null} writing={writing} />
        )}

        {writtenPages !== null && (
          <Alert variant="info">
            <AlertDescription>
              Environ {writtenPages} pages rédigées. Trop court à votre goût ? Relancez la rédaction avec une longueur
              plus grande : le brouillon actuel sera remplacé.
            </AlertDescription>
          </Alert>
        )}

        {isPreviewOpen && (
          <ProductPreviewPanel
            // Repart du brouillon courant après chaque rédaction ou enregistrement.
            key={`apercu-${baseProduct.id}-${editorRevision}`}
            product={product}
            market={report?.market ?? null}
            onSave={(modifie) => {
              drafts.saveDraft(modifie);
              setEditorRevision((revision) => revision + 1);
              toast.success('Modifications enregistrées', { description: 'Elles partiront dans le prochain export.' });
            }}
            onFindings={setFindings}
            onExport={(format, version) => void handleExport(format, version)}
            exporting={exporting}
            scrollIntoView={justWritten}
          />
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
              <DialogTitle>
                {product.tableOfContents.length === 0 ? 'Structurer et rédiger le produit' : 'Rédiger le contenu du produit'}
              </DialogTitle>
              <DialogDescription>
                {/*
                  Un produit saisi à la main n'a souvent qu'un titre et une intention. Dire ici que
                  l'IA compose aussi le plan évite de laisser croire qu'il faut l'écrire d'abord.
                */}
                {product.tableOfContents.length === 0 ? (
                  <>
                    Le plan de « {product.title} » (6 modules) est composé puis rédigé. Vous relisez et modifiez tout avant
                    l’export.
                  </>
                ) : (
                  <>
                    Les {product.tableOfContents.length} modules de « {product.title} » sont rédigés à partir du titre, de la
                    promesse et de vos notes. Le texte actuel des modules est remplacé.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2">
              <DialogClose asChild>
                <Button variant="outline">Annuler</Button>
              </DialogClose>
              <Button onClick={generate}>
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
