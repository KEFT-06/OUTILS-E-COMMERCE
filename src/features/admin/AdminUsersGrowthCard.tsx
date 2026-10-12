import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { GRANULARITY_RANGE, type AdminOverview, type Granularity, type UsersSeries, useAdminResource } from '@/features/admin/adminApi';
import { AdminErrorAlert, GranularityToggle } from '@/features/admin/components';
import { formatPeriod } from '@/features/admin/format';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/shared/ui/chart';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * Graphe des utilisateurs (demande du propriétaire, 11/10/2026).
 *
 * Deux lectures, donc deux graphes, chacun avec son axe : les comptes ouverts à chaque période
 * (des barres : ce sont des quantités qui s'additionnent), et le nombre de comptes à la fin de
 * chacune (une ligne : c'est un niveau qui évolue). Les mettre sur un même graphe demanderait
 * deux échelles, et l'on y lirait des croisements qui ne veulent rien dire.
 *
 * Une seule série par graphe : pas de légende, le titre la nomme. Les chiffres du haut sont ceux
 * de la vue d'ensemble, comptés au même instant.
 */

const signupsConfig = { signups: { label: 'Nouveaux comptes', color: 'var(--chart-2)' } } satisfies ChartConfig;
const totalConfig = { total: { label: 'Comptes', color: 'var(--chart-2)' } } satisfies ChartConfig;

const count = (value: number) => value.toLocaleString('fr-FR');

export function AdminUsersGrowthCard({ users, canOpenUsers }: { users: AdminOverview['users'] | null; canOpenUsers: boolean }) {
  const [granularity, setGranularity] = useState<Granularity>('day');
  const series = useAdminResource<UsersSeries>(`/api/admin/series/users?granularity=${granularity}`, { refreshMs: 60_000 });
  const points = series.data?.points.map((point) => ({ ...point, label: formatPeriod(point.period, granularity) })) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Utilisateurs</h2>
        </CardTitle>
        <CardDescription>
          {GRANULARITY_RANGE[granularity]} · {series.data ? `${count(series.data.signups)} compte${series.data.signups > 1 ? 's' : ''} ouvert${series.data.signups > 1 ? 's' : ''}` : '…'}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
          <GranularityToggle value={granularity} onChange={setGranularity} />
          {canOpenUsers && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/app/admin/utilisateurs">
                Tous les comptes
                <ArrowUpRight />
              </Link>
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {users && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Comptes enregistrés', value: users.total },
              { label: 'Ouverts aujourd’hui', value: users.newToday },
              { label: 'Sur 7 jours', value: users.new7d },
              { label: 'Sur 30 jours', value: users.new30d },
            ].map((item) => (
              <div key={item.label} className="rounded-lg bg-muted/50 p-3">
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="font-semibold tabular-nums">{count(item.value)}</dd>
              </div>
            ))}
          </dl>
        )}

        {series.error ? (
          <AdminErrorAlert error={series.error} onRetry={() => void series.reload()} />
        ) : !series.data ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-56 rounded-lg" />
            <Skeleton className="h-56 rounded-lg" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <figure className="space-y-2">
              <figcaption className="text-sm font-medium">Nouveaux comptes</figcaption>
              <ChartContainer config={signupsConfig} className="h-56 w-full">
                <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar dataKey="signups" fill="var(--color-signups)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
            </figure>
            <figure className="space-y-2">
              <figcaption className="text-sm font-medium">Comptes au total</figcaption>
              <ChartContainer config={totalConfig} className="h-56 w-full">
                <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} domain={[0, 'auto']} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {/* Segments droits : un nombre de comptes change d'un point à l'autre, il ne suit pas une courbe. */}
                  <Line dataKey="total" type="linear" stroke="var(--color-total)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                </LineChart>
              </ChartContainer>
            </figure>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
