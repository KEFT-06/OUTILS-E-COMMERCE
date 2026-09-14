import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpDown,
  CheckCircle2,
  ExternalLink,
  Globe,
  Info,
  Lightbulb,
  Minus,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  type Column,
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Bar, BarChart, CartesianGrid, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, XAxis, YAxis } from 'recharts';
import type { MarketAnalysisReport, MarketRate, SearchTrendKeyword, TauxLevel } from '@/shared/types/analysis';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/shared/ui/chart';
import { ChartProvenance } from '@/shared/ui/ChartProvenance';
import { LegalNotice } from '@/shared/ui/LegalNotice';
import { Progress } from '@/shared/ui/progress';
import { RateBadge } from '@/shared/ui/RateBadge';
import { ScoreTracePanel } from '@/shared/ui/ScoreTracePanel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';

interface StrategicAnalysisViewProps {
  report: MarketAnalysisReport;
  onNavigateToProducts: () => void;
  onNavigateToMetaAds: () => void;
}

const VERDICT_VARIANT = {
  'Opportunité Exceptionnelle': 'success',
  'Opportunité Forte': 'info',
  'Marché Compétitif': 'warning',
  'Niche Risquée': 'danger',
} as const;

const RATE_BAR: Record<TauxLevel, string> = {
  'Très élevé': 'bg-rate-excellent',
  Élevé: 'bg-rate-good',
  Moyen: 'bg-rate-medium',
  Faible: 'bg-rate-low',
};

const TREND = {
  up: { label: 'En hausse', icon: TrendingUp },
  stable: { label: 'Stable', icon: Minus },
  down: { label: 'En repli', icon: TrendingDown },
} as const;

const GROWTH_TYPE: Record<SearchTrendKeyword['growthType'], { label: string; variant: 'warning' | 'info' | 'secondary' }> = {
  explosive: { label: 'Accélération forte', variant: 'warning' },
  steady: { label: 'Croissance régulière', variant: 'info' },
  niche: { label: 'Très ciblée', variant: 'secondary' },
};

const INTENT_LABEL: Record<SearchTrendKeyword['intent'], string> = {
  transactional: 'Transactionnelle',
  commercial: 'Commerciale',
  informational: 'Informationnelle',
};

interface KeywordRow {
  keyword: string;
  volumeLabel: string;
  volume: number;
  growthLabel: string;
  growth: number;
  growthType: SearchTrendKeyword['growthType'];
  intent: SearchTrendKeyword['intent'];
}

const parseNumber = (value: string) => Number.parseFloat(value.replace(/[^0-9,.-]/g, '').replace(',', '.')) || 0;
const parseVolume = (value: string) => Number.parseInt(value.replace(/[^0-9]/g, ''), 10) || 0;
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

function SortHeader({ column, label }: { column: Column<KeywordRow, unknown>; label: string }) {
  const sorted = column.getIsSorted();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8"
      onClick={() => column.toggleSorting(sorted === 'asc')}
      aria-label={`Trier par ${label.toLowerCase()}`}
    >
      {label}
      <ArrowUpDown className="size-3.5" />
    </Button>
  );
}

const keywordColumns: ColumnDef<KeywordRow>[] = [
  {
    accessorKey: 'keyword',
    header: 'Mot-clé',
    cell: ({ row }) => <span className="font-medium">« {row.original.keyword} »</span>,
  },
  {
    accessorKey: 'volume',
    header: ({ column }) => <SortHeader column={column} label="Volume mensuel" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.volumeLabel}</span>,
  },
  {
    accessorKey: 'growth',
    header: ({ column }) => <SortHeader column={column} label="Croissance" />,
    cell: ({ row }) => <span className="font-semibold text-success tabular-nums">{row.original.growthLabel}</span>,
  },
  {
    accessorKey: 'growthType',
    header: 'Tendance',
    enableSorting: false,
    cell: ({ row }) => {
      const type = GROWTH_TYPE[row.original.growthType];
      return <Badge variant={type.variant}>{type.label}</Badge>;
    },
  },
  {
    accessorKey: 'intent',
    header: 'Intention',
    enableSorting: false,
    cell: ({ row }) => <Badge variant="outline">{INTENT_LABEL[row.original.intent]}</Badge>,
  },
];

const radarConfig = { score: { label: 'Score', color: 'var(--chart-1)' } } satisfies ChartConfig;
const volumeConfig = { volume: { label: 'Recherches / mois', color: 'var(--chart-2)' } } satisfies ChartConfig;

export function StrategicAnalysisView({ report, onNavigateToProducts, onNavigateToMetaAds }: StrategicAnalysisViewProps) {
  const [rateView, setRateView] = useState<'grid' | 'radar'>('grid');
  const [inspectedRate, setInspectedRate] = useState<MarketRate | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'volume', desc: true }]);

  const isExampleReport = report.dataProvenance?.rates?.isDemonstration ?? false;

  const rates: MarketRate[] = [
    report.rates.demand,
    report.rates.saturation,
    report.rates.profitability,
    report.rates.opportunity,
    report.rates.virality,
  ].filter(Boolean);

  const radarData = rates.map((rate) => ({
    subject: rate.label.replace('Taux de ', '').replace("Taux d'", ''),
    score: rate.score,
  }));

  const keywordRows = useMemo<KeywordRow[]>(
    () =>
      report.searchTrends.map((trend) => ({
        keyword: trend.keyword,
        volumeLabel: trend.volume,
        volume: parseVolume(trend.volume),
        growthLabel: trend.growthRate,
        growth: parseNumber(trend.growthRate),
        growthType: trend.growthType,
        intent: trend.intent,
      })),
    [report.searchTrends],
  );

  const volumeChartData = useMemo(
    () => [...keywordRows].sort((a, b) => b.volume - a.volume).map((row) => ({ keyword: row.keyword, volume: row.volume })),
    [keywordRows],
  );

  const table = useReactTable({
    data: keywordRows,
    columns: keywordColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const hasSources = (report.groundingSources?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold tracking-wider text-brand-green-text uppercase">Voir</span>
                {isExampleReport && <Badge variant="info">Rapport d’exemple</Badge>}
                <span className="text-xs text-muted-foreground">Édition : {report.dateCreated}</span>
              </div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{report.nicheName}</h1>
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                <Search className="size-4" aria-hidden="true" />
                Requête analysée : <span className="font-medium text-foreground">« {report.query} »</span>
              </p>
            </div>
            <div className="shrink-0 space-y-1.5 rounded-lg border bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground">Verdict de l’analyse</p>
              <Badge variant={VERDICT_VARIANT[report.overallVerdict]} className="px-2.5 py-1 text-sm">
                {report.overallVerdict}
              </Badge>
            </div>
          </div>

          <p className="max-w-4xl leading-relaxed">{report.executiveSummary}</p>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button variant="outline" onClick={onNavigateToProducts}>
              Idées de produits ({report.digitalProducts.length})
              <ArrowRight />
            </Button>
            <Button onClick={onNavigateToMetaAds}>
              Préparer les créatifs
              <ArrowRight />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="taux" className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            <TabsTrigger value="taux">Les 5 taux</TabsTrigger>
            <TabsTrigger value="mots-cles">Mots-clés</TabsTrigger>
            <TabsTrigger value="concurrence">Concurrence</TabsTrigger>
            <TabsTrigger value="plan">Plan d’action</TabsTrigger>
            {hasSources && <TabsTrigger value="sources">Sources</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="taux" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Seul le taux de saturation porte aujourd’hui une trace de calcul complète. Touchez un niveau pour ouvrir
              le détail, ou l’explication de son absence.
            </p>
            <div className="inline-flex shrink-0 self-start rounded-lg border bg-muted/50 p-1" role="group" aria-label="Affichage des taux">
              <Button
                size="sm"
                variant={rateView === 'grid' ? 'secondary' : 'ghost'}
                aria-pressed={rateView === 'grid'}
                onClick={() => setRateView('grid')}
              >
                Grille
              </Button>
              <Button
                size="sm"
                variant={rateView === 'radar' ? 'secondary' : 'ghost'}
                aria-pressed={rateView === 'radar'}
                onClick={() => setRateView('radar')}
              >
                Radar
              </Button>
            </div>
          </div>

          {rateView === 'grid' ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {rates.map((rate) => {
                const trend = TREND[rate.trend];
                const TrendIcon = trend.icon;
                return (
                  <Card key={rate.key} className="gap-4 py-5">
                    <CardHeader className="px-5">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm leading-snug">{rate.label}</CardTitle>
                        <RateBadge level={rate.level} size="sm" inspectLabel={rate.label} onInspect={() => setInspectedRate(rate)} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 px-5">
                      <p className="font-display text-3xl font-extrabold tabular-nums">
                        {rate.score}
                        <span className="text-sm font-medium text-muted-foreground"> / 100</span>
                      </p>
                      <Progress value={rate.score} indicatorClassName={RATE_BAR[rate.level]} aria-label={`${rate.label} : ${rate.score} sur 100`} />
                      <p className="text-sm leading-relaxed text-muted-foreground">{rate.description}</p>
                      <p className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                        Orientation
                        <span className="inline-flex items-center gap-1 font-medium text-foreground">
                          <TrendIcon className="size-3.5" aria-hidden="true" />
                          {trend.label}
                        </span>
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="grid items-center gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <ChartContainer config={radarConfig} className="mx-auto aspect-square max-h-80 w-full">
                    <RadarChart data={radarData} outerRadius="72%">
                      <PolarGrid />
                      <PolarAngleAxis dataKey="subject" />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Radar dataKey="score" fill="var(--color-score)" fillOpacity={0.3} stroke="var(--color-score)" strokeWidth={2} />
                    </RadarChart>
                  </ChartContainer>
                </div>
                <div className="space-y-3 lg:col-span-5">
                  <h2 className="font-semibold">Lire le radar</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Chaque axe va de 0 à 100. Une aire large signale une niche forte sur plusieurs taux à la fois ; elle ne
                    prédit pas à elle seule un retour sur investissement.
                  </p>
                  <ul className="divide-y">
                    {rates.map((rate) => (
                      <li key={rate.key} className="flex items-center justify-between gap-2 py-2 text-sm">
                        <span>{rate.label}</span>
                        <RateBadge level={rate.level} size="sm" inspectLabel={rate.label} onInspect={() => setInspectedRate(rate)} />
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}
          <ChartProvenance provenance={report.dataProvenance?.rates} />
        </TabsContent>

        <TabsContent value="mots-cles" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Volume de recherche par mot-clé</CardTitle>
              <CardDescription>Recherches mensuelles estimées, du plus recherché au moins recherché.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={volumeConfig}
                className="w-full"
                style={{ height: `${Math.max(160, volumeChartData.length * 52 + 40)}px` }}
              >
                <BarChart data={volumeChartData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value: number) => compact.format(value)} />
                  <YAxis
                    type="category"
                    dataKey="keyword"
                    width={190}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: string) => (value.length > 28 ? `${value.slice(0, 27)}…` : value)}
                  />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar dataKey="volume" fill="var(--color-volume)" radius={4} barSize={24} />
                </BarChart>
              </ChartContainer>
              <ChartProvenance provenance={report.dataProvenance?.searchTrends} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Détail des mots-clés</CardTitle>
              <CardDescription>Triez par volume ou par croissance.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            header.column.getIsSorted() === 'asc'
                              ? 'ascending'
                              : header.column.getIsSorted() === 'desc'
                                ? 'descending'
                                : undefined
                          }
                        >
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="concurrence" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Forces et faiblesses des concurrents repérés, pour concevoir une offre qui se distingue.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {report.competitors.map((competitor) => (
              <Card key={competitor.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="text-base">{competitor.name}</CardTitle>
                      <CardDescription className="break-all">{competitor.urlOrHandle}</CardDescription>
                    </div>
                    <Badge variant="outline" className="shrink-0 tabular-nums">
                      {competitor.priceRange}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{competitor.positioning}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/40 p-3.5">
                      <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                        <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                        Points forts
                      </p>
                      <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                        {competitor.strengths.map((strength) => (
                          <li key={strength}>{strength}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-lg border border-danger-border bg-danger-soft p-3.5">
                      <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-danger">
                        <AlertCircle className="size-4" aria-hidden="true" />
                        Frustrations clients
                      </p>
                      <ul className="list-disc space-y-1 pl-4 text-sm text-foreground/85">
                        {competitor.weaknesses.map((weakness) => (
                          <li key={weakness}>{weakness}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {competitor.exploitableGaps[0] && (
                    <div className="rounded-lg border border-primary/30 bg-accent/60 p-4">
                      <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-accent-foreground">
                        <Lightbulb className="size-4" aria-hidden="true" />
                        Angle à exploiter
                      </p>
                      <p className="text-sm">{competitor.exploitableGaps[0]}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="plan" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Chronologie recommandée pour valider l’intérêt du marché, trouver vos premiers acheteurs et protéger votre marge.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            {report.strategicActionPlan.map((phase, index) => (
              <Card key={phase.phase}>
                <CardHeader>
                  <CardDescription>
                    Étape {index + 1} · {phase.phase}
                  </CardDescription>
                  <CardTitle className="text-base">{phase.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-2.5">
                    {phase.steps.map((step, stepIndex) => (
                      <li key={step} className="flex items-start gap-2.5 text-sm">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground tabular-nums">
                          {stepIndex + 1}
                        </span>
                        <span className="leading-snug">{step}</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {hasSources && (
          <TabsContent value="sources">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="size-4 text-brand-green-text" aria-hidden="true" />
                  Sources citées par l’analyse
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-wrap gap-2">
                  {report.groundingSources?.map((source) => (
                    <li key={source.url}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-xs items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                      >
                        <span className="truncate">{source.title}</span>
                        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <LegalNotice variant="block" />

      <ScoreTracePanel
        rate={inspectedRate}
        open={inspectedRate !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setInspectedRate(null);
        }}
      />
    </div>
  );
}
