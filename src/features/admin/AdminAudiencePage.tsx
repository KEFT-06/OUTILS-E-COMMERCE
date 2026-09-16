import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { Eye, MousePointerClick, Percent, UserPlus } from 'lucide-react';
import { type AudienceSummary, useAdminResource } from '@/features/admin/adminApi';
import { AdminErrorAlert, KpiCard } from '@/features/admin/components';
import { PageHeader } from '@/shared/components/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/shared/ui/chart';
import { NoDataState } from '@/shared/components/NoDataState';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

/**
 * Audience du site sur 30 jours, mesurée sans cookie ni service tiers : pages
 * publiques vues, visiteurs uniques du jour, inscriptions. Les pages de l'espace de
 * travail ne sont pas comptées ; un refus de suivi du navigateur est respecté.
 */

const chartConfig = {
  visits: { label: 'Pages vues', color: 'var(--chart-1)' },
  uniques: { label: 'Visiteurs uniques', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const shortDay = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

const number = new Intl.NumberFormat('fr-FR');

export function AdminAudiencePage() {
  const { data, error, reload } = useAdminResource<AudienceSummary>('/api/admin/audience', { refreshMs: 5 * 60_000 });
  const totalPageViews = data?.totals.visits ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Audience"
        description="Visiteurs des pages publiques et inscriptions sur 30 jours. Mesure sans cookie : aucun identifiant n’est gardé, les refus de suivi et les robots sont ignorés."
      />

      {error && <AdminErrorAlert error={error} onRetry={() => void reload()} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!data ? (
          Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)
        ) : (
          <>
            <KpiCard label="Pages vues" value={number.format(data.totals.visits)} icon={Eye} hint="Pages publiques, 30 jours" />
            <KpiCard
              label="Visiteurs uniques"
              value={number.format(data.totals.uniques)}
              icon={MousePointerClick}
              hint="Somme des visiteurs de chaque jour"
            />
            <KpiCard label="Inscriptions" value={number.format(data.totals.signups)} icon={UserPlus} tone="success" hint="Comptes créés, 30 jours" />
            <KpiCard
              label="Taux d’inscription"
              value={data.totals.conversionPercent === null ? '—' : `${data.totals.conversionPercent.toLocaleString('fr-FR')} %`}
              icon={Percent}
              hint="Inscriptions pour 100 visiteurs uniques"
            />
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Fréquentation jour par jour</h2>
          </CardTitle>
          <CardDescription>
            {data ? `30 derniers jours, fuseau ${data.timezone}.` : 'Chargement…'} Un même visiteur revenu un autre jour compte à nouveau.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Skeleton className="h-72" />
          ) : totalPageViews === 0 ? (
            <NoDataState
              icon={Eye}
              title="Aucune visite mesurée pour l’instant"
              reason="Les visites des pages publiques (accueil, connexion, contact, pages légales) s’afficheront ici."
            />
          ) : (
            <ChartContainer config={chartConfig} className="h-72 w-full">
              <LineChart data={data.daily} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} tickFormatter={shortDay} />
                <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                <ChartTooltip cursor content={<ChartTooltipContent labelFormatter={(value) => shortDay(String(value))} />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Line dataKey="visits" type="monotone" stroke="var(--color-visits)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line dataKey="uniques" type="monotone" stroke="var(--color-uniques)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="py-4">
          <CardHeader className="px-4 sm:px-6">
            <CardTitle>
              <h2>Pages les plus vues</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            {!data ? (
              <Skeleton className="h-40" />
            ) : data.pages.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">Aucune page vue sur la période.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Page</TableHead>
                    <TableHead className="text-right">Vues</TableHead>
                    <TableHead className="text-right">Part</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.pages.map((page) => (
                    <TableRow key={page.path}>
                      <TableCell>
                        <span className="font-medium">{page.label}</span>
                        <span className="block text-xs text-muted-foreground">{page.path}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{number.format(page.visits)}</TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {Math.round((page.visits / totalPageViews) * 100)} %
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardHeader className="px-4 sm:px-6">
            <CardTitle>
              <h2>D’où viennent les visiteurs</h2>
            </CardTitle>
            <CardDescription>Domaine du site d’origine, sans l’adresse exacte de la page.</CardDescription>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            {!data ? (
              <Skeleton className="h-40" />
            ) : data.referrers.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">Aucune visite sur la période.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Origine</TableHead>
                    <TableHead className="text-right">Vues</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.referrers.map((referrer) => (
                    <TableRow key={referrer.host ?? 'direct'}>
                      <TableCell className="font-medium">{referrer.host ?? 'Accès direct ou navigation interne'}</TableCell>
                      <TableCell className="text-right tabular-nums">{number.format(referrer.visits)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
