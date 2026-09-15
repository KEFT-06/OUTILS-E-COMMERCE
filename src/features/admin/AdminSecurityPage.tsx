import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Lock, LockOpen, ShieldCheck, Smartphone, Timer } from 'lucide-react';
import {
  type AuditPage,
  type SecurityEventPage,
  type ThrottleEntry,
  useAdminMeta,
  useAdminResource,
} from '@/features/admin/adminApi';
import { AdminErrorAlert, Pagination } from '@/features/admin/components';
import { describeAuditDetails } from '@/features/admin/format';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { formatDateFr, formatRelativeFr } from '@/shared/lib/formatDate';
import { AUDIT_ACTION_LABELS, labelOf } from '@/shared/lib/labels';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { NoDataState } from '@/shared/ui/NoDataState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';

const EVENT_TONES: Record<string, 'danger' | 'warning' | 'success' | 'secondary'> = {
  login_failure: 'danger',
  mfa_failure: 'danger',
  login_locked: 'warning',
  login_suspended: 'warning',
  recovery_code_used: 'warning',
  login_success: 'success',
  mfa_enabled: 'success',
  password_changed: 'success',
  password_reset: 'success',
};

const RULES = [
  {
    icon: Lock,
    title: 'Par adresse e-mail',
    text: '5 échecs : verrou de 15 min, puis 1 h, puis 24 h. Même le bon mot de passe est refusé pendant le verrou, et une adresse inconnue reçoit exactement la même réponse.',
  },
  {
    icon: Timer,
    title: 'Par adresse IP',
    text: '50 échecs : verrou de 15 min, puis 1 h, puis 6 h. Seuil volontairement haut : les opérateurs mobiles partagent une même adresse entre de nombreux abonnés.',
  },
  {
    icon: Smartphone,
    title: 'Administration',
    text: 'Double authentification obligatoire, sessions de 12 h au plus et 2 h d’inactivité, code frais exigé pour changer un rôle ou des privilèges.',
  },
];

export function AdminSecurityPage() {
  const { account } = useAuth();
  const meta = useAdminMeta();
  const [type, setType] = useState('all');
  const [eventsPage, setEventsPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [unlocking, setUnlocking] = useState<string | null>(null);

  const events = useAdminResource<SecurityEventPage>(
    `/api/admin/security/events?page=${eventsPage}&pageSize=25${type !== 'all' ? `&type=${type}` : ''}`,
    { refreshMs: 30_000 },
  );
  const locks = useAdminResource<{ entries: ThrottleEntry[] }>('/api/admin/security/locks', { refreshMs: 30_000 });
  const audit = useAdminResource<AuditPage>(`/api/admin/audit?page=${auditPage}&pageSize=25`);

  const canManage = account?.permissions.includes('admin.users.manage') ?? false;
  const canUsers = account?.permissions.includes('admin.users.read') ?? false;
  const planLabels = Object.fromEntries((meta?.plans ?? []).map((plan) => [plan.id, plan.label]));
  const permissionLabels = Object.fromEntries((meta?.permissions ?? []).map((permission) => [permission.id, permission.label]));
  const activeLocks = locks.data?.entries.filter((entry) => entry.lockedUntil).length ?? 0;

  const unlock = async (key: string) => {
    setUnlocking(key);
    try {
      await apiRequest('/api/admin/security/unlock', { method: 'POST', body: { key } });
      toast.success('Verrou levé');
      await locks.reload();
    } catch (caught) {
      toast.error('Verrou non levé', { description: toApiError(caught, 'Erreur inconnue.').message });
    } finally {
      setUnlocking(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Sécurité"
        description="Tentatives de connexion, verrous anti-force brute et journal des actions de l’équipe."
      />

      <div className="grid gap-4 md:grid-cols-3">
        {RULES.map(({ icon: Icon, title, text }) => (
          <Card key={title} className="gap-3 py-5">
            <CardContent className="space-y-2 px-5">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="size-4 text-brand-green-text" aria-hidden="true" />
                {title}
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="connexions" className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            <TabsTrigger value="connexions">Connexions</TabsTrigger>
            <TabsTrigger value="verrous">Verrous{activeLocks > 0 ? ` (${activeLocks})` : ''}</TabsTrigger>
            <TabsTrigger value="journal">Journal d’audit</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="connexions">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Événements de connexion</h2>
              </CardTitle>
              <CardDescription>Actualisés toutes les 30 secondes. Adresses IP tronquées.</CardDescription>
              <CardAction>
                <Select
                  value={type}
                  onValueChange={(value) => {
                    setType(value);
                    setEventsPage(1);
                  }}
                >
                  <SelectTrigger size="sm" className="w-52" aria-label="Type d’événement">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les événements</SelectItem>
                    {(meta?.authEventTypes ?? []).map((eventType) => (
                      <SelectItem key={eventType.id} value={eventType.id}>
                        {eventType.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardAction>
            </CardHeader>
            <CardContent>
              {events.error ? (
                <AdminErrorAlert error={events.error} onRetry={() => void events.reload()} />
              ) : !events.data ? (
                <Skeleton className="h-64" />
              ) : events.data.events.length === 0 ? (
                <NoDataState icon={ShieldCheck} title="Aucun événement" reason="Rien ne correspond à ce filtre." />
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quand</TableHead>
                        <TableHead>Événement</TableHead>
                        <TableHead>Compte</TableHead>
                        <TableHead>Appareil</TableHead>
                        <TableHead>IP</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.data.events.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDateFr(event.createdAt, true)}>
                            {formatRelativeFr(event.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={EVENT_TONES[event.type] ?? 'secondary'}>{event.label}</Badge>
                          </TableCell>
                          <TableCell className="max-w-56 truncate">
                            {canUsers && event.userId ? (
                              <Link to={`/app/admin/utilisateurs/${event.userId}`} className="hover:underline">
                                {event.email}
                              </Link>
                            ) : (
                              (event.email ?? '—')
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{event.device}</TableCell>
                          <TableCell className="text-sm text-muted-foreground tabular-nums">{event.ip ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pagination page={events.data.page} pageSize={events.data.pageSize} total={events.data.total} onPageChange={setEventsPage} />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="verrous">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Compteurs d’échecs</h2>
              </CardTitle>
              <CardDescription>
                Échecs des dernières 24 h et verrous en cours. Lever un verrou ne dit pas si le mot de passe était bon : vérifiez d’abord
                auprès de la personne.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {locks.error ? (
                <AdminErrorAlert error={locks.error} onRetry={() => void locks.reload()} />
              ) : !locks.data ? (
                <Skeleton className="h-40" />
              ) : locks.data.entries.length === 0 ? (
                <NoDataState icon={ShieldCheck} title="Aucun échec récent" reason="Aucune tentative de connexion ratée ces dernières 24 heures." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cible</TableHead>
                      <TableHead className="text-right">Échecs</TableHead>
                      <TableHead>État</TableHead>
                      <TableHead>Dernier échec</TableHead>
                      {canManage && <TableHead className="sr-only">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locks.data.entries.map((entry) => (
                      <TableRow key={entry.key}>
                        <TableCell className="max-w-64 truncate">
                          <span className="text-xs text-muted-foreground">{entry.kind === 'ip' ? 'Adresse IP' : 'Adresse e-mail'}</span>
                          <span className="block font-medium">{entry.subject}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{entry.failures}</TableCell>
                        <TableCell>
                          {entry.lockedUntil ? (
                            <Badge variant="danger">Verrouillé jusqu’à {new Date(entry.lockedUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</Badge>
                          ) : (
                            <Badge variant="secondary">Surveillé</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{formatRelativeFr(entry.lastFailureAt)}</TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => void unlock(entry.key)} disabled={unlocking === entry.key}>
                              {unlocking === entry.key ? <Spinner /> : <LockOpen />}
                              Remettre à zéro
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="journal">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Journal d’audit</h2>
              </CardTitle>
              <CardDescription>Qui a changé quoi, et quand. Aucune ligne ne peut être effacée depuis l’application.</CardDescription>
            </CardHeader>
            <CardContent>
              {audit.error ? (
                <AdminErrorAlert error={audit.error} onRetry={() => void audit.reload()} />
              ) : !audit.data ? (
                <Skeleton className="h-64" />
              ) : audit.data.entries.length === 0 ? (
                <NoDataState title="Journal vide" reason="Les actions de l’équipe d’administration apparaîtront ici." />
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Compte visé</TableHead>
                        <TableHead>Par</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {audit.data.entries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateFr(entry.createdAt, true)}</TableCell>
                          <TableCell className="max-w-80 whitespace-normal">
                            <span className="font-medium">{labelOf(AUDIT_ACTION_LABELS, entry.action)}</span>
                            <span className="block text-xs text-muted-foreground">
                              {describeAuditDetails(entry.action, entry.details, { plans: planLabels, permissions: permissionLabels })}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-56 truncate">
                            {canUsers && entry.targetUserId ? (
                              <Link to={`/app/admin/utilisateurs/${entry.targetUserId}`} className="hover:underline">
                                {entry.targetEmail}
                              </Link>
                            ) : (
                              (entry.targetEmail ?? '—')
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{entry.actorEmail}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pagination page={audit.data.page} pageSize={audit.data.pageSize} total={audit.data.total} onPageChange={setAuditPage} />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
