import { useState } from 'react';
import { toast } from 'sonner';
import { BarChart3, BookOpen, Download, Globe, Image as ImageIcon, Printer, Sparkles, Users, Video } from 'lucide-react';
import { PageHeader } from '@/shared/components/PageHeader';
import { ComplianceBlockedError, checkReportCompliance, exportReportPDF } from '@/shared/lib/complianceGate';
import { blockProvenance, researchLine, writerLine } from '@/shared/lib/reportProvenance';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import type { MarketAnalysisReport, MarketRate } from '@/shared/types/analysis';
import type { ReportComplianceVerdict } from '@/shared/types/compliance';
import { Badge } from '@/shared/ui/badge';
import { BrandLogo } from '@/shared/components/BrandLogo';
import { Button } from '@/shared/ui/button';
import { ComplianceBlockDialog } from '@/shared/components/ComplianceBlockDialog';
import { LegalNotice } from '@/modules/analyse/LegalNotice';
import { usageBySource } from '@/shared/lib/sourceUsage';
import { RateBadge } from '@/shared/components/RateBadge';
import { Spinner } from '@/shared/ui/spinner';

interface ReportPDFViewProps {
  report: MarketAnalysisReport;
}

const sectionTitle = 'flex items-center gap-2 border-b pb-2 text-sm font-bold tracking-wide uppercase';

function rateValue(rate: MarketRate): string {
  if (rate.score !== null) return `${rate.score} / 100`;
  if (rate.basis === 'assessment') return 'Appréciation sourcée';
  return 'Non évalué';
}

export function ReportPDFView({ report }: ReportPDFViewProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [blockedVerdict, setBlockedVerdict] = useState<ReportComplianceVerdict | null>(null);

  const isExampleReport = report.dataProvenance?.rates?.isDemonstration ?? false;
  const sources = report.groundingSources ?? [];
  const sourceUsage = usageBySource(report);
  const limitations = report.limitations ?? [];
  const rates: MarketRate[] = [
    report.rates.demand,
    report.rates.saturation,
    report.rates.profitability,
    report.rates.opportunity,
    report.rates.virality,
  ].filter(Boolean);

  // Numérotation continue : une section absente ne laisse pas de trou.
  let sectionNumber = 0;
  const numbered = (title: string) => `${(sectionNumber += 1)}. ${title}`;

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
              <Badge variant="default">Verdict : {report.overallVerdict ?? 'non établi'}</Badge>
            </span>
          </div>
        </header>

        <section className="space-y-3">
          <h3 className={sectionTitle}>
            <Sparkles className="size-4 text-brand-orange-text" aria-hidden="true" />
            {numbered('Synthèse')}
          </h3>
          <div className="space-y-2 rounded-lg border bg-muted/50 p-4">
            <p className="text-sm leading-relaxed">{report.executiveSummary}</p>
            {report.verdictRationale && <p className="text-xs text-muted-foreground">{report.verdictRationale}</p>}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className={sectionTitle}>
            <BarChart3 className="size-4 text-brand-green-text" aria-hidden="true" />
            {numbered('Les cinq taux')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {rates.map((rate) => (
              <div key={rate.key} className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{rate.label}</span>
                  <RateBadge level={rate.level} size="sm" />
                </div>
                <span className={rate.score !== null ? 'font-display text-lg font-extrabold tabular-nums' : 'text-xs font-medium text-muted-foreground'}>
                  {rateValue(rate)}
                </span>
                <p className="line-clamp-3 text-xs text-muted-foreground">{rate.description}</p>
              </div>
            ))}
          </div>
        </section>

        {report.illustrativeImages.length > 0 && (
          <section className="space-y-3">
            <h3 className={sectionTitle}>
              <ImageIcon className="size-4 text-brand-green-text" aria-hidden="true" />
              {numbered('Visuels d’illustration')}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {report.illustrativeImages.map((image) => (
                <figure key={image.url} className="overflow-hidden rounded-lg border bg-muted/40">
                  <img src={image.url} alt={image.title} referrerPolicy="no-referrer" className="h-44 w-full object-cover" loading="lazy" />
                  <figcaption className="p-3">
                    <span className="block text-sm font-semibold">{image.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{image.caption}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {report.competitors.length > 0 && (
          <section className="space-y-3">
            <h3 className={sectionTitle}>
              <Users className="size-4 text-brand-orange-text" aria-hidden="true" />
              {numbered('Concurrents repérés')}
            </h3>
            <div className="space-y-3">
              {report.competitors.map((competitor) => (
                <div key={competitor.id} className="space-y-1.5 rounded-lg border p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-semibold">{competitor.name}</h4>
                    <span className="text-xs text-muted-foreground">{competitor.priceRange}</span>
                  </div>
                  <p className="text-muted-foreground">{competitor.positioning}</p>
                  {competitor.exploitableGaps[0] && (
                    <p>
                      Angle à exploiter : <span className="font-medium">{competitor.exploitableGaps[0]}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <h3 className={sectionTitle}>
            <BookOpen className="size-4 text-brand-orange-text" aria-hidden="true" />
            {numbered('Idées de produits digitaux')}
          </h3>
          <div className="space-y-3">
            {report.digitalProducts.map((product) => (
              <div key={product.id} className="space-y-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">{product.title}</h4>
                  {product.recommendedPrice !== null && (
                    <span className="rounded-md border bg-muted/50 px-2.5 py-1 text-sm font-semibold tabular-nums">
                      {product.recommendedPrice} {product.currency}
                      {product.estimatedMarginPercent !== null && ` · marge estimée ${product.estimatedMarginPercent} %`}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Promesse : <span className="font-medium text-foreground">{product.transformationPromise}</span>
                </p>
                {product.pricingNote && <p className="text-xs text-muted-foreground">Repères de prix : {product.pricingNote}</p>}
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
            {numbered('Scripts vidéo publicitaires')}
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

        {(sources.length > 0 || limitations.length > 0) && (
          <section className="space-y-3">
            <h3 className={sectionTitle}>
              <Globe className="size-4 text-brand-green-text" aria-hidden="true" />
              {numbered('Provenance, sources et points à vérifier')}
            </h3>
            <div className="space-y-1.5 rounded-lg border bg-muted/40 p-4 text-xs">
              <p className="font-medium">
                {researchLine(report)} {writerLine(report)}
              </p>
              <ul className="space-y-0.5 text-muted-foreground">
                {blockProvenance(report).map((entry) => (
                  <li key={entry.label}>
                    <span className="font-medium text-foreground">{entry.label} :</span> {entry.source}
                  </li>
                ))}
              </ul>
            </div>
            {sources.length > 0 && (
              <ol className="space-y-1.5 text-xs">
                {sources.map((source, index) => {
                  const url = safeHttpUrl(source.url);
                  const number = source.id ?? index + 1;
                  const supports = sourceUsage.get(number) ?? [];
                  return (
                    <li key={`${number}-${source.url}`} className="break-words">
                      <span className="font-semibold tabular-nums">{number}.</span> {source.title}
                      {url && (
                        <>
                          {' — '}
                          <a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline-offset-4 hover:underline">
                            {url}
                          </a>
                        </>
                      )}
                      {supports.length > 0 && (
                        <span className="block text-muted-foreground">Fonde : {supports.join(', ')}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {limitations.length > 0 && (
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        <footer className="space-y-3 border-t pt-6">
          <LegalNotice variant="block" />
          <p className="text-center text-xs text-muted-foreground">Smart Creator — Veille stratégique &amp; production e-commerce</p>
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
