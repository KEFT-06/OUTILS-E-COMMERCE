import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  BookOpen,
  Clapperboard,
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
import { useAuth } from '@/features/auth/AuthContext';
import { ProductStudioPanel } from '@/modules/studio/ProductStudioPanel';
import { VideoToProductDialog } from '@/modules/studio/VideoToProductDialog';
import { PageHeader } from '@/shared/components/PageHeader';
import { WritingFindings } from '@/shared/components/WritingFindings';
import { usePricing } from '@/modules/studio/usePricing';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { blankProduct, useCustomProducts } from '@/shared/stores/useCustomProducts';
import { useProductDrafts } from '@/shared/stores/useProductDrafts';
import { useProviders } from '@/shared/hooks/useProviders';
import { cn } from '@/shared/lib/utils';
import type { VideoProductResult, WritingFinding } from '@/shared/lib/writing';
import type { DigitalProductIdea, MarketAnalysisReport } from '@/shared/types/analysis';
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
  const drafts = useProductDrafts();
  const custom = useCustomProducts();
  const providers = useProviders();
  const { account } = useAuth();

  const products = useMemo(() => [...(report?.digitalProducts ?? []), ...custom.products], [report, custom.products]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const baseProduct = products.find((candidate) => candidate.id === selectedId) ?? products[0];
  const selectedProduct = baseProduct ? drafts.effective(baseProduct) : undefined;
  const isCustom = baseProduct ? custom.products.some((candidate) => candidate.id === baseProduct.id) : false;

  const [salesGoal, setSalesGoal] = useState(50);
  // `null` tant que les bornes ne sont pas connues : aucun prix de départ inventé.
  const [customPrice, setCustomPrice] = useState<number | null>(products[0]?.recommendedPrice ?? null);
  const [adCost, setAdCost] = useState<number | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [findings, setFindings] = useState<WritingFinding[]>([]);

  useEffect(() => {
    if (!pricing) return;
    setCustomPrice((previous) => previous ?? pricing.sellingPrice.default);
    setAdCost((previous) => previous ?? pricing.adCostPerAcquisition.default);
  }, [pricing]);

  const selectProduct = (product: DigitalProductIdea) => {
    setSelectedId(product.id);
    // Sans prix avancé, le curseur repart de la valeur par défaut de la table des prix.
    setCustomPrice(product.recommendedPrice ?? pricing?.sellingPrice.default ?? null);
  };

  const createBlank = () => {
    const product = blankProduct(account?.currency ?? 'USD');
    custom.add(product);
    setSelectedId(product.id);
    setJustCreatedId(product.id);
    toast.success('Produit créé', { description: 'Complétez-le dans le mode Expert, ou faites rédiger ses modules par l’IA.' });
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

  const videoReason = providers && !providers.text ? 'La rédaction par IA n’est pas configurée sur le serveur.' : undefined;

  const createActions = (
    <>
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

  const videoDialog = <VideoToProductDialog open={videoOpen} onOpenChange={setVideoOpen} onCreated={onVideoProduct} />;

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
              Partez de l’analyse d’une niche, créez votre produit à la main, ou transformez l’une de vos vidéos en produit.
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
            Vos produits n’ont pas pu être enregistrés sur votre compte (connexion interrompue ?). Réessayez dans un instant.
          </AlertDescription>
        </Alert>
      )}

      <div role="radiogroup" aria-label="Produits" className="grid gap-4 md:grid-cols-3">
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
                'flex flex-col justify-between gap-4 rounded-xl border bg-card p-5 text-left shadow-xs transition-colors hover:border-primary/50',
                isSelected && 'border-primary ring-2 ring-primary/25',
              )}
            >
              <span className="space-y-2">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="secondary">
                    <Icon />
                    {product.typeName}
                  </Badge>
                  <span className="text-sm font-semibold tabular-nums">
                    {product.recommendedPrice !== null ? `${product.recommendedPrice} ${product.currency}` : 'Prix à fixer'}
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
                Les bornes des curseurs de prix viennent de la table servie par l'API :
                corriger un prix de marché ne demande pas de redéploiement.
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
                        {pricingError} Le simulateur reste inactif : une échelle de prix inventée serait pire que rien.
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

                  {pricing.valuesStatus && <p className="text-xs leading-relaxed text-warning">{pricing.valuesStatus}</p>}
                  <p className="text-xs text-muted-foreground">
                    Fourchettes v{pricing.version} · mises à jour le {pricing.updatedAt}
                  </p>
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
                Ventes × (prix − coût d’acquisition). Les frais de marketplace, les taxes et les remboursements ne sont pas
                déduits.
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
