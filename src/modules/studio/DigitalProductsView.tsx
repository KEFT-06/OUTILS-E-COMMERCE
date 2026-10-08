import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BookOpen,
  Clapperboard,
  ClipboardPaste,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Gift,
  Layers,
  Package,
  Percent,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
  Video,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { pathOf } from '@/app/navigation';
import { analysisStepLabel, useWorkspace } from '@/app/providers/WorkspaceProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { MarketReviewCard, subjectOf } from '@/modules/studio/MarketReviewCard';
import { ProductStudioPanel } from '@/modules/studio/ProductStudioPanel';
import { TextToProductDialog } from '@/modules/studio/TextToProductDialog';
import { VideoToProductDialog } from '@/modules/studio/VideoToProductDialog';
import { BookCover } from '@/shared/components/BookCover';
import { PageHeader } from '@/shared/components/PageHeader';
import { useProductCovers } from '@/shared/stores/useProductCovers';
import { WritingFindings } from '@/shared/components/WritingFindings';
import { usePricing } from '@/modules/studio/usePricing';
import { roundPrice } from '@server/shared/currency';
import { useMoney } from '@/shared/lib/money';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { blankProduct, useCustomProducts } from '@/shared/stores/useCustomProducts';
import { useProductDrafts } from '@/shared/stores/useProductDrafts';
import { useProviders } from '@/shared/hooks/useProviders';
import { cn } from '@/shared/lib/utils';
import type { TextProductResult, VideoProductResult, WritingFinding } from '@/shared/lib/writing';
import type { DigitalProductIdea, MarketAnalysisReport, MissingChapter } from '@/shared/types/analysis';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/shared/ui/accordion';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/shared/ui/chart';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/shared/ui/empty';
import { Skeleton } from '@/shared/ui/skeleton';

interface DigitalProductsViewProps {
  /** Rapport de la niche active : ses produits, sa provenance et ses sources. null : aucun rapport. */
  report: MarketAnalysisReport | null;
  onSelectProductForAd: (product: DigitalProductIdea) => void;
  onAnalyzeNiche: () => void;
}

const FORMAT_ICONS = {
  ebook: BookOpen,
  template: FileSpreadsheet,
  masterclass: Video,
} as const;

const PROJECTION_UNITS = [10, 25, 50, 75, 100, 150, 200];

const projectionConfig = { profit: { label: 'Bénéfice estimé', color: 'var(--chart-1)' } } satisfies ChartConfig;
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

function originLabel(product: DigitalProductIdea): string | null {
  if (product.origin?.kind === 'video') return 'Tiré d’une vidéo';
  if (product.origin?.kind === 'manual') return 'Créé à la main';
  return null;
}

export function DigitalProductsView({ report, onSelectProductForAd, onAnalyzeNiche }: DigitalProductsViewProps) {
  const { pricing, isLoading: isPricingLoading, error: pricingError } = usePricing();
  const money = useMoney();
  const drafts = useProductDrafts();
  const custom = useCustomProducts();
  const providers = useProviders();
  const covers = useProductCovers();
  const navigate = useNavigate();
  const { account } = useAuth();
  const { analysisJob, analyzeNiche, reports, selectReport } = useWorkspace();

  const products = useMemo(() => [...(report?.digitalProducts ?? []), ...custom.products], [report, custom.products]);
  // Produit créé depuis une alerte (« Créer un produit similaire ») : il s'ouvre directement.
  const demande = (useLocation().state as { produit?: unknown } | null)?.produit;
  const [selectedId, setSelectedId] = useState<string | null>(typeof demande === 'string' ? demande : null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const baseProduct = products.find((candidate) => candidate.id === selectedId) ?? products[0];
  const selectedProduct = baseProduct ? drafts.effective(baseProduct) : undefined;
  const isCustom = baseProduct ? custom.products.some((candidate) => candidate.id === baseProduct.id) : false;

  const [salesGoal, setSalesGoal] = useState(50);
  // `null` tant que les bornes ne sont pas connues : aucun prix de départ inventé.
  // Prix du produit converti dans la devise de l'utilisateur, celle des bornes du simulateur.
  const priceInUserCurrency = (product: DigitalProductIdea | undefined) =>
    product?.recommendedPrice !== null && product?.recommendedPrice !== undefined
      ? (() => {
          const value = money.convert(product.recommendedPrice, product.currency);
          return value === null ? null : roundPrice(value, money.currency);
        })()
      : null;
  const [customPrice, setCustomPrice] = useState<number | null>(() => priceInUserCurrency(products[0]));
  const [adCost, setAdCost] = useState<number | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [findings, setFindings] = useState<WritingFinding[]>([]);

  useEffect(() => {
    if (!pricing) return;
    setCustomPrice((previous) => previous ?? pricing.sellingPrice.default);
    setAdCost((previous) => previous ?? pricing.adCostPerAcquisition.default);
  }, [pricing]);

  /*
    L'étude menée pour un ouvrage se range AVEC lui dès que son rapport est ouvert : repères de
    prix, problème visé, angle, et ce qu'elle dit de lui. Elle y reste quand une autre niche
    devient le rapport courant. Le brouillon, s'il existe, masque l'original : il est complété aussi.
  */
  const authorWork = report?.authorWork;
  useEffect(() => {
    if (!report || !authorWork || custom.status !== 'ready') return;
    const base = custom.products.find((candidate) => candidate.id === authorWork.productId);
    if (!base || base.marketReview?.reportId === report.id) return;
    const complete = (product: DigitalProductIdea): DigitalProductIdea => ({
      ...product,
      pricingNote: authorWork.pricingNote || product.pricingNote,
      ...(authorWork.targetProblem ? { targetProblem: authorWork.targetProblem } : {}),
      ...(authorWork.angle ? { angle: authorWork.angle } : {}),
      marketReview: {
        reportId: report.id,
        nicheName: report.nicheName,
        verdict: report.overallVerdict,
        positioning: authorWork.positioning,
        strengths: authorWork.strengths,
        missingChapters: authorWork.missingChapters,
      },
    });
    custom.update(complete(base));
    if (drafts.hasDraft(base.id)) drafts.saveDraft(complete(drafts.effective(base)));
  }, [report, authorWork, custom, drafts]);

  const selectProduct = (product: DigitalProductIdea) => {
    setSelectedId(product.id);
    // Sans prix avancé, le curseur repart de la valeur par défaut de la table des prix.
    setCustomPrice(priceInUserCurrency(product) ?? pricing?.sellingPrice.default ?? null);
  };

  const createBlank = () => {
    const product = blankProduct(money.currency);
    custom.add(product);
    setSelectedId(product.id);
    setJustCreatedId(product.id);
    toast.success('Produit créé', { description: 'Complétez-le dans le mode Expert, ou faites rédiger ses modules automatiquement.' });
  };

  const onTextProduct = (result: TextProductResult, studied: boolean) => {
    custom.add(result.product);
    setSelectedId(result.product.id);
    setFindings(result.findings);
    const { chapters, words } = result.recognized;
    const reconnu = `${chapters} chapitre${chapters > 1 ? 's' : ''} reconnu${chapters > 1 ? 's' : ''}, ${words.toLocaleString('fr-FR')} mots, sans réécriture.`;
    toast.success('Votre ouvrage est créé', {
      description: studied
        ? `${reconnu} L’étude de son marché — « ${result.niche} » — est lancée : son résultat viendra se ranger dans sa fiche.`
        : `${reconnu} Relisez-le, puis validez.`,
      duration: studied ? 10_000 : 6_000,
    });
  };

  const onVideoProduct = (result: VideoProductResult) => {
    custom.add(result.product);
    setSelectedId(result.product.id);
    setFindings(result.findings);
    toast.success('Produit tiré de la vidéo', { description: 'Relisez sa structure et ses modules avant de l’exporter.' });
  };

  const removeSelected = () => {
    if (!baseProduct) return;
    custom.remove(baseProduct.id);
    if (drafts.hasDraft(baseProduct.id)) drafts.discardDraft(baseProduct.id);
    setSelectedId(null);
    setDeleteOpen(false);
    toast.success('Produit supprimé');
  };

  const videoReason = providers && !providers.text ? 'La rédaction automatique est momentanément indisponible.' : undefined;

  const createActions = (
    <>
      {/* Le geste le plus court pour qui a déjà écrit : coller, relire, valider. */}
      <Button variant="outline" onClick={() => setTextOpen(true)} disabled={!custom.canAdd || !providers?.text} title={videoReason}>
        <ClipboardPaste />
        Coller mon texte
      </Button>
      <Button variant="outline" onClick={createBlank} disabled={!custom.canAdd}>
        <Plus />
        Nouveau produit
      </Button>
      <Button variant="outline" onClick={() => setVideoOpen(true)} disabled={!custom.canAdd || !providers?.text} title={videoReason}>
        <Video />
        Depuis une vidéo
      </Button>
    </>
  );

  const videoDialog = (
    <>
      <VideoToProductDialog open={videoOpen} onOpenChange={setVideoOpen} onCreated={onVideoProduct} />
      <TextToProductDialog open={textOpen} onOpenChange={setTextOpen} onCreated={onTextProduct} />
    </>
  );

  if (!baseProduct || !selectedProduct) {
    if (custom.status === 'loading') {
      return (
        <div className="space-y-6" role="status" aria-label="Chargement des produits">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      );
    }
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Créer"
          title="Studio de création"
          description="Structurez un produit digital, faites rédiger son contenu et simulez sa rentabilité."
        />
        <Empty className="border border-dashed py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Package />
            </EmptyMedia>
            <EmptyTitle>Aucun produit pour l’instant</EmptyTitle>
            <EmptyDescription>
              Collez un texte que vous avez déjà écrit, partez de l’analyse d’une niche, créez votre produit à la main, ou transformez l’une de vos vidéos en produit.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center gap-2">
            <Button onClick={onAnalyzeNiche}>
              <Sparkles />
              Analyser une niche
            </Button>
            {createActions}
          </EmptyContent>
        </Empty>
        {videoDialog}
      </div>
    );
  }

  // Calculs à zéro tant que les bornes ne sont pas chargées, plutôt que sur des valeurs supposées.
  const priceValue = customPrice ?? 0;
  const adCostValue = adCost ?? 0;
  const currency = pricing?.currencySymbol ?? '';

  const grossRevenue = salesGoal * priceValue;
  const totalAdSpend = salesGoal * adCostValue;
  const estimatedProfit = Math.max(0, grossRevenue - totalAdSpend);
  const profitMarginPercent = grossRevenue > 0 ? Math.round((estimatedProfit / grossRevenue) * 100) : 0;

  const projectionData = PROJECTION_UNITS.map((units) => ({
    units,
    profit: Math.max(0, units * priceValue - units * adCostValue),
  }));

  const origin = selectedProduct.origin;
  const originUrl = origin?.kind === 'video' ? safeHttpUrl(origin.url) : null;

  // Étude de marché de l'ouvrage : rendue, en cours, ou à lancer d'un geste.
  const review = selectedProduct.marketReview;
  const studyStep = analysisJob?.subject?.productId === baseProduct.id ? analysisStepLabel(analysisJob.status) : null;
  const canStudy =
    isCustom && !analysisJob && Boolean(account?.features.niche_analysis) && Boolean(providers?.webSearch) && selectedProduct.title.trim().length >= 4 && selectedProduct.title !== 'Nouveau produit';
  const addChapter = (chapter: MissingChapter) => {
    const { marketReview, ...rest } = selectedProduct;
    drafts.saveDraft({
      ...rest,
      tableOfContents: [...rest.tableOfContents, { moduleNumber: rest.tableOfContents.length + 1, title: chapter.title, details: '' }],
      ...(marketReview ? { marketReview: { ...marketReview, missingChapters: marketReview.missingChapters.filter((candidate) => candidate.title !== chapter.title) } } : {}),
    });
    toast.success('Chapitre ajouté à votre ouvrage', { description: 'Il attend son contenu : faites-le rédiger, ou écrivez-le dans le mode Expert.' });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Créer"
        title="Studio de création"
        description="Choisissez un produit, structurez-le, faites rédiger son contenu et simulez sa rentabilité."
        actions={
          <div className="flex flex-wrap gap-2">
            {createActions}
            <Button onClick={() => onSelectProductForAd(selectedProduct)}>
              <Clapperboard />
              Préparer les créatifs
            </Button>
          </div>
        }
      />

      <WritingFindings findings={findings} />

      {custom.writeFailed && (
        <Alert variant="warning">
          <AlertDescription>
            Connexion interrompue : vos produits restent à l’écran et s’enregistreront d’eux-mêmes dès son retour.
          </AlertDescription>
        </Alert>
      )}

      <div role="radiogroup" aria-label="Produits" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {products.map((candidate) => {
          const product = drafts.effective(candidate);
          const isSelected = baseProduct.id === candidate.id;
          const Icon = FORMAT_ICONS[product.type as keyof typeof FORMAT_ICONS] ?? Package;
          const badge = originLabel(candidate);
          return (
            <button
              key={candidate.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => selectProduct(candidate)}
              className={cn(
                'flex gap-4 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary/50',
                isSelected && 'border-primary ring-2 ring-primary/25',
              )}
            >
              {/* La couverture de l'ouvrage, titre dessus : avec son illustration s'il en a une, typographique sinon. */}
              <BookCover
                title={product.title}
                subtitle={product.subtitle}
                label={product.typeName}
                imageUrl={covers[candidate.id]}
                seed={candidate.id}
                className="w-24 shrink-0 self-start sm:w-28"
              />
              <span className="flex min-w-0 flex-1 flex-col justify-between gap-4">
              <span className="space-y-2">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="secondary">
                    <Icon />
                    {product.typeName}
                  </Badge>
                  <span className="text-sm font-semibold tabular-nums">
                    {product.recommendedPrice !== null ? money.format(product.recommendedPrice, product.currency, { round: true }) : 'Prix à fixer'}
                  </span>
                </span>
                <span className="line-clamp-2 block font-semibold leading-snug">{product.title}</span>
                <span className="line-clamp-2 block text-sm text-muted-foreground">{product.subtitle}</span>
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                {product.estimatedMarginPercent !== null ? (
                  <span className="inline-flex items-center gap-1">
                    <Percent className="size-3.5" aria-hidden="true" />
                    Marge estimée {product.estimatedMarginPercent} %
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Layers className="size-3.5" aria-hidden="true" />
                    {product.tableOfContents.length} modules
                  </span>
                )}
                {product.estimatedProductionDays !== null && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" aria-hidden="true" />~{product.estimatedProductionDays} jours
                  </span>
                )}
                {badge && <span className="font-medium text-foreground/80">{badge}</span>}
              </span>
              </span>
            </button>
          );
        })}
      </div>

      <ProductStudioPanel
        key={baseProduct.id}
        baseProduct={baseProduct}
        report={isCustom ? null : report}
        initialExpertOpen={justCreatedId === baseProduct.id}
      />

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="brand">{selectedProduct.typeName}</Badge>
              {selectedProduct.estimatedMarginPercent !== null && (
                <Badge variant="outline">Marge estimée {selectedProduct.estimatedMarginPercent} %</Badge>
              )}
              {originLabel(selectedProduct) && <Badge variant="outline">{originLabel(selectedProduct)}</Badge>}
            </div>
            <CardTitle>
              <h2 className="font-display text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">{selectedProduct.title}</h2>
            </CardTitle>
            <CardDescription>{selectedProduct.subtitle}</CardDescription>
            {origin?.kind === 'video' && (
              <p className="text-xs text-muted-foreground">
                Source :{' '}
                {originUrl ? (
                  <a href={originUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                    {origin.label}
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                ) : (
                  origin.label
                )}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/40 p-4">
                <p className="mb-1 text-sm font-semibold">Public cible</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{selectedProduct.targetAudience || 'À préciser.'}</p>
              </div>
              <div className="rounded-lg border border-primary/30 bg-accent/50 p-4">
                <p className="mb-1 text-sm font-semibold text-accent-foreground">Promesse de transformation</p>
                <p className="text-sm leading-relaxed">{selectedProduct.transformationPromise || 'À préciser.'}</p>
              </div>
            </div>

            {selectedProduct.pricingNote && (
              <div className="rounded-lg border p-4">
                <p className="mb-1 text-sm font-semibold">Repères de prix</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{selectedProduct.pricingNote}</p>
              </div>
            )}

            {(review || studyStep || canStudy) && (
              <MarketReviewCard
                {...(review ? { review } : {})}
                pendingStep={studyStep}
                onAddChapter={addChapter}
                {...(review && reports.some((entry) => entry.id === review.reportId)
                  ? {
                      onOpenReport: () => {
                        selectReport(review.reportId);
                        navigate(pathOf('analyse'));
                      },
                    }
                  : {})}
                {...(canStudy
                  ? { onStudy: () => void analyzeNiche(selectedProduct.title.replace(/\s+/g, ' ').trim().slice(0, 200), account?.country ?? null, subjectOf(selectedProduct)) }
                  : {})}
              />
            )}

            <div className="space-y-2">
              <h3 className="flex items-center gap-2 font-semibold">
                <Layers className="size-4 text-brand-green-text" aria-hidden="true" />
                Modules à produire ({selectedProduct.tableOfContents.length})
              </h3>
              <Accordion type="single" collapsible className="rounded-lg border px-4">
                {selectedProduct.tableOfContents.map((module, index) => (
                  <AccordionItem key={`${module.moduleNumber}-${index}`} value={String(index)}>
                    <AccordionTrigger>
                      <span className="flex items-center gap-3">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-accent-foreground tabular-nums">
                          {module.moduleNumber}
                        </span>
                        {module.title}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pl-9 whitespace-pre-line text-muted-foreground">
                      {module.details || 'Contenu à rédiger.'}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>

            {(selectedProduct.leadMagnet.title || selectedProduct.leadMagnet.hook) && (
              <div className="space-y-2 rounded-lg border border-brand-orange/40 bg-brand-orange/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-orange-text">
                    <Gift className="size-4" aria-hidden="true" />
                    Aimant à prospects gratuit
                  </p>
                  {selectedProduct.leadMagnet.format && <Badge variant="outline">{selectedProduct.leadMagnet.format}</Badge>}
                </div>
                <p className="font-semibold">« {selectedProduct.leadMagnet.title} »</p>
                <p className="text-sm leading-relaxed text-foreground/85">{selectedProduct.leadMagnet.hook}</p>
              </div>
            )}

            {isCustom && (
              <div className="flex justify-end border-t pt-4">
                <Button variant="ghost" className="text-muted-foreground" onClick={() => setDeleteOpen(true)}>
                  <Trash2 />
                  Supprimer ce produit
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:sticky lg:top-20 lg:col-span-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4 text-brand-green-text" aria-hidden="true" />
              Simulateur de rentabilité
            </CardTitle>
            <CardDescription>Ajustez le prix, l’objectif de ventes et le coût d’acquisition publicitaire.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="sim-sales" className="text-sm font-medium">
                    Objectif de ventes
                  </label>
                  <span className="text-sm font-semibold tabular-nums">{salesGoal} ventes</span>
                </div>
                <input
                  id="sim-sales"
                  type="range"
                  min={5}
                  max={200}
                  step={5}
                  value={salesGoal}
                  onChange={(event) => setSalesGoal(Number(event.target.value))}
                  className="w-full cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>5</span>
                  <span>100</span>
                  <span>200</span>
                </div>
              </div>

              {/*
                Les bornes des curseurs de prix viennent de la table servie par l'API
                (server/config/pricing.json) : une seule source, que l'écran ne peut pas
                contredire. La corriger demande un redéploiement du serveur, qui la garde en mémoire.
              */}
              {!pricing ? (
                isPricingLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-3 text-sm">
                    <p className="font-medium">Fourchettes de prix indisponibles</p>
                    {pricingError && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {pricingError}
                      </p>
                    )}
                  </div>
                )
              ) : (
                <>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="sim-price" className="text-sm font-medium">
                        Prix de vente
                      </label>
                      <span className="text-sm font-semibold tabular-nums">
                        {priceValue} {currency}
                      </span>
                    </div>
                    <input
                      id="sim-price"
                      type="range"
                      min={pricing.sellingPrice.min}
                      max={pricing.sellingPrice.max}
                      step={pricing.sellingPrice.step}
                      value={priceValue}
                      onChange={(event) => setCustomPrice(Number(event.target.value))}
                      className="w-full cursor-pointer accent-primary"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      {pricing.sellingPrice.marks.map((mark) => (
                        <span key={mark.value}>{mark.label}</span>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="sim-cpa" className="text-sm font-medium">
                        Coût d’acquisition par vente
                      </label>
                      <span className="text-sm font-semibold text-danger tabular-nums">
                        {adCostValue} {currency}
                      </span>
                    </div>
                    <input
                      id="sim-cpa"
                      type="range"
                      min={pricing.adCostPerAcquisition.min}
                      max={pricing.adCostPerAcquisition.max}
                      step={pricing.adCostPerAcquisition.step}
                      value={adCostValue}
                      onChange={(event) => setAdCost(Number(event.target.value))}
                      className="w-full cursor-pointer accent-primary"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      {pricing.adCostPerAcquisition.marks.map((mark) => (
                        <span key={mark.value}>{mark.label}</span>
                      ))}
                    </div>
                  </div>

                </>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Chiffre d’affaires</dt>
                <dd className="mt-1 font-display text-xl font-extrabold tabular-nums">
                  {grossRevenue.toLocaleString('fr-FR')} {currency}
                </dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Budget publicitaire</dt>
                <dd className="mt-1 font-display text-xl font-extrabold text-danger tabular-nums">
                  {totalAdSpend.toLocaleString('fr-FR')} {currency}
                </dd>
              </div>
            </dl>

            <div className="space-y-1 rounded-xl bg-accent p-5 text-accent-foreground">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Bénéfice estimé</span>
                <Badge variant="outline" className="border-accent-foreground/30 text-accent-foreground tabular-nums">
                  {profitMarginPercent} % du CA
                </Badge>
              </div>
              <p className="font-display text-3xl font-extrabold tabular-nums sm:text-4xl">
                {estimatedProfit.toLocaleString('fr-FR')} {currency}
              </p>
              <p className="text-xs leading-relaxed text-foreground/80">
                Avant frais de plateforme et taxes.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Bénéfice selon le nombre de ventes</p>
              <ChartContainer config={projectionConfig} className="h-44 w-full">
                <AreaChart data={projectionData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="studio-profit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-profit)" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="var(--color-profit)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="units" tickLine={false} axisLine={false} tickFormatter={(value: number) => `${value}`} />
                  <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(value: number) => compact.format(value)} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(_label, payload) => `${payload[0]?.payload.units ?? ''} ventes`} />} />
                  <Area type="monotone" dataKey="profit" stroke="var(--color-profit)" strokeWidth={2} fill="url(#studio-profit)" />
                </AreaChart>
              </ChartContainer>
              <p className="text-xs text-muted-foreground">Axe horizontal : nombre de ventes.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {videoDialog}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer ce produit ?</DialogTitle>
            <DialogDescription>
              « {selectedProduct.title} » et ses retouches seront effacés de votre compte. Les kits et pages produits qui en
              partent ne s’afficheront plus.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <DialogClose asChild>
              <Button variant="outline">Annuler</Button>
            </DialogClose>
            <Button variant="destructive" onClick={removeSelected}>
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
