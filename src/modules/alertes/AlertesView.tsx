import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Eye, PenSquare, Radar, Rocket, Signal, TriangleAlert, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { followableOnRadar } from '@server/shared/storefronts';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { formatRelativeFr } from '@/shared/lib/formatDate';
import { roundPrice } from '@server/shared/currency';
import { useMoney, useUserCurrency } from '@/shared/lib/money';
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
 * Trois priorités, de la plus pressante à la plus générale : un mouvement majeur (scale éclair,
 * chute brutale, publicité installée désactivée), une opportunité (un concurrent qui accélère,
 * un lancement flash), un signal (premier seuil de ventes, tendance de niche). Chaque carte mène
 * directement au geste suivant : la boutique dans le Radar, ses publicités, ou le Studio.
 */

const NIVEAUX: Record<AlertLevel, { label: string; filtre: string; icon: LucideIcon; bord: string; ton: string; pastille: string }> = {
  major: { label: 'Mouvement majeur', filtre: 'Mouvements majeurs', icon: TriangleAlert, bord: 'border-l-red-500', ton: 'text-red-600 dark:text-red-400', pastille: 'bg-red-500' },
  opportunity: { label: 'Opportunité', filtre: 'Opportunités', icon: Rocket, bord: 'border-l-amber-500', ton: 'text-amber-600 dark:text-amber-500', pastille: 'bg-amber-500' },
  info: { label: 'Signal', filtre: 'Signaux', icon: Signal, bord: 'border-l-brand-green', ton: 'text-brand-green-text', pastille: 'bg-brand-green' },
};
const ORDRE: AlertLevel[] = ['major', 'opportunity', 'info'];

type Filtre = 'tout' | AlertLevel;

const texte = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const nombre = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function AlertCard({ alert }: { alert: AlertItem }) {
  const niveau = NIVEAUX[alert.level];
  const Icon = niveau.icon;
  const navigate = useNavigate();
  const custom = useCustomProducts();
  const currency = useUserCurrency();
  const money = useMoney();

  const host = texte(alert.payload.storeHost);
  const surRadar = followableOnRadar(host);
  const keyword = texte(alert.payload.keyword);
  // Idée de départ du produit à créer : le produit qui décolle, ou le sujet de la tendance.
  const idee = texte(alert.payload.productName) ?? (keyword ? `Produit sur « ${keyword} »` : null);
  const prix = nombre(alert.payload.price);
  const devise = texte(alert.payload.currency);
  const ventesJour = nombre(alert.payload.salesToday);
  const ventesVeille = nombre(alert.payload.salesYesterday);
  const ventesTotal = nombre(alert.payload.sales);

  // Les chiffres de la constatation, sous la phrase : ce qui permet de juger sans ouvrir la boutique.
  const faits = [
    ventesJour !== null ? `${ventesJour.toLocaleString('fr-FR')} vente${ventesJour > 1 ? 's' : ''} aujourd’hui` : null,
    ventesVeille !== null ? `${ventesVeille.toLocaleString('fr-FR')} la veille` : null,
    ventesTotal !== null ? `${ventesTotal.toLocaleString('fr-FR')} au total` : null,
    prix !== null && prix > 0 ? `vendu ${money.format(prix, devise, { round: true })}` : null,
  ].filter(Boolean);

  const creerProduit = () => {
    if (!idee) return;
    if (!custom.canAdd) {
      toast.error('Votre Studio est plein : retirez un produit pour en créer un autre.');
      return;
    }
    /*
      Le Studio reçoit ce que l'alerte sait du produit : son sujet, et le prix pratiqué sur le
      marché, converti dans la devise du compte, comme point de départ du simulateur.
    */
    const prixDepart = prix !== null && prix > 0 ? money.convert(prix, devise) : null;
    const product = {
      ...blankProduct(currency),
      title: idee,
      ...(prixDepart !== null
        ? { recommendedPrice: roundPrice(prixDepart, currency), pricingNote: 'Prix relevé sur le marché pour un produit proche : ajustez-le dans le simulateur.' }
        : {}),
    };
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
            {faits.length > 0 && <p className="text-sm font-medium tabular-nums">{faits.join(' · ')}</p>}
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
                Analyser ses publicités sur l’Espionnage
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
              Créer dans le Studio
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

  const parNiveau = useMemo(() => {
    const comptes: Record<AlertLevel, number> = { major: 0, opportunity: 0, info: 0 };
    for (const alert of alerts ?? []) comptes[alert.level] += 1;
    return comptes;
  }, [alerts]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voir"
        title="Alertes"
        description="Ce que vos concurrents ont fait aujourd’hui : produits qui décollent, ventes qui s’envolent ou s’effondrent, publicités installées qui s’arrêtent."
      />

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={filtre}
        onValueChange={(next) => next && setFiltre(next as Filtre)}
        className="flex-wrap justify-start"
        aria-label="Filtrer les alertes"
      >
        <ToggleGroupItem value="tout">Toutes{alerts ? ` · ${alerts.length}` : ''}</ToggleGroupItem>
        {ORDRE.map((niveau) => (
          <ToggleGroupItem key={niveau} value={niveau} className="gap-2">
            <span className={cn('size-2 rounded-full', NIVEAUX[niveau].pastille)} aria-hidden="true" />
            {NIVEAUX[niveau].filtre}
            {alerts ? ` · ${parNiveau[niveau]}` : ''}
          </ToggleGroupItem>
        ))}
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
            <EmptyTitle>{filtre === 'tout' ? 'Aucune alerte pour l’instant' : `Aucune alerte « ${NIVEAUX[filtre].filtre.toLowerCase()} » pour l’instant`}</EmptyTitle>
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
