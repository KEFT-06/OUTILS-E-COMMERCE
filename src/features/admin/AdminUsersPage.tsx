import { CountryFlag } from '@/shared/components/CountryFlag';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, ShieldCheck } from 'lucide-react';
import { type UserList, useAdminMeta, useAdminResource } from '@/features/admin/adminApi';
import { CreateUserDialog } from '@/features/admin/AdminDialogs';
import { AdminErrorAlert, Pagination, PresenceLabel } from '@/features/admin/components';
import { initialsOf, useAuth } from '@/features/auth/AuthContext';
import { PageHeader } from '@/shared/components/PageHeader';
import { formatDateFr } from '@/shared/lib/formatDate';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { NoDataState } from '@/shared/ui/NoDataState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Switch } from '@/shared/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const PAGE_SIZE = 20;

const SORTS = [
  { value: 'created_desc', label: 'Plus récents' },
  { value: 'last_seen_desc', label: 'Dernière activité' },
  { value: 'credits_desc', label: 'Solde de points' },
  { value: 'name_asc', label: 'Nom (A → Z)' },
  { value: 'created_asc', label: 'Plus anciens' },
];

export function AdminUsersPage() {
  const { account } = useAuth();
  const meta = useAdminMeta();
  const [params, setParams] = useSearchParams();

  const search = params.get('q') ?? '';
  const plan = params.get('palier') ?? 'all';
  const status = params.get('statut') ?? 'all';
  const role = params.get('role') ?? 'all';
  const online = params.get('en-ligne') === '1';
  const sort = params.get('tri') ?? 'created_desc';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const [draft, setDraft] = useState(search);

  const setParam = (key: string, value: string | null) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === null || value === '' || value === 'all') next.delete(key);
        else next.set(key, value);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (draft.trim() !== search) setParam('q', draft.trim() || null);
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort });
  if (search) query.set('search', search);
  if (plan !== 'all') query.set('plan', plan);
  if (status !== 'all') query.set('status', status);
  if (role !== 'all') query.set('role', role);
  if (online) query.set('online', 'true');

  const { data, error, loading, reload } = useAdminResource<UserList>(`/api/admin/users?${query.toString()}`, { refreshMs: 60_000 });
  const canManage = account?.permissions.includes('admin.users.manage') ?? false;
  const unlimitedPlans = new Set((meta?.plans ?? []).filter((candidate) => candidate.monthlyCredits === null).map((candidate) => candidate.id));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Utilisateurs"
        description="Tous les comptes enregistrés en base : palier, solde de points, présence et privilèges."
        actions={canManage && meta ? <CreateUserDialog plans={meta.plans} onCreated={() => void reload()} /> : undefined}
      />

      <Card className="py-4">
        <CardContent className="flex flex-col gap-3 px-4 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="relative min-w-0 flex-1 lg:min-w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Rechercher un nom ou une adresse e-mail"
              aria-label="Rechercher un compte"
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Select value={plan} onValueChange={(value) => setParam('palier', value)}>
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Palier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les paliers</SelectItem>
                {(meta?.plans ?? []).map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => setParam('statut', value)}>
              <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Statut">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                <SelectItem value="active">Actifs</SelectItem>
                <SelectItem value="suspended">Suspendus</SelectItem>
              </SelectContent>
            </Select>
            <Select value={role} onValueChange={(value) => setParam('role', value)}>
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Rôle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les rôles</SelectItem>
                <SelectItem value="user">Utilisateurs</SelectItem>
                <SelectItem value="staff">Équipe (privilèges)</SelectItem>
                <SelectItem value="admin">Administrateurs</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => setParam('tri', value === 'created_desc' ? null : value)}>
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Trier par">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="filter-online" checked={online} onCheckedChange={(checked) => setParam('en-ligne', checked ? '1' : null)} />
            <Label htmlFor="filter-online" className="text-sm font-normal whitespace-nowrap">
              En ligne uniquement
            </Label>
          </div>
        </CardContent>
      </Card>

      {error && <AdminErrorAlert error={error} onRetry={() => void reload()} />}

      <Card className="py-2">
        <CardContent className="px-2 sm:px-4">
          {!data && loading ? (
            <div className="space-y-2 p-2" role="status" aria-label="Chargement des comptes">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-12" />
              ))}
            </div>
          ) : data && data.users.length === 0 ? (
            <NoDataState icon={Search} title="Aucun compte ne correspond" reason="Modifiez la recherche ou retirez des filtres." className="m-2" />
          ) : data ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Compte</TableHead>
                    <TableHead>Palier</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead>Activité</TableHead>
                    <TableHead className="text-right">Contenus</TableHead>
                    <TableHead>Inscription</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-9 rounded-lg">
                            <AvatarFallback className="rounded-lg bg-accent text-xs font-semibold text-accent-foreground">
                              {initialsOf(user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <Link to={`/app/admin/utilisateurs/${user.id}`} className="flex items-center gap-1.5 font-medium hover:underline">
                              <span className="truncate">{user.name}</span>
                              {user.twoFactorEnabled && (
                                <ShieldCheck className="size-3.5 shrink-0 text-success" aria-label="Double authentification activée" />
                              )}
                            </Link>
                            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                              {user.country && <CountryFlag code={user.country} />}
                              <span className="truncate">{user.email}</span>
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={user.plan.id === 'free' ? 'secondary' : 'brand'}>{user.plan.label}</Badge>
                          {user.role === 'admin' ? (
                            <Badge variant="info">Admin</Badge>
                          ) : user.isStaff ? (
                            <Badge variant="outline">Équipe</Badge>
                          ) : null}
                          {user.status === 'suspended' && <Badge variant="danger">Suspendu</Badge>}
                        </div>
                        {user.planExpiresAt && (
                          <span className="mt-1 block text-xs text-muted-foreground">jusqu’au {formatDateFr(user.planExpiresAt)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="font-semibold">{unlimitedPlans.has(user.plan.id) ? '∞' : user.credits.total}</span>
                        {user.credits.bonus > 0 && <span className="block text-xs text-muted-foreground">dont {user.credits.bonus} bonus</span>}
                      </TableCell>
                      <TableCell>
                        <PresenceLabel online={user.online} lastSeenAt={user.lastSeenAt} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{user.generations}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{formatDateFr(user.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="px-2 pb-2">
                <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(next) => setParam('page', String(next))} />
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
