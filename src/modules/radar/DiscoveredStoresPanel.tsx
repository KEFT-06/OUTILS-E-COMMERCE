import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Megaphone, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { toApiError } from '@/shared/lib/apiError';
import { formatRelativeFr } from '@/shared/lib/formatDate';
import type { DiscoveryView } from '@/shared/types/radar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Boutiques repérées, à mettre sous surveillance en un clic.
 *
 * C'est la seule chose que la lecture des vitrines ne sait pas faire : découvrir un
 * concurrent qu'on ne connaît pas. La liste vient de la publicité — toute publicité d'une
 * boutique de la plateforme mène à un lien qui la nomme.
 *
 * Le nombre de publicités affiché est un INDICE d'activité, pas une mesure : il dit
 * « celui-là dépense », pas « celui-là vend ». Les ventes, elles, n'arrivent qu'après la
 * mise sous surveillance — c'est la vitrine qui les publie, pas la publicité.
 *
 * Personne ne peut déclencher une collecte depuis cet écran, sauf un administrateur :
 * chaque passage se paie au résultat chez le fournisseur.
 */

export function DiscoveredStoresPanel({
  onWatch,
  disabled,
}: {
  onWatch: (host: string) => Promise<void>;
  disabled: boolean;
}) {
  const [data, setData] = useCachedState<DiscoveryView>('/api/radar/discover');
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiRequest<DiscoveryView>('/api/radar/discover'));
    } catch {
      // La découverte est un complément : son absence ne doit pas abîmer l'écran.
      setData(null);
    }
  }, [setData]);

  useEffect(() => {
    void load();
  }, [load]);

  // Rien de configuré et rien en cache : le panneau ne s'affiche pas du tout, plutôt que
  // de promettre une fonction absente.
  if (!data || (!data.configured && data.stores.length === 0)) return null;

  async function watch(host: string) {
    setBusy(host);
    try {
      await onWatch(host);
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const { outcome } = await apiRequest<{ outcome: { adsExamined: number; storesFound: number; storesNew: number } }>(
        '/api/radar/discover/refresh',
        { method: 'POST' },
      );
      toast.success(
        `${outcome.storesFound} boutiques repérées sur ${outcome.adsExamined} publicités, dont ${outcome.storesNew} nouvelle${outcome.storesNew > 1 ? 's' : ''}.`,
      );
      await load();
    } catch (caught) {
      toast.error(toApiError(caught, 'La collecte n’a pas abouti.').message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Compass className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Boutiques repérées
        </CardTitle>
        <CardDescription>
          Les boutiques qui font de la publicité en ce moment
          {data.lastRunAt ? ` · contrôlé ${formatRelativeFr(data.lastRunAt)}` : ''}
        </CardDescription>
        {data.canRefresh && (
          <CardAction>
            <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
              {refreshing ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
              Collecter
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {data.stores.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Aucune boutique repérée pour l’instant.
          </p>
        ) : (
          <ul className="divide-y">
            {data.stores.map((store) => (
              <li key={store.host} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{store.label ?? store.host}</p>
                  <p className="truncate text-xs text-muted-foreground">{store.host}</p>
                </div>
                {store.activeAds > 0 ? (
                  <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-brand-green-text">
                    <Link to={`/app/espionnage?boutique=${encodeURIComponent(store.host)}`}>
                      <Megaphone className="size-3.5" />
                      {store.activeAds} pub{store.activeAds > 1 ? 's' : ''} en cours
                    </Link>
                  </Button>
                ) : (
                  <Badge variant="outline" className="whitespace-nowrap">
                    aucune pub en cours
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled || busy === store.host}
                  onClick={() => void watch(store.host)}
                >
                  {busy === store.host ? <Spinner className="size-4" /> : <Plus className="size-4" />}
                  Surveiller
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
