import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Bot,
  Briefcase,
  Clapperboard,
  ExternalLink,
  FileText,
  Flame,
  Globe,
  Info,
  Leaf,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Video,
  Zap,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from 'recharts';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { PageHeader } from '@/shared/components/PageHeader';
import { cn } from '@/shared/lib/utils';
import type { RadarScanResult } from '@/shared/types/analysis';
import type { DataProvenance } from '@/shared/types/provenance';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/shared/ui/chart';
import { ChartProvenance } from '@/shared/ui/ChartProvenance';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';

interface RadarTrendsViewProps {
  initialScanData?: RadarScanResult | null;
  onSelectNicheForFullAnalysis: (nicheName: string) => Promise<void>;
  onNavigateToMetaAds: (productTitle: string) => void;
  isAnalyzingNiche: boolean;
  /** Ouvre le catalogue des niches, le temps que le scan en direct soit disponible. */
  onBrowseNiches?: () => void;
}

const CATEGORY_FILTERS = [
  { id: 'all', label: 'Toutes', icon: Globe },
  { id: 'ia', label: 'IA et automatisation', icon: Bot },
  { id: 'productivity', label: 'Productivité', icon: Zap },
  { id: 'creators', label: 'Créateurs et vidéo', icon: Clapperboard },
  { id: 'health', label: 'Santé et bien-être', icon: Leaf },
  { id: 'finance', label: 'Finance', icon: TrendingUp },
  { id: 'business', label: 'Business et freelance', icon: Briefcase },
] as const;

const VELOCITY_LABELS: Record<string, string> = {
  breakout: 'en rupture',
  explosive: 'forte',
  steady: 'régulière',
};

const SATURATION_TONE: Record<string, string> = {
  Faible: 'text-rate-excellent-text',
  Moyenne: 'text-rate-medium-text',
  Forte: 'text-rate-low-text',
};

const scatterConfig = { niches: { label: 'Niches', color: 'var(--chart-1)' } } satisfies ChartConfig;
const rankingConfig = { score: { label: 'Score', color: 'var(--chart-1)' } } satisfies ChartConfig;

export function RadarTrendsView({
  initialScanData,
  onSelectNicheForFullAnalysis,
  onNavigateToMetaAds,
  isAnalyzingNiche,
  onBrowseNiches,
}: RadarTrendsViewProps) {
  const { runWithCredits } = useCreditGate();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [scanResult, setScanResult] = useState<RadarScanResult | null>(initialScanData ?? null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  /** Provenance dérivée du scan lui-même : plateformes interrogées et horodatage. */
  const scanProvenance: DataProvenance | undefined = scanResult
    ? {
        source: scanResult.platformsScanned.join(', ') || 'Sources non précisées',
        collectedAt: scanResult.timestamp,
        sampleSize: scanResult.totalNichesFound,
        sampleUnit: 'niches détectées',
        isDemonstration: false,
      }
    : undefined;

  /** Classement calculé une fois et réutilisé pour les données et les couleurs. */
  const topNiches = useMemo(
    () =>
      (scanResult?.niches ?? [])
        .map((niche) => ({
          name: niche.nicheName.length > 24 ? `${niche.nicheName.slice(0, 23)}…` : niche.nicheName,
          score: niche.explosionScore,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5),
    [scanResult],
  );

  const scatterData = useMemo(
    () =>
      (scanResult?.niches ?? []).map((niche) => ({
        name: niche.nicheName,
        score: niche.explosionScore,
        volume: (parseInt(niche.searchVolumeEstimated.replace(/[^0-9]/g, ''), 10) || 0) / 1000,
      })),
    [scanResult],
  );

  /**
   * Le scan consomme des points : il passe par le simulateur, qui annonce le
   * coût avant tout appel. L'ancienne version simulait des étapes de scan avec un
   * minuteur ; seul l'état réel (en cours, terminé, en erreur) est montré.
   */
  const handleLaunchScan = async (categoryFilter?: string) => {
    await runWithCredits('radar_scan', async () => {
      setIsScanning(true);
      setScanError(null);
      let errorShown = false;

      try {
        const category = categoryFilter ?? selectedCategory;
        const response = await fetch('/api/radar-trends', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: category !== 'all' ? category : undefined,
            customQuery: searchQuery,
          }),
        });

        if (response.ok) {
          setScanResult((await response.json()) as RadarScanResult);
          return;
        }

        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        const message =
          payload?.error?.message ?? 'Le scan de marché est momentanément indisponible. Réessayez dans quelques instants.';
        setScanError(message);
        errorShown = true;
        // Lever empêche la porte de crédits de débiter un scan qui n'a rien rendu.
        throw new Error(message);
      } catch (error) {
        if (!errorShown) setScanError('Impossible de joindre le serveur. Vérifiez votre connexion.');
        throw error;
      } finally {
        setIsScanning(false);
      }
    }).catch(() => {
      // L'erreur est déjà affichée dans le bandeau du scan.
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voir"
        title="Radar marché"
        description="Repérez les niches de produits digitaux dont la demande accélère, avec les signaux qui le montrent."
      />

      {!scanResult && (
        <Alert variant="info">
          <Info />
          <AlertTitle>Scan en direct pas encore disponible</AlertTitle>
          <AlertDescription>
            <p>
              Le radar interrogera la bibliothèque publicitaire Meta et un fournisseur d’IA. Tant qu’ils ne sont pas
              branchés, un scan renvoie un message d’indisponibilité et ne débite aucun point.
            </p>
            {onBrowseNiches && (
              <Button variant="link" className="h-auto p-0 text-info" onClick={onBrowseNiches}>
                Parcourir le catalogue des niches
                <ArrowRight />
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card className="py-5">
        <CardContent className="space-y-4">
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void handleLaunchScan();
            }}
          >
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Niche ou mot-clé, ex. prompts Midjourney, guide sommeil…"
                aria-label="Niche ou mot-clé à scanner"
                className="pl-9"
              />
            </div>
            <Button type="submit" disabled={isScanning}>
              {isScanning ? <Spinner /> : <Sparkles />}
              {isScanning ? 'Scan en cours…' : 'Lancer le scan'}
            </Button>
          </form>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Catégories">
            {CATEGORY_FILTERS.map((category) => {
              const Icon = category.icon;
              const isActive = selectedCategory === category.id;
              return (
                <Button
                  key={category.id}
                  type="button"
                  size="sm"
                  variant={isActive ? 'secondary' : 'outline'}
                  aria-pressed={isActive}
                  className={cn(isActive && 'border-primary/40 text-brand-green-text')}
                  onClick={() => {
                    setSelectedCategory(category.id);
                    void handleLaunchScan(category.id);
                  }}
                >
                  <Icon />
                  {category.label}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Le coût en points s’affiche avant chaque scan.</p>
        </CardContent>
      </Card>

      {scanError && !isScanning && (
        <Alert variant="warning">
          <AlertCircle />
          <AlertTitle>Scan interrompu</AlertTitle>
          <AlertDescription>
            <p>{scanError}</p>
            <Button variant="outline" size="sm" className="mt-1" onClick={() => void handleLaunchScan()}>
              <RefreshCw />
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isScanning && (
        <div className="grid gap-6 lg:grid-cols-2" aria-label="Scan en cours">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      )}

      {scanResult && !isScanning && (
        <>
          <Card className="py-5">
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-semibold">
                  {scanResult.niches.length} niche(s) détectée(s)
                  <span className="font-normal text-muted-foreground"> · {scanResult.timestamp}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Plateformes interrogées : {scanResult.platformsScanned.join(', ')}
                </p>
              </div>
              <p className="text-sm leading-relaxed">
                <span className="font-semibold">Constat : </span>
                {scanResult.executiveTakeaway}
              </p>
              {scanResult.webQueriesUsed && scanResult.webQueriesUsed.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <span className="text-xs text-muted-foreground">Requêtes utilisées :</span>
                  {scanResult.webQueriesUsed.map((query) => (
                    <Badge key={query} variant="outline">
                      <Search />
                      {query}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {scanResult.niches.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="size-4 text-brand-green-text" aria-hidden="true" />
                    Volume de recherche et accélération
                  </CardTitle>
                  <CardDescription>Une bulle par niche : score d’accélération (0–100) et milliers de recherches par mois.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={scatterConfig} className="h-64 w-full">
                    <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" dataKey="score" name="Score" domain={[0, 100]} tickLine={false} axisLine={false} />
                      <YAxis
                        type="number"
                        dataKey="volume"
                        name="Recherches (milliers)"
                        tickLine={false}
                        axisLine={false}
                        width={40}
                        tickFormatter={(value: number) => `${value} k`}
                      />
                      <ZAxis type="number" range={[80, 320]} />
                      <ChartTooltip content={<ChartTooltipContent labelKey="name" />} />
                      <Scatter data={scatterData} fill="var(--color-niches)" />
                    </ScatterChart>
                  </ChartContainer>
                  <ChartProvenance provenance={scanProvenance} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="size-4 text-brand-green-text" aria-hidden="true" />
                    Les cinq niches les plus fortes
                  </CardTitle>
                  <CardDescription>Classées par score d’accélération.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={rankingConfig} className="h-64 w-full">
                    <BarChart data={topNiches} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" width={150} tickLine={false} axisLine={false} />
                      <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                      <Bar dataKey="score" fill="var(--color-score)" radius={4} barSize={22} />
                    </BarChart>
                  </ChartContainer>
                  <ChartProvenance provenance={scanProvenance} />
                </CardContent>
              </Card>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {scanResult.niches.map((niche) => (
              <Card key={niche.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <Badge variant="brand">{niche.category}</Badge>
                      <CardTitle className="text-lg leading-snug">{niche.nicheName}</CardTitle>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="warning" className="tabular-nums">
                        <Flame />
                        {niche.explosionScore}/100
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Accélération {VELOCITY_LABELS[niche.trendVelocity] ?? niche.trendVelocity}
                      </span>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <p className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm font-medium">
                    <TrendingUp className="size-4 shrink-0 text-success" aria-hidden="true" />
                    {niche.growthSignal}
                  </p>

                  <dl className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-muted/50 p-2">
                      <dt className="text-xs text-muted-foreground">Recherches</dt>
                      <dd className="text-sm font-semibold tabular-nums">{niche.searchVolumeEstimated}</dd>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                      <dt className="text-xs text-muted-foreground">Saturation</dt>
                      <dd className={cn('text-sm font-semibold', SATURATION_TONE[niche.saturationLevel])}>
                        {niche.saturationLevel}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                      <dt className="text-xs text-muted-foreground">Marge estimée</dt>
                      <dd className="text-sm font-semibold tabular-nums">{niche.estimatedMargin}</dd>
                    </div>
                  </dl>

                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold">Pourquoi elle progresse</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{niche.whyItExplodes}</p>
                  </div>

                  {niche.topDigitalProducts.length > 0 && (
                    <div className="space-y-2 border-t pt-4">
                      <h3 className="text-sm font-semibold">Produits repérés</h3>
                      <ul className="space-y-2">
                        {niche.topDigitalProducts.map((product) => (
                          <li
                            key={product.title}
                            className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                {product.title}
                                <Badge variant="secondary">{product.format}</Badge>
                              </p>
                              <p className="text-xs text-muted-foreground">{product.keyFeature}</p>
                              <p className="text-xs text-muted-foreground">Cible : {product.targetAudience}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                              <span className="text-sm font-semibold tabular-nums">{product.priceEstimated} €</span>
                              <Button size="xs" variant="outline" onClick={() => onNavigateToMetaAds(product.title)}>
                                <Video />
                                Script pub
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {niche.viralAngles.length > 0 && (
                    <div className="space-y-1.5 border-t pt-4">
                      <h3 className="text-sm font-semibold">Angles publicitaires</h3>
                      <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                        {niche.viralAngles.map((angle) => (
                          <li key={angle}>{angle}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {niche.sources && niche.sources.length > 0 && (
                    <div className="space-y-1.5 border-t pt-4">
                      <h3 className="text-xs font-medium text-muted-foreground">Sources</h3>
                      <div className="flex flex-wrap gap-2">
                        {niche.sources.map((source) => (
                          <a
                            key={source.url}
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs text-brand-green-text hover:bg-accent"
                          >
                            <Globe className="size-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{source.title}</span>
                            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-between">
                    <Button onClick={() => void onSelectNicheForFullAnalysis(niche.nicheName)} disabled={isAnalyzingNiche}>
                      <FileText />
                      Analyser cette niche
                      <ArrowRight />
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onNavigateToMetaAds(niche.topDigitalProducts[0]?.title ?? niche.nicheName)}
                    >
                      <Video />
                      Préparer les créatifs
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
