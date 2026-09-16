import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  Activity,
  ArrowUpRight,
  Banknote,
  Coins,
  Film,
  RefreshCw,
  Repeat,
  ShieldAlert,
  UsersRound,
  Wifi,
} from 'lucide-react';
import {
  GRANULARITY_RANGE,
  type AdminOverview,
  type Granularity,
  type OnlineUsers,
  type RevenueSeries,
  useAdminMeta,
  useAdminResource,
} from '@/features/admin/adminApi';
import { AdminErrorAlert, GranularityToggle, KpiCard } from '@/features/admin/components';
import { changeRatio, compactNumber, describeAuditDetails, formatPeriod } from '@/features/admin/format';
import { initialsOf, useAuth } from '@/features/auth/AuthContext';
import { PageHeader } from '@/shared/components/PageHeader';
import { formatRelativeFr } from '@/shared/lib/formatDate';
import { AUDIT_ACTION_LABELS, GENERATION_KIND_LABELS, labelOf } from '@/shared/lib/labels';
import { formatFcfa } from '@/shared/lib/plans';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/shared/ui/chart';
import { NoDataState } from '@/shared/components/NoDataState';
import { Progress } from '@/shared/ui/progress';
import { Skeleton } from '@/shared/ui/skeleton';

const revenueConfig = { amount: { label: 'Encaissé (FCFA)', color: 'var(--chart-1)' } } satisfies ChartConfig;

export function AdminOverviewPage() {
  const { account } = useAuth();
  const meta = useAdminMeta();
  const canRevenue = account?.permissions.includes('admin.revenue.read') ?? false;
  const canUsers = account?.permissions.includes('admin.users.read') ?? false;
  const canSecurity = account?.permissions.includes('admin.security.read') ?? false;
  const [granularity, setGranularity] = useState<Granularity>('day');

  const overview = useAdminResource<AdminOverview>('/api/admin/overview', { refreshMs: 60_000 });
  const online = useAdminResource<OnlineUsers>('/api/admin/online', { refreshMs: 30_000 });
  const revenue = useAdminResource<RevenueSeries>(canRevenue ? `/api/admin/revenue?granularity=${granularity}` : null, {
    refreshMs: 60_000,
  });

  const data = overview.data;
  const planLabels = Object.fromEntries((meta?.plans ?? []).map((plan) => [plan.id, plan.label]));
  const permissionLabels = Object.fromEntries((meta?.permissions ?? []).map((permission) => [permission.id, permission.label]));
  const contentLast30 = data?.content.byKind.reduce((sum, row) => sum + row.last30d, 0) ?? 0;
  const contentTotal = data?.content.byKind.reduce((sum, row) => sum + row.total, 0) ?? 0;
  const monthChange = data?.revenue ? changeRatio(data.revenue.month, data.revenue.previousMonth) : null;

  const reloadAll = () => {
    void overview.reload();
    void online.reload();
    void revenue.reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Vue d’ensemble"
        description={`Chiffres calculés en base sur les données réelles, actualisés chaque minute.${data ? ` Fuseau : ${data.timezone}.` : ''}`}
        actions={
          <Button variant="outline" size="sm" onClick={reloadAll} disabled={overview.loading}>
            <RefreshCw />
            Actualiser
          </Button>
        }
      />

      {overview.error && <AdminErrorAlert error={overview.error} onRetry={() => void overview.reload()} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {!data ? (
          Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)
        ) : (
          <>
            {data.revenue && (
              <KpiCard
                label="Revenus du mois"
                value={formatFcfa(data.revenue.month)}
                icon={Banknote}
                tone="brand"
                hint={
                  monthChange === null
                    ? `Mois précédent : ${formatFcfa(data.revenue.previousMonth)}`
                    : `${monthChange >= 0 ? '+' : ''}${monthChange} % par rapport au mois précédent (${formatFcfa(data.revenue.previousMonth)})`
                }
              />
            )}
            {data.revenue && (
              <KpiCard
                label="Revenu mensuel récurrent"
                value={formatFcfa(data.revenue.monthlyRecurring)}
                icon={Repeat}
                hint={`${data.revenue.activeSubscribers} abonné${data.revenue.activeSubscribers > 1 ? 's' : ''} sur un palier payant`}
              />
            )}
            <KpiCard
              label="En ligne maintenant"
              value={data.online.users}
              icon={Wifi}
              tone="success"
              hint={`Utilisateurs actifs : ${data.online.activeToday} aujourd’hui · ${data.online.active7d} sur 7 jours · ${data.online.active30d} sur 30 jours`}
            />
            <KpiCard
              label="Comptes enregistrés"
              value={data.users.total.toLocaleString('fr-FR')}
              icon={UsersRound}
              hint={`+${data.users.new7d} en 7 jours · ${data.users.newToday} aujourd’hui${data.users.suspended ? ` · ${data.users.suspended} bloqué(s)` : ''}`}
            />
            <KpiCard
              label="Contenus créés sur 30 jours"
              value={contentLast30.toLocaleString('fr-FR')}
              icon={Film}
              hint={`${contentTotal.toLocaleString('fr-FR')} depuis l’ouverture`}
            />
            <KpiCard
              label="Points consommés sur 30 jours"
              value={data.credits.consumed30d.toLocaleString('fr-FR')}
              icon={Coins}
              tone="warning"
              hint={`${data.credits.granted30d.toLocaleString('fr-FR')} offerts par l’équipe sur la même période`}
            />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {canRevenue && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>
                <h2>Revenus des abonnements</h2>
              </CardTitle>
              <CardDescription>
                {GRANULARITY_RANGE[granularity]} · {revenue.data ? formatFcfa(revenue.data.total) : '…'} encaissés, remboursements exclus
              </CardDescription>
              <CardAction>
                <GranularityToggle value={granularity} onChange={setGranularity} />
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              {data?.revenue && (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Aujourd’hui', value: data.revenue.today },
                    { label: 'Ce mois', value: data.revenue.month },
                    { label: 'Cette année', value: data.revenue.year },
                    { label: 'Depuis l’ouverture', value: data.revenue.total },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg bg-muted/50 p-3">
                      <dt className="text-xs text-muted-foreground">{item.label}</dt>
                      <dd className="font-semibold tabular-nums">{formatFcfa(item.value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {revenue.error ? (
                <AdminErrorAlert error={revenue.error} onRetry={() => void revenue.reload()} />
              ) : !revenue.data ? (
                <Skeleton className="h-64 rounded-lg" />
              ) : (
                <ChartContainer config={revenueConfig} className="h-64 w-full">
                  <AreaChart
                    data={revenue.data.points.map((point) => ({ ...point, label: formatPeriod(point.period, granularity) }))}
                    margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => compactNumber(value)} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      dataKey="amount"
                      type="monotone"
                      stroke="var(--color-amount)"
                      fill="var(--color-amount)"
                      fillOpacity={0.15}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        )}

        <Card className={canRevenue ? '' : 'lg:col-span-2'}>
          <CardHeader>
            <CardTitle>
              <h2 className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-success" aria-hidden="true" />
                En ligne maintenant
              </h2>
            </CardTitle>
            <CardDescription>Actifs dans les {online.data?.windowMinutes ?? 5} dernières minutes</CardDescription>
            {canUsers && (
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/app/admin/utilisateurs?en-ligne=1">
                    Tous
                    <ArrowUpRight />
                  </Link>
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {!online.data ? (
              <div className="space-y-3">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : online.data.users.length === 0 ? (
              <p className="text-sm text-muted-foreground">Personne n’est connecté en ce moment.</p>
            ) : (
              <ul className="space-y-3">
                {online.data.users.slice(0, 8).map((entry) => (
                  <li key={entry.user.id} className="flex items-center gap-3">
                    <Avatar className="size-9 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-accent text-xs font-semibold text-accent-foreground">
                        {initialsOf(entry.user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      {canUsers ? (
                        <Link to={`/app/admin/utilisateurs/${entry.user.id}`} className="block truncate text-sm font-medium hover:underline">
                          {entry.user.name}
                        </Link>
                      ) : (
                        <span className="block truncate text-sm font-medium">{entry.user.name}</span>
                      )}
                      <span className="block truncate text-xs text-muted-foreground">
                        {entry.devices[0]?.device} · {formatRelativeFr(entry.lastSeenAt)}
                      </span>
                    </div>
                    <Badge variant={entry.user.plan === 'free' ? 'secondary' : 'brand'}>{entry.user.planLabel}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Comptes par palier</h2>
            </CardTitle>
            <CardDescription>{data ? `${data.users.total} comptes, ${data.users.withTwoFactor} avec double authentification` : '…'}</CardDescription>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-40" />
            ) : (
              <ul className="space-y-3">
                {data.plans.map((plan) => (
                  <li key={plan.id} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">{plan.label}</span>
                      <span className="text-muted-foreground tabular-nums">{plan.users}</span>
                    </div>
                    <Progress
                      value={data.users.total ? (plan.users / data.users.total) * 100 : 0}
                      className="h-1.5"
                      aria-label={`Part des comptes au palier ${plan.label}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Contenus créés</h2>
            </CardTitle>
            <CardDescription>Depuis l’ouverture · 30 derniers jours</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/app/admin/contenus">
                  Détail
                  <ArrowUpRight />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-40" />
            ) : (
              <ul className="divide-y">
                {data.content.byKind
                  .filter((row) => row.kind !== 'ad_scan')
                  .map((row) => (
                    <li key={row.kind} className="flex items-baseline justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
                      <span>{labelOf(GENERATION_KIND_LABELS, row.kind)}</span>
                      <span className="tabular-nums">
                        <span className="font-semibold">{row.total}</span>
                        <span className="text-muted-foreground"> · {row.last30d}</span>
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {canSecurity && data?.security ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="flex items-center gap-2">
                  <ShieldAlert className="size-4 text-brand-green-text" aria-hidden="true" />
                  Sécurité sur 24 h
                </h2>
              </CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/app/admin/securite">
                    Journal
                    <ArrowUpRight />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Connexions réussies', value: data.security.logins24h, tone: '' },
                  { label: 'Échecs', value: data.security.failedLogins24h, tone: data.security.failedLogins24h > 20 ? 'text-warning' : '' },
                  { label: 'Tentatives bloquées', value: data.security.blockedAttempts24h, tone: data.security.blockedAttempts24h ? 'text-warning' : '' },
                  { label: 'Verrous actifs', value: data.security.activeLocks, tone: data.security.activeLocks ? 'text-danger' : '' },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg bg-muted/50 p-3">
                    <dt className="text-xs text-muted-foreground">{item.label}</dt>
                    <dd className={`font-display text-xl font-extrabold tabular-nums ${item.tone}`}>{item.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Nouveaux comptes</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data && (
                <dl className="grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: 'Aujourd’hui', value: data.users.newToday },
                    { label: '7 jours', value: data.users.new7d },
                    { label: '30 jours', value: data.users.new30d },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg bg-muted/50 p-3">
                      <dt className="text-xs text-muted-foreground">{item.label}</dt>
                      <dd className="font-display text-xl font-extrabold tabular-nums">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {canSecurity && data?.recentActivity && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="flex items-center gap-2">
                <Activity className="size-4 text-brand-green-text" aria-hidden="true" />
                Dernières actions de l’équipe
              </h2>
            </CardTitle>
            <CardDescription>Chaque modification de compte, de solde ou de paiement laisse une trace.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentActivity.length === 0 ? (
              <NoDataState title="Aucune action pour l’instant" reason="Les actions de l’équipe d’administration apparaîtront ici." />
            ) : (
              <ul className="divide-y">
                {data.recentActivity.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {labelOf(AUDIT_ACTION_LABELS, entry.action)}
                        {entry.targetEmail && <span className="font-normal text-muted-foreground"> · {entry.targetEmail}</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {describeAuditDetails(entry.action, entry.details, { plans: planLabels, permissions: permissionLabels })}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {entry.actorEmail} · {formatRelativeFr(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {!canRevenue && data && (
        <p className="text-xs text-muted-foreground">
          Les revenus ne s’affichent qu’aux comptes qui détiennent le privilège « Voir les revenus ».
        </p>
      )}
    </div>
  );
}
