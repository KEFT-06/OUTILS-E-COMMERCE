import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Banknote, CalendarDays, CalendarRange, Info, Repeat, TrendingUp, Wallet } from 'lucide-react';
import {
  GRANULARITY_RANGE,
  type Granularity,
  type PaymentList,
  type RevenueSeries,
  type RevenueTotals,
  useAdminMeta,
  useAdminResource,
} from '@/features/admin/adminApi';
import { RecordPaymentDialog, RefundPaymentDialog } from '@/features/admin/AdminDialogs';
import { AdminErrorAlert, GranularityToggle, KpiCard, Pagination } from '@/features/admin/components';
import { changeRatio, compactNumber, formatPeriod } from '@/features/admin/format';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader } from '@/shared/components/PageHeader';
import { formatDateFr } from '@/shared/lib/formatDate';
import { PAYMENT_METHOD_LABELS, labelOf } from '@/shared/lib/labels';
import { formatFcfa } from '@/shared/lib/plans';
import { useProviders } from '@/shared/lib/useProviders';
import { formatPaymentAmount } from '@/features/admin/format';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/shared/ui/chart';
import { NoDataState } from '@/shared/ui/NoDataState';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const revenueConfig = { amount: { label: 'Encaissé (FCFA)', color: 'var(--chart-1)' } } satisfies ChartConfig;

export function AdminRevenuePage() {
  const providers = useProviders();
  const { account } = useAuth();
  const meta = useAdminMeta();
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [page, setPage] = useState(1);

  const totals = useAdminResource<RevenueTotals>('/api/admin/revenue/totals', { refreshMs: 60_000 });
  const series = useAdminResource<RevenueSeries>(`/api/admin/revenue?granularity=${granularity}`, { refreshMs: 60_000 });
  const payments = useAdminResource<PaymentList>(`/api/admin/payments?page=${page}&pageSize=15`);

  const canRecord = account?.permissions.includes('admin.payments.record') ?? false;
  const canUsers = account?.permissions.includes('admin.users.read') ?? false;
  const planLabels = Object.fromEntries((meta?.plans ?? []).map((plan) => [plan.id, plan.label]));
  const reloadAll = () => {
    void totals.reload();
    void series.reload();
    void payments.reload();
  };

  const t = totals.data;
  const monthChange = t ? changeRatio(t.month, t.previousMonth) : null;
  const points = series.data?.points.map((point) => ({ ...point, label: formatPeriod(point.period, granularity) })) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Revenus"
        description={`Abonnements encaissés, remboursements exclus.${meta ? ` Fuseau : ${meta.timezone}.` : ''}`}
        actions={canRecord && meta ? <RecordPaymentDialog plans={meta.plans} onDone={reloadAll} /> : undefined}
      />

      <Alert variant="info">
        <Info />
        <AlertTitle>{providers?.payments ? 'Paiements par carte enregistrés automatiquement' : 'Le paiement en ligne n’est pas encore branché'}</AlertTitle>
        <AlertDescription>
          {providers?.payments &&
            `Un palier payé par carte (Stripe${providers.paymentMode === 'test' ? ', mode test : aucun encaissement réel' : ''}) apparaît ici tout seul. `}
          Un abonnement réglé par Mobile Money, virement ou espèces s’enregistre ici : le montant compte dans les revenus et le palier du
          compte s’active pour la durée payée.
        </AlertDescription>
      </Alert>

      {totals.error && <AdminErrorAlert error={totals.error} onRetry={() => void totals.reload()} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {!t ? (
          Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className={index < 3 ? 'h-32 rounded-xl lg:col-span-2' : 'h-32 rounded-xl lg:col-span-3'} />
          ))
        ) : (
          <>
            <KpiCard label="Aujourd’hui" value={formatFcfa(t.today)} icon={CalendarDays} className="lg:col-span-2" />
            <KpiCard
              className="lg:col-span-2"
              label="Ce mois"
              value={formatFcfa(t.month)}
              icon={TrendingUp}
              tone="brand"
              hint={
                monthChange === null
                  ? `Mois précédent : ${formatFcfa(t.previousMonth)}`
                  : `${monthChange >= 0 ? '+' : ''}${monthChange} % sur le mois précédent`
              }
            />
            <KpiCard label="Cette année" value={formatFcfa(t.year)} icon={CalendarRange} className="lg:col-span-2" />
            <KpiCard
              label="Depuis l’ouverture"
              value={formatFcfa(t.total)}
              icon={Wallet}
              className="lg:col-span-3"
              hint={`${t.payments} paiement${t.payments > 1 ? 's' : ''} encaissé${t.payments > 1 ? 's' : ''}`}
            />
            <KpiCard
              className="lg:col-span-3"
              label="Revenu mensuel récurrent"
              value={formatFcfa(t.monthlyRecurring)}
              icon={Repeat}
              tone="success"
              hint={`${t.activeSubscribers} abonné${t.activeSubscribers > 1 ? 's' : ''} actif${t.activeSubscribers > 1 ? 's' : ''}`}
            />
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Encaissements</h2>
          </CardTitle>
          <CardDescription>
            {GRANULARITY_RANGE[granularity]} · {series.data ? formatFcfa(series.data.total) : '…'}
          </CardDescription>
          <CardAction>
            <GranularityToggle value={granularity} onChange={setGranularity} />
          </CardAction>
        </CardHeader>
        <CardContent>
          {series.error ? (
            <AdminErrorAlert error={series.error} onRetry={() => void series.reload()} />
          ) : !series.data ? (
            <Skeleton className="h-72 rounded-lg" />
          ) : (
            <>
              <ChartContainer config={revenueConfig} className="h-72 w-full">
                <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => compactNumber(value)} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="amount" fill="var(--color-amount)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
              <p className="sr-only">
                {points.map((point) => `${point.label} : ${formatFcfa(point.amount)}`).join(' ; ')}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Par palier</h2>
            </CardTitle>
            <CardDescription>{GRANULARITY_RANGE[granularity]}</CardDescription>
          </CardHeader>
          <CardContent>
            {!series.data || series.data.byPlan.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun encaissement sur la période.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Palier</TableHead>
                    <TableHead className="text-right">Paiements</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {series.data.byPlan.map((row) => (
                    <TableRow key={row.plan}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.payments}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatFcfa(row.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Par moyen de paiement</h2>
            </CardTitle>
            <CardDescription>{GRANULARITY_RANGE[granularity]}</CardDescription>
          </CardHeader>
          <CardContent>
            {!series.data || series.data.byMethod.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun encaissement sur la période.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Moyen</TableHead>
                    <TableHead className="text-right">Paiements</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {series.data.byMethod.map((row) => (
                    <TableRow key={row.method}>
                      <TableCell className="font-medium">{labelOf(PAYMENT_METHOD_LABELS, row.method)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.payments}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatFcfa(row.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <Banknote className="size-4 text-brand-green-text" aria-hidden="true" />
              Paiements enregistrés
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {payments.error ? (
            <AdminErrorAlert error={payments.error} onRetry={() => void payments.reload()} />
          ) : !payments.data ? (
            <Skeleton className="h-48" />
          ) : payments.data.payments.length === 0 ? (
            <NoDataState icon={Banknote} title="Aucun paiement pour l’instant" reason="Enregistrez le premier abonnement payé : il apparaîtra ici et dans les graphiques." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Compte</TableHead>
                    <TableHead>Palier</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Moyen</TableHead>
                    <TableHead>État</TableHead>
                    {canRecord && <TableHead className="sr-only">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.data.payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateFr(payment.paidAt)}</TableCell>
                      <TableCell className="max-w-56 truncate">
                        {canUsers && payment.userId ? (
                          <Link to={`/app/admin/utilisateurs/${payment.userId}`} className="hover:underline">
                            {payment.userEmail}
                          </Link>
                        ) : (
                          payment.userEmail
                        )}
                      </TableCell>
                      <TableCell>
                        {planLabels[payment.plan] ?? payment.plan}
                        <span className="block text-xs text-muted-foreground">{payment.periodMonths} mois</span>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatPaymentAmount(payment)}</TableCell>
                      <TableCell>
                        {labelOf(PAYMENT_METHOD_LABELS, payment.method)}
                        {payment.reference && <span className="block text-xs text-muted-foreground">{payment.reference}</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={payment.status === 'paid' ? 'success' : 'secondary'}>
                          {payment.status === 'paid' ? 'Encaissé' : 'Remboursé'}
                        </Badge>
                      </TableCell>
                      {canRecord && (
                        <TableCell className="text-right">
                          <RefundPaymentDialog payment={payment} onDone={reloadAll} />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={payments.data.page} pageSize={payments.data.pageSize} total={payments.data.total} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
