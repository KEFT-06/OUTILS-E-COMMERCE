import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, History, LogIn, Search, Timer, Wifi, X } from 'lucide-react';
import { type ConnectionEntry, type ConnectionPage, useAdminResource } from '@/features/admin/adminApi';
import { AdminErrorAlert, KpiCard, Pagination } from '@/features/admin/components';
import { formatClock, formatDuration } from '@/features/admin/format';
import { CountryFlag } from '@/shared/components/CountryFlag';
import { PageHeader } from '@/shared/components/PageHeader';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { NoDataState } from '@/shared/ui/NoDataState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

/**
 * Historique des connexions : qui s'est connecté, quand, et quand il est parti.
 *
 * Un site ne voit pas un onglet se fermer : sans déconnexion volontaire, l'heure
 * de départ retenue est celle de la dernière activité. Les heures s'affichent
 * dans le fuseau de l'appareil qui consulte.
 */

const PAGE_SIZE = 25;

const STATES = [
  { value: 'all', label: 'Toutes les connexions' },
  { value: 'open', label: 'Sessions ouvertes' },
  { value: 'closed', label: 'Déconnectées' },
];

function EndCell({ entry }: { entry: ConnectionEntry }) {
  if (entry.online) return <Badge variant="success">En ligne</Badge>;
  if (entry.open) {
    return (
      <div>
        <span className="text-sm">Session ouverte</span>
        <span className="block text-xs text-muted-foreground">dernière activité {formatClock(entry.lastSeenAt).toLowerCase()}</span>
      </div>
    );
  }
  return (
    <div>
      <span className="text-sm tabular-nums">{formatClock(entry.endedAt!)}</span>
      <span className="block text-xs text-muted-foreground">{entry.endLabel}</span>
    </div>
  );
}

type Row = ConnectionEntry & { user?: { id: string; name: string; email: string; country: string | null } };

export function ConnectionTable({ entries, showUser }: { entries: Row[]; showUser: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showUser && <TableHead>Utilisateur</TableHead>}
          <TableHead>Connexion</TableHead>
          <TableHead>Déconnexion</TableHead>
          <TableHead className="text-right">Durée</TableHead>
          <TableHead>Appareil</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            {showUser && (
              <TableCell>
                {entry.user && (
                  <div className="min-w-0">
                    <Link to={`/app/admin/utilisateurs/${entry.user.id}`} className="font-medium hover:underline">
                      {entry.user.name}
                    </Link>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {entry.user.country && <CountryFlag code={entry.user.country} />}
                      <span className="truncate">{entry.user.email}</span>
                    </span>
                  </div>
                )}
              </TableCell>
            )}
            <TableCell className="text-sm whitespace-nowrap tabular-nums">{formatClock(entry.startedAt)}</TableCell>
            <TableCell className="whitespace-nowrap">
              <EndCell entry={entry} />
            </TableCell>
            <TableCell className="text-right text-sm whitespace-nowrap tabular-nums">{formatDuration(entry.durationSeconds)}</TableCell>
            <TableCell>
              <span className="text-sm whitespace-nowrap">{entry.device}</span>
              <span className="block text-xs text-muted-foreground">{entry.ip ?? 'IP inconnue'}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function AdminConnectionsPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const state = params.get('etat') ?? 'all';
  const userId = params.get('utilisateur');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draft, setDraft] = useState(search);

  const setParam = (key: string, value: string | null) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === null) next.delete(key);
        else next.set(key, value);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  useEffect(() => setDraft(search), [search]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (draft.trim() !== search) setParam('q', draft.trim() || null);
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) query.set('search', search);
  if (state !== 'all') query.set('state', state);
  if (userId) query.set('userId', userId);

  const { data, error, loading, reload } = useAdminResource<ConnectionPage>(`/api/admin/connections?${query.toString()}`, {
    refreshMs: 30_000,
  });
  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Connexions"
        description="Heure de connexion et de déconnexion de chaque utilisateur, durée et appareil. Sans déconnexion volontaire (onglet fermé), l’heure retenue est celle de la dernière activité. Heures de cet appareil."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!summary ? (
          Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)
        ) : (
          <>
            <KpiCard label="En ligne maintenant" value={summary.online} icon={Wifi} tone="success" hint="Activité des 5 dernières minutes" />
            <KpiCard
              label="Actifs aujourd’hui"
              value={summary.activeToday}
              icon={LogIn}
              hint={`${summary.connectionsToday} connexion${summary.connectionsToday > 1 ? 's' : ''} ouverte${summary.connectionsToday > 1 ? 's' : ''} aujourd’hui`}
            />
            <KpiCard label="Actifs sur 7 jours" value={summary.active7d} icon={CalendarDays} hint={`${summary.active30d} sur 30 jours`} />
            <KpiCard
              label="Durée moyenne"
              value={summary.averageSeconds > 0 ? formatDuration(summary.averageSeconds) : '—'}
              icon={Timer}
              hint="Par connexion terminée, sur 30 jours"
            />
          </>
        )}
      </div>

      <Card className="py-4">
        <CardContent className="flex flex-col gap-3 px-4 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Nom ou adresse e-mail"
              aria-label="Rechercher un utilisateur"
              className="pl-9"
            />
          </div>
          <Select value={state} onValueChange={(value) => setParam('etat', value === 'all' ? null : value)}>
            <SelectTrigger className="w-full md:w-56" aria-label="Filtrer les connexions">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data?.filterUser && (
            <Badge variant="secondary" className="h-9 gap-1 self-start px-3 text-sm md:self-auto">
              {data.filterUser.name}
              <button
                type="button"
                className="-mr-1 rounded-full p-0.5 hover:bg-background"
                onClick={() => setParam('utilisateur', null)}
                aria-label={`Retirer le filtre ${data.filterUser.name}`}
              >
                <X className="size-3.5" />
              </button>
            </Badge>
          )}
        </CardContent>
      </Card>

      {error && <AdminErrorAlert error={error} onRetry={() => void reload()} />}

      <Card className="py-2">
        <CardContent className="px-2 sm:px-4">
          {!data && loading ? (
            <div className="space-y-2 p-2" role="status" aria-label="Chargement des connexions">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-12" />
              ))}
            </div>
          ) : data && data.entries.length === 0 ? (
            <NoDataState
              icon={History}
              title="Aucune connexion"
              reason={search || userId || state !== 'all' ? 'Modifiez la recherche ou retirez des filtres.' : 'Les connexions apparaîtront ici dès la première.'}
              className="m-2"
            />
          ) : data ? (
            <>
              <ConnectionTable entries={data.entries} showUser={!userId} />
              <div className="px-2 pb-2">
                <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(next) => setParam('page', String(next))} />
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {userId && (
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to={`/app/admin/utilisateurs/${userId}`}>Ouvrir la fiche de l’utilisateur</Link>
        </Button>
      )}
    </div>
  );
}
