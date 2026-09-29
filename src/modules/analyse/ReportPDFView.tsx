import { useEffect, useState, type ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Clapperboard,
  Download,
  ExternalLink,
  Gift,
  Globe,
  Lightbulb,
  Loader2,
  Printer,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { BrandLogo } from '@/shared/components/BrandLogo';
import { ComplianceBlockDialog } from '@/shared/components/ComplianceBlockDialog';
import { ComplianceBlockedError, checkReportCompliance, exportReportPDF } from '@/shared/lib/complianceGate';
import { useMoney } from '@/shared/lib/money';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { usageBySource } from '@/shared/lib/sourceUsage';
import { cn } from '@/shared/lib/utils';
import type { MarketAnalysisReport, MarketRate } from '@/shared/types/analysis';
import type { ReportComplianceVerdict } from '@/shared/types/compliance';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { RatesVisual } from '@/modules/analyse/RatesVisual';
import { WrittenReportPanel } from '@/modules/analyse/WrittenReportPanel';

/**
 * Dossier PDF : tout ce que l'analyse a établi, en six onglets, puis la rédaction du rapport à la
 * longueur choisie (décision du propriétaire du 29/09/2026 : les rapports se rédigent ici, et plus
 * dans l'analyse stratégique).
 *
 * Présentation voulue « premium » : un en-tête qui résume la niche d'un coup d'œil, des onglets
 * nets, un visuel pour les taux. Rien d'autre que ce qui sert la décision : ni provenance
 * technique, ni liste de précautions.
 */

interface ReportPDFViewProps {
  report: MarketAnalysisReport;
}

type TabId = 'synthese' | 'taux' | 'concurrents' | 'produits' | 'scripts' | 'sources';

const TABS: { id: TabId; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'synthese', label: 'Synthèse', icon: Sparkles },
  { id: 'taux', label: 'Les taux', icon: BarChart3 },
  { id: 'concurrents', label: 'Concurrents', icon: Users },
  { id: 'produits', label: 'Idées de produits', icon: Lightbulb },
  { id: 'scripts', label: 'Script vidéo', icon: Clapperboard },
  { id: 'sources', label: 'Sources', icon: Globe },
];

const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function Empty({ children }: { children: string }) {
  return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function ReportPDFView({ report }: ReportPDFViewProps) {
  const location = useLocation();
  const money = useMoney();
  const [tab, setTab] = useState<TabId>('synthese');
  const [isDownloading, setIsDownloading] = useState(false);
  const [blockedVerdict, setBlockedVerdict] = useState<ReportComplianceVerdict | null>(null);

  const sources = report.groundingSources ?? [];
  const sourceUsage = usageBySource(report);
  const rates: MarketRate[] = [report.rates.demand, report.rates.saturation, report.rates.profitability, report.rates.opportunity, report.rates.virality].filter(Boolean);

  // Arrivée depuis « Rédiger un rapport » de l'analyse : on descend jusqu'à la rédaction.
  useEffect(() => {
    if (location.hash !== '#rediger') return;
    const timer = window.setTimeout(() => document.getElementById('rediger')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    return () => window.clearTimeout(timer);
  }, [location.hash]);

  const handleDownloadPDF = async () => {
    setIsDownloading(true);
    try {
      await exportReportPDF(report, (amount, currency) => money.format(amount, currency, { round: true }));
      toast.success('Fiche PDF téléchargée');
    } catch (error) {
      if (error instanceof ComplianceBlockedError) {
        setBlockedVerdict(error.verdict);
        return;
      }
      toast.error('Le PDF n’a pas pu être généré.');
    } finally {
      setIsDownloading(false);
    }
  };

  /** L'impression produit un document diffusable : elle passe par le même contrôle. */
  const handlePrint = async () => {
    const verdict = await checkReportCompliance(report);
    if (!verdict.exportAllowed) {
      setBlockedVerdict(verdict);
      return;
    }
    window.print();
  };

  const stats = [
    { label: 'sources', value: sources.length },
    { label: 'concurrents', value: report.competitors.length },
    { label: 'idées de produits', value: report.digitalProducts.length },
    { label: 'scripts vidéo', value: report.adCampaigns.length },
  ];

  return (
    <div className="space-y-6">
      {/* En-tête : la niche d'un coup d'œil. */}
      <header className="relative overflow-hidden rounded-3xl bg-foreground p-6 text-background shadow-xl sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-brand-green/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 -left-10 size-64 rounded-full bg-amber-400/15 blur-3xl" />
        <div className="relative space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <BrandLogo size="sm" />
            <span className="inline-flex items-center gap-1.5 opacity-75">
              <CalendarDays className="size-3.5" aria-hidden />
              Dossier du {report.dateCreated}
            </span>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-[0.18em] text-brand-green uppercase">Dossier de la niche</p>
            <h1 className="font-display text-2xl leading-tight font-extrabold tracking-tight sm:text-4xl">{report.nicheName}</h1>
            {report.overallVerdict && (
              <span className="inline-flex items-center gap-2 rounded-full bg-background/10 px-3 py-1 text-sm font-semibold ring-1 ring-background/20">
                <Target className="size-4 text-brand-green" aria-hidden />
                {report.overallVerdict}
              </span>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-2xl bg-background/10 px-4 py-3 ring-1 ring-background/15">
                <dt className="text-xs opacity-70">{stat.label}</dt>
                <dd className="font-display text-2xl font-extrabold tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button onClick={handleDownloadPDF} disabled={isDownloading} className="bg-brand-green text-black hover:bg-brand-green/90">
              {isDownloading ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              Télécharger la fiche
            </Button>
            <Button variant="outline" onClick={() => void handlePrint()} className="border-background/30 bg-transparent text-background hover:bg-background/10 hover:text-background">
              <Printer aria-hidden />
              Imprimer
            </Button>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)} className="gap-5">
        {/* Onglets : défilement horizontal sur téléphone, cibles de 44 px. */}
        <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <TabsList className="h-auto w-max gap-1 rounded-2xl bg-muted p-1.5 sm:w-full">
            {TABS.map(({ id, label, icon: Icon }) => (
              <TabsTrigger key={id} value={id} className="h-11 flex-none gap-2 rounded-xl px-4 text-sm data-[state=active]:shadow-md sm:flex-1">
                <Icon className="size-4" aria-hidden />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="synthese" className="space-y-6">
          <section className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
            <p className="text-lg leading-relaxed text-foreground sm:text-xl">{report.executiveSummary}</p>
            {report.verdictRationale && (
              <p className="mt-4 border-l-4 border-brand-green pl-4 text-sm leading-relaxed text-muted-foreground">{report.verdictRationale}</p>
            )}
          </section>
          {report.strategicActionPlan.length > 0 && (
            <section className="space-y-4">
              <h2 className="font-display text-lg font-bold">Plan d’action</h2>
              <ol className="relative space-y-4 border-l-2 border-brand-green/40 pl-6">
                {report.strategicActionPlan.map((phase, index) => (
                  <li key={`${phase.phase}-${index}`} className="relative">
                    <span className="absolute top-1 -left-[33px] flex size-6 items-center justify-center rounded-full bg-brand-green text-xs font-bold text-black">
                      {index + 1}
                    </span>
                    <div className="rounded-2xl border bg-card p-4 shadow-sm">
                      <p className="text-xs font-semibold tracking-wide text-brand-green-text uppercase">{phase.phase}</p>
                      <p className="mt-1 font-semibold">{phase.title}</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground marker:text-brand-green">
                        {phase.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </TabsContent>

        <TabsContent value="taux">
          <RatesVisual rates={rates} />
        </TabsContent>

        <TabsContent value="concurrents">
          {report.competitors.length === 0 ? (
            <Empty>Aucun concurrent n’apparaît dans les sources de cette analyse.</Empty>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {report.competitors.map((competitor) => {
                const url = safeHttpUrl(competitor.urlOrHandle);
                return (
                  <article key={competitor.id} className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-lg font-bold">{competitor.name}</h3>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            {siteOf(url)}
                            <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">{competitor.urlOrHandle}</span>
                        )}
                      </div>
                      {competitor.priceRange && (
                        <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-semibold tabular-nums">{competitor.priceRange}</span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">{competitor.positioning}</p>
                    <div className="space-y-2 text-sm">
                      {competitor.strengths.length > 0 && <Chips tone="good" label="Forces" items={competitor.strengths} />}
                      {competitor.weaknesses.length > 0 && <Chips tone="bad" label="Faiblesses" items={competitor.weaknesses} />}
                      {competitor.exploitableGaps.length > 0 && <Chips tone="gap" label="Angles à exploiter" items={competitor.exploitableGaps} />}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="produits">
          {report.digitalProducts.length === 0 ? (
            <Empty>Aucune idée de produit pour cette analyse.</Empty>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {report.digitalProducts.map((product) => (
                <article key={product.id} className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Badge variant="secondary" className="mb-2 font-normal">
                        <BookOpen className="size-3" aria-hidden />
                        {product.typeName}
                      </Badge>
                      <h3 className="font-display text-lg leading-snug font-bold">{product.title}</h3>
                      <p className="text-sm text-muted-foreground">{product.subtitle}</p>
                    </div>
                    {product.recommendedPrice !== null && (
                      <span className="shrink-0 rounded-2xl bg-brand-green/15 px-3 py-2 text-right">
                        <span className="block text-[10px] font-semibold tracking-wide text-brand-green-text uppercase">Prix conseillé</span>
                        <span className="font-display text-lg font-extrabold tabular-nums">{money.format(product.recommendedPrice, product.currency, { round: true })}</span>
                      </span>
                    )}
                  </div>
                  <p className="text-sm">
                    <span className="font-semibold">Promesse : </span>
                    {product.transformationPromise}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">Pour : </span>
                    {product.targetAudience}
                  </p>
                  {product.tableOfContents.length > 0 && (
                    <ol className="space-y-1 rounded-xl bg-muted/40 p-3 text-sm">
                      {product.tableOfContents.slice(0, 6).map((module) => (
                        <li key={module.moduleNumber} className="flex gap-2">
                          <span className="font-semibold text-brand-green-text tabular-nums">{module.moduleNumber}.</span>
                          <span>{module.title}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {product.leadMagnet.title && (
                    <p className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Gift className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
                      <span>
                        <span className="font-semibold text-foreground">Aimant à prospects : </span>
                        {product.leadMagnet.title}
                      </span>
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="scripts" className="space-y-5">
          {report.adCampaigns.length === 0 ? (
            <Empty>Aucun script vidéo pour cette analyse.</Empty>
          ) : (
            report.adCampaigns.map((ad) => (
              <article key={ad.id} className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{ad.framework}</Badge>
                  <Badge variant="outline">{ad.aspectRatio}</Badge>
                  <Badge variant="outline">{ad.durationSeconds} s</Badge>
                  <span className="text-sm font-semibold">{ad.targetProductTitle}</span>
                </div>
                <p className="rounded-xl bg-foreground px-4 py-3 font-display text-lg font-bold text-background">« {ad.hookHeadline} »</p>
                <ol className="space-y-3">
                  {ad.scenes.map((scene) => (
                    <li key={scene.sceneNumber} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                      <div>
                        <span className="block font-mono text-sm font-semibold tabular-nums">{scene.timing}</span>
                        <span className="text-xs text-muted-foreground">{scene.phase}</span>
                      </div>
                      <div className="space-y-1.5 text-sm">
                        <p>
                          <span className="font-semibold">Image : </span>
                          {scene.visualDescription}
                        </p>
                        {scene.onScreenText && (
                          <p>
                            <span className="font-semibold">À l’écran : </span>« {scene.onScreenText} »
                          </p>
                        )}
                        {scene.spokenVoiceover && (
                          <p className="text-muted-foreground">
                            <span className="font-semibold text-foreground">Voix : </span>« {scene.spokenVoiceover} »
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="grid gap-2 rounded-xl bg-muted/40 p-4 text-sm sm:grid-cols-3">
                  <p className="sm:col-span-3">
                    <span className="font-semibold">Texte de la publicité : </span>
                    {ad.metaPrimaryText}
                  </p>
                  <p>
                    <span className="font-semibold">Titre : </span>
                    {ad.metaHeadline}
                  </p>
                  <p>
                    <span className="font-semibold">Bouton : </span>
                    {ad.callToAction}
                  </p>
                </div>
              </article>
            ))
          )}
        </TabsContent>

        <TabsContent value="sources">
          {sources.length === 0 ? (
            <Empty>Cette analyse ne cite aucune source.</Empty>
          ) : (
            <ol className="space-y-3">
              {sources.map((source, index) => {
                const url = safeHttpUrl(source.url);
                const number = source.id ?? index + 1;
                const supports = sourceUsage.get(number) ?? [];
                return (
                  <li key={`${number}-${source.url}`} className="flex gap-4 rounded-2xl border bg-card p-4 shadow-sm">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-green/15 font-display font-bold text-brand-green-text tabular-nums">
                      {number}
                    </span>
                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold break-words">{source.title}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{siteOf(source.url)}</span>
                        {source.publishedAt && <span>publié le {source.publishedAt}</span>}
                        {url && (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            Ouvrir
                            <ExternalLink className="size-3" aria-hidden />
                          </a>
                        )}
                      </div>
                      {supports.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {supports.map((label) => (
                            <Badge key={label} variant="secondary" className="font-normal">
                              {label}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </TabsContent>
      </Tabs>

      {/* Après les six onglets : la rédaction du rapport, à la taille choisie. */}
      <div className="print:hidden">
        <WrittenReportPanel reportId={report.id} nicheName={report.nicheName} />
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
}

function Chips({ tone, label, items }: { tone: 'good' | 'bad' | 'gap'; label: string; items: string[] }) {
  const style = {
    good: 'bg-success-soft text-success ring-success-border',
    bad: 'bg-danger-soft text-danger ring-danger-border',
    gap: 'bg-warning-soft text-warning ring-warning-border',
  }[tone];
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className={cn('rounded-full px-2.5 py-1 text-xs ring-1', style)}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
