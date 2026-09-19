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
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users,
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
import { countryName } from '@server/shared/countries';
import { researchLine, writerLine } from '@/shared/lib/reportProvenance';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import type { MarketAnalysisReport, MarketRate, OverallVerdict, SearchTrendKeyword, TauxLevel } from '@/shared/types/analysis';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/shared/ui/chart';
import { ChartProvenance } from '@/shared/components/ChartProvenance';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog';
import { LegalNotice } from '@/modules/analyse/LegalNotice';
import { NoDataState } from '@/shared/components/NoDataState';
import { Progress } from '@/shared/ui/progress';
import { RateBadge } from '@/shared/components/RateBadge';
import { ScoreTracePanel } from '@/modules/analyse/ScoreTracePanel';
import { SourceRefs } from '@/modules/analyse/SourceRefs';
import { Spinner } from '@/shared/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';

interface StrategicAnalysisViewProps {
  report: MarketAnalysisReport;
  onNavigateToProducts: () => void;
  onNavigateToMetaAds: () => void;
  /** Supprime le rapport du compte. */
  onDelete?: () => Promise<void>;
}

const VERDICT_VARIANT: Record<OverallVerdict, 'success' | 'info' | 'warning' | 'danger'> = {
  'Opportunité Exceptionnelle': 'success',
  'Opportunité Forte': 'info',
  'Marché Compétitif': 'warning',
  'Niche Risquée': 'danger',
};

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

const GROWTH_TYPE: Record<NonNullable<SearchTrendKeyword['growthType']>, { label: string; variant: 'warning' | 'info' | 'secondary' }> = {
  explosive: { label: 'Accélération forte', variant: 'warning' },
  steady: { label: 'Croissance régulière', variant: 'info' },
  niche: { label: 'Très ciblée', variant: 'secondary' },
};

const INTENT_LABEL: Record<SearchTrendKeyword['intent'], string> = {
  transactional: 'Transactionnelle',
  commercial: 'Commerciale',
  informational: 'Informationnelle',
};

/** Sur quoi repose un taux, en une ligne. */
function basisLabel(rate: MarketRate): string {
  if (rate.basis === 'measured' || rate.trace) return 'Calculé sur l’ancienne collecte publicitaire';
  if (rate.basis === 'assessment') return 'Appréciation de l’IA, fondée sur les sources citées';
  if (rate.basis === 'unavailable') return 'Non évalué';
  return 'Méthode de calcul non publiée';
}

interface KeywordRow {
  keyword: string;
  volumeLabel: string;
  volume: number;
  growthLabel: string;
  growth: number;
  growthType: SearchTrendKeyword['growthType'];
  intent: SearchTrendKeyword['intent'];
}

const parseNumber = (value: string | null) => (value ? Number.parseFloat(value.replace(/[^0-9,.-]/g, '').replace(',', '.')) || 0 : 0);
const parseVolume = (value: string | null) => (value ? Number.parseInt(value.replace(/[^0-9]/g, ''), 10) || 0 : 0);
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

const keywordColumn: ColumnDef<KeywordRow> = {
  accessorKey: 'keyword',
  header: 'Mot-clé',
  cell: ({ row }) => <span className="font-medium">« {row.original.keyword} »</span>,
};

const intentColumn: ColumnDef<KeywordRow> = {
  accessorKey: 'intent',
  header: 'Intention',
  enableSorting: false,
  cell: ({ row }) => <Badge variant="outline">{INTENT_LABEL[row.original.intent]}</Badge>,
};

/** Colonnes des rapports qui portent des volumes mesurés. */
const measuredColumns: ColumnDef<KeywordRow>[] = [
  keywordColumn,
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
      const type = row.original.growthType ? GROWTH_TYPE[row.original.growthType] : null;
      return type ? <Badge variant={type.variant}>{type.label}</Badge> : <span className="text-muted-foreground">—</span>;
    },
  },
  intentColumn,
];

const radarConfig = { score: { label: 'Score', color: 'var(--chart-1)' } } satisfies ChartConfig;
const volumeConfig = { volume: { label: 'Recherches / mois', color: 'var(--chart-2)' } } satisfies ChartConfig;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function DeleteReportButton({ nicheName, onDelete }: { nicheName: string; onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onDelete();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="text-muted-foreground">
          <Trash2 />
          Supprimer le rapport
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Supprimer ce rapport ?</DialogTitle>
          <DialogDescription>
            Le rapport « {nicheName} » sera effacé de votre compte. Les points de l’analyse ne sont pas rendus.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose asChild>
            <Button variant="outline">Annuler</Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy && <Spinner />}
            Supprimer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StrategicAnalysisView({ report, onNavigateToProducts, onNavigateToMetaAds, onDelete }: StrategicAnalysisViewProps) {
  const [rateView, setRateView] = useState<'grid' | 'radar'>('grid');
  const [inspectedRate, setInspectedRate] = useState<MarketRate | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'volume', desc: true }]);

  const isExampleReport = report.dataProvenance?.rates?.isDemonstration ?? false;
  const sources = report.groundingSources ?? [];
  const limitations = report.limitations ?? [];

  const rates: MarketRate[] = [
    report.rates.demand,
    report.rates.saturation,
    report.rates.profitability,
    report.rates.opportunity,
    report.rates.virality,
  ].filter(Boolean);

  // Le radar ne trace que des scores calculés : un niveau qualitatif n'a pas de place sur un axe de 0 à 100.
  const scoredRates = rates.filter((rate): rate is MarketRate & { score: number } => rate.score !== null);
  const canShowRadar = scoredRates.length >= 3;
  const radarData = scoredRates.map((rate) => ({
    subject: rate.label.replace('Taux de ', '').replace('Taux d’', '').replace("Taux d'", ''),
    score: rate.score,
  }));

  const hasVolumes = report.searchTrends.some((trend) => Boolean(trend.volume));
  const keywordRows = useMemo<KeywordRow[]>(
    () =>
      report.searchTrends.map((trend) => ({
        keyword: trend.keyword,
        volumeLabel: trend.volume ?? '—',
        volume: parseVolume(trend.volume),
        growthLabel: trend.growthRate ?? '—',
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
    columns: hasVolumes ? measuredColumns : [keywordColumn, intentColumn],
    state: { sorting: hasVolumes ? sorting : [] },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const generatedBy = report.generator;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold tracking-wider text-brand-green-text uppercase">Voir</span>
                {isExampleReport && <Badge variant="info">Rapport d’exemple</Badge>}
                {report.market && <Badge variant="outline">{countryName(report.market)}</Badge>}
                <span className="text-xs text-muted-foreground">Édition : {report.dateCreated}</span>
              </div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{report.nicheName}</h1>
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                <Search className="size-4" aria-hidden="true" />
                Requête analysée : <span className="font-medium text-foreground">« {report.query} »</span>
              </p>
            </div>
            <div className="shrink-0 space-y-1.5 rounded-lg border bg-muted/40 p-4 lg:max-w-xs">
              <p className="text-xs text-muted-foreground">Verdict de l’analyse</p>
              {report.overallVerdict ? (
                <Badge variant={VERDICT_VARIANT[report.overallVerdict]} className="px-2.5 py-1 text-sm">
                  {report.overallVerdict}
                </Badge>
              ) : (
                <Badge variant="secondary" className="px-2.5 py-1 text-sm">
                  Non établi
                </Badge>
              )}
              {report.verdictRationale && <p className="text-xs leading-relaxed text-muted-foreground">{report.verdictRationale}</p>}
            </div>
          </div>

          <div className="max-w-4xl space-y-2">
            <p className="leading-relaxed">{report.executiveSummary}</p>
            <SourceRefs ids={report.summarySourceIds} sources={sources} />
          </div>

          {generatedBy && (
            <Alert variant="info">
              <Info />
              <AlertTitle>Provenance du rapport</AlertTitle>
              <AlertDescription>
                <p>
                  {researchLine(report)} {writerLine(report)}
                </p>
                <p>
                  Les faits de marché (concurrents, prix constatés, niveaux des taux) renvoient chacun à leurs sources, numérotées.
                  Les idées de produits, les scripts et le plan d’action sont des propositions de l’IA fondées sur l’étude, à relire
                  avant usage.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {limitations.length > 0 && (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>Points à vérifier avant de lancer</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button variant="outline" onClick={onNavigateToProducts}>
              Idées de produits ({report.digitalProducts.length})
              <ArrowRight />
            </Button>
            <Button onClick={onNavigateToMetaAds}>
              Préparer les créatifs
              <ArrowRight />
            </Button>
            {onDelete && (
              <span className="sm:ml-auto">
                <DeleteReportButton nicheName={report.nicheName} onDelete={onDelete} />
              </span>
            )}
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
            {sources.length > 0 && <TabsTrigger value="sources">Sources ({sources.length})</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="taux" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Touchez un niveau pour voir sur quoi il repose : calcul sur une collecte, sources citées, ou raison de son absence.
            </p>
            {canShowRadar && (
              <div className="inline-flex shrink-0 self-start rounded-lg border bg-muted/50 p-1" role="group" aria-label="Affichage des taux">
                <Button size="sm" variant={rateView === 'grid' ? 'secondary' : 'ghost'} aria-pressed={rateView === 'grid'} onClick={() => setRateView('grid')}>
                  Grille
                </Button>
                <Button size="sm" variant={rateView === 'radar' ? 'secondary' : 'ghost'} aria-pressed={rateView === 'radar'} onClick={() => setRateView('radar')}>
                  Radar
                </Button>
              </div>
            )}
          </div>

          {rateView === 'grid' || !canShowRadar ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {rates.map((rate) => {
                const trend = rate.trend ? TREND[rate.trend] : null;
                const TrendIcon = trend?.icon;
                return (
                  <Card key={rate.key} className="gap-4 py-5">
                    <CardHeader className="px-5">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm leading-snug">{rate.label}</CardTitle>
                        <RateBadge level={rate.level} size="sm" inspectLabel={rate.label} onInspect={() => setInspectedRate(rate)} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 px-5">
                      {rate.score !== null ? (
                        <>
                          <p className="font-display text-3xl font-extrabold tabular-nums">
                            {rate.score}
                            <span className="text-sm font-medium text-muted-foreground"> / 100</span>
                          </p>
                          <Progress
                            value={rate.score}
                            indicatorClassName={rate.level ? RATE_BAR[rate.level] : undefined}
                            aria-label={`${rate.label} : ${rate.score} sur 100`}
                          />
                        </>
                      ) : (
                        <p className="text-xs font-medium text-muted-foreground">{basisLabel(rate)}</p>
                      )}
                      <p className="text-sm leading-relaxed text-muted-foreground">{rate.description}</p>
                      <SourceRefs ids={rate.sourceIds} sources={sources} />
                      {trend && TrendIcon && (
                        <p className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                          Orientation
                          <span className="inline-flex items-center gap-1 font-medium text-foreground">
                            <TrendIcon className="size-3.5" aria-hidden="true" />
                            {trend.label}
                          </span>
                        </p>
                      )}
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
          {hasVolumes && (
            <Card>
              <CardHeader>
                <CardTitle>Volume de recherche par mot-clé</CardTitle>
                <CardDescription>Recherches mensuelles estimées, du plus recherché au moins recherché.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={volumeConfig} className="w-full" style={{ height: `${Math.max(160, volumeChartData.length * 52 + 40)}px` }}>
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
          )}

          <Card>
            <CardHeader>
              <CardTitle>{hasVolumes ? 'Détail des mots-clés' : 'Pistes de mots-clés'}</CardTitle>
              <CardDescription>
                {hasVolumes
                  ? 'Triez par volume ou par croissance.'
                  : 'Expressions que vos acheteurs pourraient taper. Les volumes de recherche ne sont pas publiés : mesurez-les dans un outil de mots-clés avant d’investir en publicité.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {keywordRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun mot-clé dans ce rapport.</p>
              ) : (
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead
                            key={header.id}
                            aria-sort={
                              header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined
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
              )}
              {!hasVolumes && <ChartProvenance provenance={report.dataProvenance?.searchTrends} />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="concurrence" className="space-y-4">
          {report.competitors.length === 0 ? (
            <NoDataState
              icon={Users}
              title="Aucun concurrent établi"
              reason={
                sources.length > 0
                  ? 'Aucun concurrent n’apparaît dans les sources consultées pour cette niche.'
                  : 'Sans recherche web, aucun concurrent n’est avancé : il n’y aurait aucune source pour le vérifier.'
              }
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Concurrents repérés dans les sources citées, avec ce que ces pages montrent de leurs forces et faiblesses.
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                {report.competitors.map((competitor) => {
                  const link = safeHttpUrl(competitor.urlOrHandle);
                  return (
                    <Card key={competitor.id}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <CardTitle className="text-base">{competitor.name}</CardTitle>
                            <CardDescription className="break-all">
                              {link ? (
                                <a href={link} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
                                  {hostnameOf(link)}
                                </a>
                              ) : (
                                competitor.urlOrHandle
                              )}
                            </CardDescription>
                          </div>
                          <Badge variant="outline" className="max-w-[45%] shrink-0 text-right whitespace-normal tabular-nums">
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
                            {competitor.strengths.length > 0 ? (
                              <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                                {competitor.strengths.map((strength) => (
                                  <li key={strength}>{strength}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-sm text-muted-foreground">Non documentés dans les sources.</p>
                            )}
                          </div>
                          <div className="rounded-lg border border-danger-border bg-danger-soft p-3.5">
                            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-danger">
                              <AlertCircle className="size-4" aria-hidden="true" />
                              Frustrations clients
                            </p>
                            {competitor.weaknesses.length > 0 ? (
                              <ul className="list-disc space-y-1 pl-4 text-sm text-foreground/85">
                                {competitor.weaknesses.map((weakness) => (
                                  <li key={weakness}>{weakness}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-sm text-foreground/85">Non documentées dans les sources.</p>
                            )}
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
                        <SourceRefs ids={competitor.sourceIds} sources={sources} />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              <ChartProvenance provenance={report.dataProvenance?.competitors} />
            </>
          )}
        </TabsContent>

        <TabsContent value="plan" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Chronologie proposée pour valider l’intérêt du marché, trouver vos premiers acheteurs et protéger votre marge.
          </p>
          {report.strategicActionPlan.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun plan d’action dans ce rapport.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {report.strategicActionPlan.map((phase, index) => (
                <Card key={`${phase.phase}-${index}`}>
                  <CardHeader>
                    <CardDescription>
                      Étape {index + 1} · {phase.phase}
                    </CardDescription>
                    <CardTitle className="text-base">{phase.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ol className="space-y-2.5">
                      {phase.steps.map((step, stepIndex) => (
                        <li key={`${stepIndex}-${step}`} className="flex items-start gap-2.5 text-sm">
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
          )}
          {report.strategicActionPlan.length > 0 && <ChartProvenance provenance={report.dataProvenance?.strategicActionPlan} />}
        </TabsContent>

        {sources.length > 0 && (
          <TabsContent value="sources">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="size-4 text-brand-green-text" aria-hidden="true" />
                  Sources citées par l’analyse
                </CardTitle>
                <CardDescription>
                  {generatedBy ? `${researchLine(report)} ${writerLine(report) ?? ''}` : 'Pages web consultées pour ce rapport.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2">
                  {sources.map((source, index) => {
                    const url = safeHttpUrl(source.url);
                    const number = source.id ?? index + 1;
                    return (
                      <li key={`${number}-${source.url}`} className="flex items-start gap-3 text-sm">
                        <span className="mt-0.5 w-8 shrink-0 font-semibold text-muted-foreground tabular-nums">[{number}]</span>
                        <span className="min-w-0 space-y-0.5">
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-start gap-1.5 font-medium underline-offset-4 hover:underline"
                            >
                              <span className="break-words">{source.title}</span>
                              <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            </a>
                          ) : (
                            <span className="font-medium">{source.title}</span>
                          )}
                          <span className="block text-xs text-muted-foreground">
                            {hostnameOf(source.url)}
                            {source.publishedAt ? ` · ${source.publishedAt}` : ''}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <LegalNotice variant="block" />

      <ScoreTracePanel
        rate={inspectedRate}
        sources={sources}
        open={inspectedRate !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setInspectedRate(null);
        }}
      />
    </div>
  );
}
