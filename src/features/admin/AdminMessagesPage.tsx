import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Archive, Inbox, Mail, MailOpen, RotateCcw } from 'lucide-react';
import { type ContactMessagePage, useAdminResource } from '@/features/admin/adminApi';
import { AdminErrorAlert, KpiCard, Pagination } from '@/features/admin/components';
import { formatClock } from '@/features/admin/format';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { NoDataState } from '@/shared/ui/NoDataState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';

/** Messages reçus par la page Contact : lecture, archivage, réponse par e-mail. Conservés 12 mois. */

const PAGE_SIZE = 20;

const FILTERS = [
  { value: 'new', label: 'Non lus' },
  { value: 'read', label: 'Lus' },
  { value: 'archived', label: 'Archivés' },
  { value: 'all', label: 'Tous les messages' },
] as const;

type Status = 'new' | 'read' | 'archived';

export function AdminMessagesPage() {
  const [params, setParams] = useSearchParams();
  const filter = params.get('statut') ?? 'new';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [busyId, setBusyId] = useState<string | null>(null);

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filter !== 'all') query.set('status', filter);
  const { data, error, loading, reload } = useAdminResource<ContactMessagePage>(`/api/admin/messages?${query.toString()}`, { refreshMs: 60_000 });

  const setParam = (key: string, value: string | null) =>
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

  const setStatus = async (id: string, status: Status) => {
    setBusyId(id);
    try {
      await apiRequest(`/api/admin/messages/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status } });
      await reload();
    } catch (caught) {
      toast.error('Le message n’a pas pu être mis à jour', { description: toApiError(caught, 'Réessayez dans un moment.').message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Messages"
        description="Messages envoyés depuis la page Contact. Répondez par e-mail, puis archivez-les. Ils sont effacés au bout de 12 mois."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {!data ? (
          Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)
        ) : (
          <>
            <KpiCard label="Non lus" value={data.counts.new} icon={Mail} tone={data.counts.new > 0 ? 'warning' : 'default'} />
            <KpiCard label="Lus" value={data.counts.read} icon={MailOpen} />
            <KpiCard label="Archivés" value={data.counts.archived} icon={Archive} />
          </>
        )}
      </div>

      <Select value={filter} onValueChange={(value) => setParam('statut', value === 'new' ? null : value)}>
        <SelectTrigger className="w-full sm:w-56" aria-label="Filtrer les messages">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FILTERS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error && <AdminErrorAlert error={error} onRetry={() => void reload()} />}

      {!data && loading ? (
        <div className="space-y-3" role="status" aria-label="Chargement des messages">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : data && data.entries.length === 0 ? (
        <NoDataState
          icon={Inbox}
          title={filter === 'new' ? 'Aucun message non lu' : 'Aucun message'}
          reason="Les messages envoyés depuis la page Contact apparaissent ici."
        />
      ) : data ? (
        <div className="space-y-3">
          {data.entries.map((entry) => (
            <Card key={entry.id} className="py-4">
              <CardContent className="space-y-3 px-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-semibold">
                      {entry.userId ? (
                        <Link to={`/app/admin/utilisateurs/${entry.userId}`} className="hover:underline">
                          {entry.name}
                        </Link>
                      ) : (
                        entry.name
                      )}
                    </p>
                    <a
                      href={`mailto:${entry.email}?subject=${encodeURIComponent('Votre message à Smart Creator')}`}
                      className="break-all text-sm text-muted-foreground underline-offset-4 hover:underline"
                    >
                      {entry.email}
                    </a>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{entry.topicLabel}</Badge>
                    {entry.status === 'new' && <Badge variant="warning">Non lu</Badge>}
                    <span className="text-xs text-muted-foreground tabular-nums">{formatClock(entry.createdAt)}</span>
                  </div>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{entry.message}</p>
                <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                  {busyId === entry.id && <Spinner className="self-center" />}
                  {entry.status === 'new' && (
                    <Button variant="outline" size="sm" disabled={busyId !== null} onClick={() => void setStatus(entry.id, 'read')}>
                      <MailOpen />
                      Marquer comme lu
                    </Button>
                  )}
                  {entry.status !== 'archived' ? (
                    <Button variant="ghost" size="sm" disabled={busyId !== null} onClick={() => void setStatus(entry.id, 'archived')}>
                      <Archive />
                      Archiver
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" disabled={busyId !== null} onClick={() => void setStatus(entry.id, 'new')}>
                      <RotateCcw />
                      Remettre en non lu
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(next) => setParam('page', String(next))} />
        </div>
      ) : null}
    </div>
  );
}
