import { useState } from 'react';
import { toast } from 'sonner';
import { BarChart3, BookOpen, Download, Image as ImageIcon, Printer, Sparkles, Video } from 'lucide-react';
import { PageHeader } from '@/shared/components/PageHeader';
import { ComplianceBlockedError, checkReportCompliance, exportReportPDF } from '@/shared/lib/complianceGate';
import type { MarketAnalysisReport, MarketRate } from '@/shared/types/analysis';
import type { ReportComplianceVerdict } from '@/shared/types/compliance';
import { Badge } from '@/shared/ui/badge';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import { Button } from '@/shared/ui/button';
import { ComplianceBlockDialog } from '@/shared/ui/ComplianceBlockDialog';
import { LegalNotice } from '@/shared/ui/LegalNotice';
import { RateBadge } from '@/shared/ui/RateBadge';
import { Spinner } from '@/shared/ui/spinner';

interface ReportPDFViewProps {
  report: MarketAnalysisReport;
}

const sectionTitle = 'flex items-center gap-2 border-b pb-2 text-sm font-bold tracking-wide uppercase';

export function ReportPDFView({ report }: ReportPDFViewProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [blockedVerdict, setBlockedVerdict] = useState<ReportComplianceVerdict | null>(null);

  const isExampleReport = report.dataProvenance?.rates?.isDemonstration ?? false;
  const rates: MarketRate[] = [
    report.rates.demand,
    report.rates.saturation,
    report.rates.profitability,
    report.rates.opportunity,
    report.rates.virality,
  ].filter(Boolean);

  const handleDownloadPDF = async () => {
    setIsDownloading(true);
    try {
      await exportReportPDF(report);
      toast.success('Dossier PDF téléchargé');
    } catch (error) {
      if (error instanceof ComplianceBlockedError) {
        setBlockedVerdict(error.verdict);
        return;
      }
      toast.error("Le PDF n'a pas pu être généré", { description: 'Réessayez dans un moment.' });
    } finally {
      setIsDownloading(false);
    }
  };

  /**
   * L'impression produit un document diffusable au même titre qu'un
   * téléchargement : elle passe donc par le même contrôle.
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voir"
        title="Dossier PDF"
        description="L’aperçu du rapport A4 tel qu’il sera téléchargé. Chaque export passe d’abord le contrôle de conformité."
        actions={
          <>
            <Button variant="outline" onClick={handlePrint}>
              <Printer />
              Imprimer
            </Button>
            <Button onClick={handleDownloadPDF} disabled={isDownloading}>
              {isDownloading ? <Spinner /> : <Download />}
              {isDownloading ? 'Génération…' : 'Télécharger le PDF'}
            </Button>
          </>
        }
      />

      {/* Aperçu imprimable : la classe `paper` garde le document blanc en thème sombre. */}
      <article className="paper mx-auto max-w-4xl space-y-8 rounded-xl border bg-card p-6 text-foreground shadow-lg sm:p-12 print:border-none print:p-0 print:shadow-none">
        <header className="space-y-4 rounded-xl bg-foreground p-6 text-background sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-background/15 pb-3 text-xs">
            <BrandLogo size="sm" />
            <span className="opacity-80">Rapport Smart Creator · {report.dateCreated}</span>
          </div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight">
            Dossier d’analyse de marché et de veille concurrentielle
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">Niche : {report.nicheName}</span>
            <span className="flex flex-wrap items-center gap-2">
              {isExampleReport && <Badge variant="info">Rapport d’exemple</Badge>}
              <Badge variant="default">Verdict : {report.overallVerdict}</Badge>
            </span>
          </div>
        </header>

        <section className="space-y-3">
          <h3 className={sectionTitle}>
            <Sparkles className="size-4 text-brand-orange-text" aria-hidden="true" />
            1. Synthèse
          </h3>
          <p className="rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed">{report.executiveSummary}</p>
        </section>

        <section className="space-y-3">
          <h3 className={sectionTitle}>
            <BarChart3 className="size-4 text-brand-green-text" aria-hidden="true" />
            2. Les cinq taux
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {rates.map((rate) => (
              <div key={rate.key} className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{rate.label}</span>
                  <RateBadge level={rate.level} size="sm" />
                </div>
                <span className="font-display text-lg font-extrabold tabular-nums">{rate.score} / 100</span>
                <p className="line-clamp-2 text-xs text-muted-foreground">{rate.description}</p>
              </div>
            ))}
          </div>
        </section>

        {report.illustrativeImages.length > 0 && (
          <section className="space-y-3">
            <h3 className={sectionTitle}>
              <ImageIcon className="size-4 text-brand-green-text" aria-hidden="true" />
              3. Visuels d’illustration
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {report.illustrativeImages.map((image) => (
                <figure key={image.url} className="overflow-hidden rounded-lg border bg-muted/40">
                  <img
                    src={image.url}
                    alt={image.title}
                    referrerPolicy="no-referrer"
                    className="h-44 w-full object-cover"
                    loading="lazy"
                  />
                  <figcaption className="p-3">
                    <span className="block text-sm font-semibold">{image.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{image.caption}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <h3 className={sectionTitle}>
            <BookOpen className="size-4 text-brand-orange-text" aria-hidden="true" />
            4. Idées de produits digitaux
          </h3>
          <div className="space-y-3">
            {report.digitalProducts.map((product) => (
              <div key={product.id} className="space-y-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">{product.title}</h4>
                  <span className="rounded-md border bg-muted/50 px-2.5 py-1 text-sm font-semibold tabular-nums">
                    {product.recommendedPrice} {product.currency} · marge estimée {product.estimatedMarginPercent} %
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Promesse : <span className="font-medium text-foreground">{product.transformationPromise}</span>
                </p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">Format : {product.typeName}</Badge>
                  <Badge variant="outline">Aimant à prospects : {product.leadMagnet.title}</Badge>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className={sectionTitle}>
            <Video className="size-4 text-brand-green-text" aria-hidden="true" />
            5. Scripts vidéo publicitaires
          </h3>
          <div className="space-y-3">
            {report.adCampaigns.map((ad) => (
              <div key={ad.id} className="space-y-2 rounded-lg border p-4 text-sm">
                <p className="font-semibold">
                  Méthode {ad.framework} · format {ad.aspectRatio} · {ad.durationSeconds} s
                </p>
                <p>
                  Accroche 0–3 s : <span className="font-medium">« {ad.hookHeadline} »</span>
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ad.scenes.map((scene) => (
                    <div key={scene.sceneNumber} className="rounded-md border bg-muted/40 p-2">
                      <span className="block text-xs font-semibold">
                        {scene.timing} · {scene.phase}
                      </span>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{scene.onScreenText}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="space-y-3 border-t pt-6">
          <LegalNotice variant="block" />
          <p className="text-center text-xs text-muted-foreground">
            Smart Creator — Veille stratégique &amp; production e-commerce
          </p>
        </footer>
      </article>

      <ComplianceBlockDialog
        verdict={blockedVerdict}
        open={blockedVerdict !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setBlockedVerdict(null);
        }}
      />
    </div>
  );
}
