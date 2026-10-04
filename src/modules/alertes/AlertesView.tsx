import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Eye, Flame, PenSquare, Radar, Rocket, TriangleAlert, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { followableOnRadar } from '@server/shared/storefronts';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { formatRelativeFr } from '@/shared/lib/formatDate';
import { useUserCurrency } from '@/shared/lib/money';
import { cn } from '@/shared/lib/utils';
import { resetAlertsUnread } from '@/shared/stores/useAlertsUnread';
import { blankProduct, useCustomProducts } from '@/shared/stores/useCustomProducts';
import type { AlertItem, AlertLevel } from '@/shared/types/radar';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/shared/ui/empty';
import { Skeleton } from '@/shared/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group';

/**
 * Alertes : ce que le marché a fait pendant que personne ne regardait.
 *
 * Trois niveaux, du plus pressant au plus général : un concurrent qui coupe une publicité
 * installée, un produit qui décolle dès son lancement, une niche où plusieurs boutiques lancent
 * la même chose. Chaque carte mène directement au geste suivant.
 */

const NIVEAUX: Record<AlertLevel, { label: string; icon: LucideIcon; bord: string; ton: string }> = {
  major: { label: 'Mouvement d’un concurrent', icon: TriangleAlert, bord: 'border-l-red-500', ton: 'text-red-600 dark:text-red-400' },
  opportunity: { label: 'Opportunité produit', icon: Rocket, bord: 'border-l-amber-500', ton: 'text-amber-600 dark:text-amber-500' },
  info: { label: 'Tendance du marché', icon: Flame, bord: 'border-l-brand-green', ton: 'text-brand-green-text' },
};

type Filtre = 'tout' | AlertLevel;

const texte = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

function AlertCard({ alert }: { alert: AlertItem }) {
  const niveau = NIVEAUX[alert.level];
  const Icon = niveau.icon;
  const navigate = useNavigate();
  const custom = useCustomProducts();
  const currency = useUserCurrency();

  const host = texte(alert.payload.storeHost);
  const surRadar = followableOnRadar(host);
  const keyword = texte(alert.payload.keyword);
  // Idée de départ du produit à créer : le produit qui décolle, ou le sujet de la tendance.
  const idee = texte(alert.payload.productName) ?? (keyword ? `Produit sur « ${keyword} »` : null);

  const creerProduit = () => {
    if (!idee) return;
    if (!custom.canAdd) {
      toast.error('Votre Studio est plein : retirez un produit pour en créer un autre.');
      return;
    }
    const product = { ...blankProduct(currency), title: idee };
    custom.add(product);
    void navigate('/app/studio', { state: { produit: product.id } });
  };

  return (
    <Card className={cn('border-l-4 py-0', niveau.bord)}>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start gap-3">
          <Icon className={cn('mt-0.5 size-5 shrink-0', niveau.ton)} aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-display text-base font-bold">{alert.title}</span>
              {alert.unread && <span className="rounded-full bg-brand-green-text px-2 py-0.5 text-xs font-semibold text-white">Nouveau</span>}
            </p>
            <p className="text-sm leading-relaxed">{alert.body}</p>
            <p className="text-xs text-muted-foreground">
              {niveau.label} · {formatRelativeFr(alert.occurredAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Le Radar ne relève que les vitrines Chariow : pour une autre boutique, ce bouton ne mènerait nulle part. */}
          {host && surRadar && (
            <Button asChild size="sm" variant="secondary">
              <Link to={`/app/radar?boutique=${encodeURIComponent(host)}`}>
                <Radar />
                Voir la boutique sur le Radar
              </Link>
            </Button>
          )}
          {host && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/app/espionnage?boutique=${encodeURIComponent(host)}`}>
                <Eye />
                Analyser ses publicités
              </Link>
            </Button>
          )}
          {keyword && !host && (
            <Button asChild size="sm" variant="secondary">
              <Link to={`/app/radar?niche=${encodeURIComponent(keyword)}`}>
                <Radar />
                Voir les boutiques sur le Radar
              </Link>
            </Button>
          )}
          {idee && (
            <Button size="sm" variant="outline" onClick={creerProduit}>
              <PenSquare />
              Créer un produit similaire
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function AlertesView() {
  const [alerts, setAlerts] = useCachedState<AlertItem[]>('/api/alerts');
  const [filtre, setFiltre] = useState<Filtre>('tout');

  useEffect(() => {
    apiRequest<{ alerts: AlertItem[] }>('/api/alerts')
      .then(({ alerts: fil }) => {
        setAlerts(fil);
        // Le fil est ouvert : la cloche s'éteint. Les marques « Nouveau » restent le temps de la lecture.
        if (fil.some((alert) => alert.unread)) {
          void apiRequest('/api/alerts/seen', { method: 'POST' })
            .then(resetAlertsUnread)
            .catch(() => undefined);
        }
      })
      .catch(() => setAlerts((previous) => previous ?? []));
  }, [setAlerts]);

  // Du plus récent au plus ancien ; le même jour, le plus pressant d'abord.
  const visibles = useMemo(() => {
    const rang: Record<AlertLevel, number> = { major: 0, opportunity: 1, info: 2 };
    return (alerts ?? [])
      .filter((alert) => filtre === 'tout' || alert.level === filtre)
      .sort(
        (a, b) =>
          b.occurredAt.slice(0, 10).localeCompare(a.occurredAt.slice(0, 10)) || rang[a.level] - rang[b.level] || b.occurredAt.localeCompare(a.occurredAt),
      );
  }, [alerts, filtre]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Voir" title="Alertes" description="Produits qui décollent, niches qui s’emballent et publicités qui s’arrêtent chez vos concurrents." />

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={filtre}
        onValueChange={(next) => next && setFiltre(next as Filtre)}
        className="flex-wrap justify-start"
        aria-label="Filtrer les alertes"
      >
        <ToggleGroupItem value="tout">Toutes</ToggleGroupItem>
        <ToggleGroupItem value="major">Concurrents</ToggleGroupItem>
        <ToggleGroupItem value="opportunity">Opportunités</ToggleGroupItem>
        <ToggleGroupItem value="info">Tendances</ToggleGroupItem>
      </ToggleGroup>

      {alerts === null && (
        <div className="space-y-3">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      )}

      {alerts !== null && visibles.length === 0 && (
        <Empty className="border border-dashed py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bell />
            </EmptyMedia>
            <EmptyTitle>Aucune alerte pour l’instant</EmptyTitle>
            <EmptyDescription>Les alertes arrivent ici dès qu’un produit décolle ou qu’un concurrent bouge.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <div className="space-y-3">
        {visibles.map((alert) => (
          <AlertCard key={alert.id} alert={alert} />
        ))}
      </div>
    </div>
  );
}
