import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  BookOpen,
  BookText,
  Bookmark,
  Clapperboard,
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Radar,
  Rocket,
} from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { GRANULARITY_RANGE, type ContentStats, type Granularity, useAdminResource } from '@/features/admin/adminApi';
import { AdminErrorAlert, GranularityToggle, KpiCard } from '@/features/admin/components';
import { formatPeriod } from '@/features/admin/format';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader } from '@/shared/components/PageHeader';
import { FILE_FORMAT_LABELS, GENERATION_KIND_LABELS, labelOf } from '@/shared/lib/labels';
import { Badge } from '@/shared/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/shared/ui/chart';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const KIND_ICONS: Record<string, LucideIcon> = {
  video: Clapperboard,
  image: ImageIcon,
  storybook: BookOpen,
  ebook: BookText,
  product_page: LayoutTemplate,
  report_pdf: FileText,
  swipe_file: Bookmark,
  launch_kit: Rocket,
  ad_scan: Radar,
};

/** Exports faits dans le navigateur : comptés sur déclaration de l'appareil, pas mesurés par le serveur. */
const DECLARED_KINDS = new Set(['ebook', 'product_page', 'report_pdf', 'swipe_file', 'launch_kit']);

const FORMAT_ORDER = ['mp4', 'mp3', 'png', 'pdf', 'docx', 'html', 'csv', 'txt', 'lien'];

const OTHER_KINDS = ['product_page', 'report_pdf', 'swipe_file', 'launch_kit', 'ad_scan'];

const seriesConfig = {
  video: { label: 'Vidéos', color: 'var(--chart-1)' },
  image: { label: 'Visuels', color: 'var(--chart-2)' },
  ebook: { label: 'Ebooks', color: 'var(--chart-3)' },
  storybook: { label: 'Storybooks', color: 'var(--chart-4)' },
  other: { label: 'Autres', color: 'var(--chart-5)' },
} satisfies ChartConfig;

export function AdminContentPage() {
  const { account } = useAuth();
  const { costTable } = useCreditGate();
  const [granularity, setGranularity] = useState<Granularity>('day');
  const { data, error, reload } = useAdminResource<ContentStats>(`/api/admin/content?granularity=${granularity}`, { refreshMs: 60_000 });
  const canUsers = account?.permissions.includes('admin.users.read') ?? false;

  const points =
    data?.series.points.map((point) => ({
      label: formatPeriod(point.period, granularity),
      video: Number(point.video ?? 0),
      image: Number(point.image ?? 0),
      ebook: Number(point.ebook ?? 0),
      storybook: Number(point.storybook ?? 0),
      other: OTHER_KINDS.reduce((sum, kind) => sum + Number(point[kind] ?? 0), 0),
    })) ?? [];

  const formats = FORMAT_ORDER.map((format) => ({
    format,
    files: data?.totals.byFormat.find((row) => row.format === format)?.files ?? 0,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Contenus créés"
        description="Tout ce que les comptes ont généré ou exporté. « Mesuré » : constaté par le serveur ; « déclaré » : export fait dans le navigateur."
      />

      {error && <AdminErrorAlert error={error} onRetry={() => void reload()} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {!data
          ? Array.from({ length: 9 }, (_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)
          : data.totals.byKind.map((row) => (
              <KpiCard
                key={row.kind}
                label={labelOf(GENERATION_KIND_LABELS, row.kind)}
                value={row.total.toLocaleString('fr-FR')}
                icon={KIND_ICONS[row.kind] ?? FileText}
                tone={row.kind === 'video' ? 'brand' : 'default'}
                hint={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span>{row.last30d} sur 30 jours</span>
                    {row.failed > 0 && <span>· {row.failed} échouée{row.failed > 1 ? 's' : ''}, points rendus</span>}
                    <Badge variant={DECLARED_KINDS.has(row.kind) ? 'outline' : 'secondary'}>
                      {DECLARED_KINDS.has(row.kind) ? 'déclaré' : 'mesuré'}
                    </Badge>
                  </span>
                }
              />
            ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Rythme de création</h2>
          </CardTitle>
          <CardDescription>{GRANULARITY_RANGE[granularity]}, toutes générations et exports confondus</CardDescription>
          <CardAction>
            <GranularityToggle value={granularity} onChange={setGranularity} />
          </CardAction>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Skeleton className="h-72 rounded-lg" />
          ) : (
            <ChartContainer config={seriesConfig} className="h-72 w-full">
              <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="video" stackId="contenus" isAnimationActive={false} fill="var(--color-video)" />
                <Bar dataKey="image" stackId="contenus" isAnimationActive={false} fill="var(--color-image)" />
                <Bar dataKey="ebook" stackId="contenus" isAnimationActive={false} fill="var(--color-ebook)" />
                <Bar dataKey="storybook" stackId="contenus" isAnimationActive={false} fill="var(--color-storybook)" />
                <Bar dataKey="other" stackId="contenus" isAnimationActive={false} fill="var(--color-other)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Fichiers produits par format</h2>
            </CardTitle>
            <CardDescription>Générations terminées et exports, depuis l’ouverture</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {formats.map((row) => (
                <li key={row.format} className="flex items-baseline justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
                  <span>
                    {labelOf(FILE_FORMAT_LABELS, row.format)}
                    {row.format === 'mp3' && (
                      <span className="block text-xs text-muted-foreground">Aucune génération audio n’existe encore dans Smart Creator.</span>
                    )}
                  </span>
                  <span className="font-semibold tabular-nums">{row.files.toLocaleString('fr-FR')}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Créateurs les plus actifs</h2>
            </CardTitle>
            <CardDescription>30 derniers jours</CardDescription>
          </CardHeader>
          <CardContent>
            {!data || data.topCreators.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune création sur la période.</p>
            ) : (
              <ol className="space-y-3">
                {data.topCreators.map((creator, index) => (
                  <li key={creator.userId} className="flex items-center gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      {canUsers ? (
                        <Link to={`/app/admin/utilisateurs/${creator.userId}`} className="block truncate text-sm font-medium hover:underline">
                          {creator.name}
                        </Link>
                      ) : (
                        <span className="block truncate text-sm font-medium">{creator.name}</span>
                      )}
                      <span className="block truncate text-xs text-muted-foreground">{creator.email}</span>
                    </div>
                    <span className="font-semibold tabular-nums">{creator.generations}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Points consommés par action</h2>
          </CardTitle>
          <CardDescription>30 derniers jours, remboursements déduits</CardDescription>
        </CardHeader>
        <CardContent>
          {!data || data.creditsByAction.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune action payante sur la période.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Utilisations</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.creditsByAction.map((row) => (
                  <TableRow key={row.actionId ?? 'inconnue'}>
                    <TableCell className="font-medium">
                      {costTable?.actions.find((action) => action.id === row.actionId)?.label ?? row.actionId ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.uses}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{row.points}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
