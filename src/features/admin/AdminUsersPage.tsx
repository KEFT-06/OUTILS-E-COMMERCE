import { CountryFlag } from '@/shared/components/CountryFlag';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, Coins, Layers, LogOut, MoreHorizontal, Search, ShieldCheck, Trash2, UserRound, UserRoundCheck } from 'lucide-react';
import { type UserList, useAdminMeta, useAdminResource } from '@/features/admin/adminApi';
import { CreateUserDialog } from '@/features/admin/AdminDialogs';
import { AdminErrorAlert, Pagination, PresenceLabel } from '@/features/admin/components';
import { type UserAction, userActionHref, userActionsFor } from '@/features/admin/userActions';
import { initialsOf, useAuth } from '@/features/auth/AuthContext';
import { PageHeader } from '@/shared/components/PageHeader';
import { formatDateFr, formatShortDateFr } from '@/shared/lib/formatDate';
import { formatPhone } from '@server/shared/phone';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { NoDataState } from '@/shared/components/NoDataState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Switch } from '@/shared/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const PAGE_SIZE = 20;

/** Colonne « Compte » figée à gauche, sur le fond de la carte (et de la ligne survolée). */
// Plus étroite sur téléphone, sans avatar : la colonne figée y laisse la place de faire défiler les autres.
const COLONNE_COMPTE = 'sticky left-0 z-10 w-40 min-w-40 max-w-40 bg-card group-hover:bg-muted shadow-[1px_0_0_var(--border)] sm:w-64 sm:min-w-56 sm:max-w-72';

type ListedUser = UserList['users'][number];

/**
 * Le menu « ⋯ » d'une ligne : chaque action mène à la fiche du compte, sa fenêtre déjà ouverte.
 * Le 18/10/2026, le propriétaire cherchait « Bloquer » et « Supprimer » dans cette liste, où rien ne
 * les montrait ni ne disait qu'il fallait ouvrir la fiche.
 */
function UserRowMenu({ user, actions }: { user: ListedUser; actions: UserAction[] }) {
  const suspended = user.status === 'suspended';
  const entries: { action: UserAction; label: string; icon: typeof Coins; destructive?: boolean }[] = [
    { action: 'points', label: 'Recharger des points', icon: Coins },
    { action: 'palier', label: 'Changer le palier', icon: Layers },
    { action: 'deconnecter', label: 'Déconnecter partout', icon: LogOut },
    { action: 'bloquer', label: suspended ? 'Débloquer' : 'Bloquer', icon: suspended ? UserRoundCheck : Ban },
    { action: 'supprimer', label: 'Supprimer le compte', icon: Trash2, destructive: true },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="ml-auto size-8 shrink-0" aria-label={`Actions sur le compte de ${user.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link to={`/app/admin/utilisateurs/${user.id}`}>
            <UserRound />
            Ouvrir la fiche
          </Link>
        </DropdownMenuItem>
        {actions.length > 0 && <DropdownMenuSeparator />}
        {entries
          .filter((entry) => actions.includes(entry.action))
          .map((entry) => {
            const Icon = entry.icon;
            return (
              <DropdownMenuItem key={entry.action} variant={entry.destructive ? 'destructive' : 'default'} asChild>
                <Link to={userActionHref(user.id, entry.action)}>
                  <Icon />
                  {entry.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
        description="Tous les comptes enregistrés en base : palier, solde de points, présence et privilèges. Le bouton ⋯ d’une ligne recharge les points, change le palier, bloque ou supprime le compte."
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
                <SelectItem value="suspended">Bloqués</SelectItem>
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
                    {/*
                      Colonne figée : le tableau défile à l'horizontale sur les écrans étroits, et le
                      18/10/2026 le propriétaire ne voyait plus que des « ⋯ » sans le nom de leur compte.
                    */}
                    <TableHead className={COLONNE_COMPTE}>Compte</TableHead>
                    <TableHead>Téléphone</TableHead>
                    <TableHead>Palier</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead>Activité</TableHead>
                    <TableHead className="text-right">Contenus</TableHead>
                    <TableHead>Inscription</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.users.map((user) => (
                    <TableRow key={user.id} className="group">
                      <TableCell className={COLONNE_COMPTE}>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-9 rounded-lg max-sm:hidden">
                            <AvatarFallback className="rounded-lg bg-accent text-xs font-semibold text-accent-foreground">
                              {initialsOf(user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
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
                          {account && <UserRowMenu user={user} actions={userActionsFor(account, user)} />}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {user.phone ? (
                          <a href={`tel:${user.phone}`} className="hover:underline">
                            {formatPhone(user.phone, user.country)}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={user.plan.id === 'free' ? 'secondary' : 'brand'}>{user.plan.label}</Badge>
                          {user.role === 'admin' ? (
                            <Badge variant="info">Admin</Badge>
                          ) : user.isStaff ? (
                            <Badge variant="outline">Équipe</Badge>
                          ) : null}
                          {user.status === 'suspended' && <Badge variant="danger">Bloqué</Badge>}
                        </div>
                        {user.planExpiresAt && (
                          <span className="mt-1 block text-xs whitespace-nowrap text-muted-foreground" title={`jusqu’au ${formatDateFr(user.planExpiresAt)}`}>
                            jusqu’au {formatShortDateFr(user.planExpiresAt)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="font-semibold">{unlimitedPlans.has(user.plan.id) ? '∞' : user.credits.total}</span>
                        {user.credits.bonus > 0 && <span className="block text-xs text-muted-foreground">dont {user.credits.bonus} bonus</span>}
                        <span className="block text-xs whitespace-nowrap text-muted-foreground">{user.creditsUsed30d} utilisé{user.creditsUsed30d > 1 ? 's' : ''} sur 30 j</span>
                      </TableCell>
                      <TableCell>
                        <PresenceLabel online={user.online} lastSeenAt={user.lastSeenAt} compact />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{user.generations}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap text-muted-foreground" title={formatDateFr(user.createdAt)}>
                        {formatShortDateFr(user.createdAt)}
                      </TableCell>
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
