import { useState } from 'react';
import { CheckCircle2, CircleSlash, Copy, RefreshCw, TriangleAlert, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAdminResource } from '@/features/admin/adminApi';
import { AdminErrorAlert } from '@/features/admin/components';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { formatRelativeFr } from '@/shared/lib/formatDate';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';

/**
 * État des services : chaque IA et chaque service branché, vérifié en direct par le serveur
 * (clé acceptée, crédits, adresse IP à autoriser), avec ce qu'il faut faire quand ça ne va pas.
 */

type ServiceState = 'ok' | 'warning' | 'error' | 'off';

interface ServicesReport {
  checkedAt: string;
  serverIp: string | null;
  services: { id: string; name: string; role: string; state: ServiceState; detail: string; action: string | null }[];
}

const STATES: Record<ServiceState, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary'; icon: typeof CheckCircle2 }> =
  {
    ok: { label: 'Opérationnel', variant: 'success', icon: CheckCircle2 },
    warning: { label: 'À surveiller', variant: 'warning', icon: TriangleAlert },
    error: { label: 'À corriger', variant: 'danger', icon: XCircle },
    off: { label: 'Non branché', variant: 'secondary', icon: CircleSlash },
  };

const ORDER: ServiceState[] = ['error', 'warning', 'off', 'ok'];

export function AdminServicesPage() {
  const report = useAdminResource<ServicesReport>('/api/admin/services');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      report.setData(await apiRequest<ServicesReport>('/api/admin/services?refresh=1'));
      toast.success('Services revérifiés');
    } catch (caught) {
      toast.error('Vérification impossible', { description: toApiError(caught, 'Réessayez dans un instant.').message });
    } finally {
      setRefreshing(false);
    }
  };

  const copyIp = async (ip: string) => {
    try {
      await navigator.clipboard.writeText(ip);
      toast.success('Adresse IP copiée');
    } catch {
      toast.info(`Adresse IP : ${ip}`);
    }
  };

  const data = report.data;
  const counts = data ? ORDER.map((state) => [state, data.services.filter((service) => service.state === state).length] as const) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="État des services"
        description="Chaque IA et chaque service du site, vérifié en direct par le serveur, sans rien consommer : clé acceptée, crédits, et ce qu’il reste à faire."
        actions={
          <Button onClick={() => void refresh()} disabled={refreshing || report.loading}>
            {refreshing ? <Spinner /> : <RefreshCw />}
            Revérifier maintenant
          </Button>
        }
      />

      {report.error && <AdminErrorAlert error={report.error} onRetry={() => void report.reload()} />}

      {!data && report.loading && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-32 w-full" />
          ))}
        </div>
      )}

      {data && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex flex-wrap gap-2">
                {counts.map(([state, count]) => (
                  <Badge key={state} variant={STATES[state].variant}>
                    {count} {STATES[state].label.toLowerCase()}
                  </Badge>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">Vérifié {formatRelativeFr(data.checkedAt)}</p>
              {data.serverIp && (
                <p className="flex items-center gap-2 text-sm sm:ml-auto">
                  Adresse IP du serveur : <span className="font-mono font-semibold">{data.serverIp}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => void copyIp(data.serverIp!)}
                    aria-label="Copier l’adresse IP"
                  >
                    <Copy />
                  </Button>
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {[...data.services]
              .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state))
              .map((service) => {
                const state = STATES[service.state];
                const Icon = state.icon;
                return (
                  <Card key={service.id} className="gap-3">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Icon
                              className={`size-4 shrink-0 ${service.state === 'ok' ? 'text-success' : service.state === 'error' ? 'text-danger' : service.state === 'warning' ? 'text-warning' : 'text-muted-foreground'}`}
                              aria-hidden="true"
                            />
                            {service.name}
                          </CardTitle>
                          <CardDescription>{service.role}</CardDescription>
                        </div>
                        <Badge variant={state.variant} className="shrink-0">
                          {state.label}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p>{service.detail}</p>
                      {service.action && (
                        <p className="rounded-md border bg-muted/40 p-2.5 text-muted-foreground">
                          <span className="font-medium text-foreground">À faire : </span>
                          {service.action}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}
