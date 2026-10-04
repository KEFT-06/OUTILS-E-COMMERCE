import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, ListTree, Megaphone, Plus, RefreshCw, Store, Trash2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { toApiError, type ApiError } from '@/shared/lib/apiError';
import { formatRelativeFr } from '@/shared/lib/formatDate';
import { useMoney } from '@/shared/lib/money';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { cn } from '@/shared/lib/utils';
import { resetRadarUnread } from '@/shared/stores/useRadarUnread';
import type { RadarDashboard, WatchEventKind, WatchEventView, WatchSummary } from '@/shared/types/radar';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Switch } from '@/shared/ui/switch';
import { DiscoveredStoresPanel } from '@/modules/radar/DiscoveredStoresPanel';
import { PerformanceBenchmarkPanel } from '@/modules/radar/PerformanceBenchmarkPanel';
import { NicheProductsPanel } from '@/modules/radar/NicheProductsPanel';
import { dureeLisible, eventText, joursDepuis } from '@/modules/radar/radarText';
import { SalesViewToggle, type SalesView } from '@/modules/radar/SalesViewToggle';
import { WatchItemsPanel } from '@/modules/radar/WatchItemsPanel';

/**
 * Radar — le seul écran du site qui se remplit sans que personne ne clique.
 *
 * Il n'affiche pas un rapport mais un fil : ce qui a bougé, quand, chez qui. La donnée
 * qu'il montre n'existe nulle part ailleurs, parce qu'une vitrine ne publie que son
 * présent : le jour où un produit s'arrête, seul celui qui regardait la veille le sait.
 */

/** Un type d'événement : son icône, sa couleur, et le mot qui l'annonce. */
const EVENT_STYLE: Record<WatchEventKind, { label: string; icon: typeof TrendingUp; tone: string }> = {
  appeared: { label: 'Nouveau', icon: Plus, tone: 'text-brand-green-text' },
  disappeared: { label: 'Arrêté', icon: ArrowDownRight, tone: 'text-muted-foreground' },
  price_changed: { label: 'Prix', icon: ArrowUpRight, tone: 'text-amber-600 dark:text-amber-500' },
  sales_jump: { label: 'Ventes', icon: TrendingUp, tone: 'text-brand-green-text' },
};

const COUNTER_ORDER: { kind: WatchEventKind; label: string }[] = [
  { kind: 'appeared', label: 'nouveautés' },
  { kind: 'sales_jump', label: 'accélérations' },
  { kind: 'price_changed', label: 'changements de prix' },
  { kind: 'disappeared', label: 'arrêts' },
];

function EventRow({ event }: { event: WatchEventView }) {
  const money = useMoney();
  const style = EVENT_STYLE[event.kind];
  const Icon = style.icon;
  return (
    <li className={cn('flex items-start gap-3 py-3', !event.read && 'font-medium')}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', style.tone)} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm leading-relaxed break-words">{eventText(event, money.format)}</p>
        <p className="text-xs text-muted-foreground">
          {event.watchLabel} · {formatRelativeFr(event.occurredAt)}
        </p>
      </div>
      {!event.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-green-text" aria-label="Non lu" />}
    </li>
  );
}

function WatchCard({
  watch,
  onSweep,
  onRemove,
  onOpen,
  busy,
  vue,
}: {
  watch: WatchSummary;
  onSweep: (id: string) => void;
  onRemove: (id: string) => void;
  onOpen: (watch: WatchSummary) => void;
  busy: string | null;
  vue: SalesView;
}) {
  const lien = safeHttpUrl(watch.url ?? undefined);
  const host = watch.url ? watch.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
  const ventes = vue === 'globale' ? watch.totalSales : watch.trackedSales;
  // Plus ancienne trace connue de la boutique : notre premier passage, ou sa première publicité.
  const anciennete = Math.max(watch.trackedDays, watch.firstAdAt ? joursDepuis(watch.firstAdAt) : 0);

  /*
    Un relevé en retard doit se voir.

    L'écran affichait « dernier relevé il y a X » sans jamais rien en conclure. Or tout ce que
    montre cette carte — prix, ventes, produits en vente — date de ce relevé-là. Sur un produit
    qui promet un passage quotidien, lire « il y a cinq jours » sans avertissement laisse croire
    à des chiffres frais, et l'auteur prend une décision sur un marché qu'il ne voit plus.
    Le radar peut prendre du retard quand la file est longue : il doit le dire, pas le taire.

    Deux jours, et non un : la fenêtre du planificateur est quotidienne, un léger décalage est
    normal. Un avertissement qui se déclenche tous les jours n'est plus lu.
  */
  const RETARD_MS = 48 * 60 * 60 * 1000;
  const enRetard = watch.active && watch.lastSweptAt !== null && Date.now() - new Date(watch.lastSweptAt).getTime() > RETARD_MS;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <Store className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{watch.label}</span>
        </CardTitle>
        <CardDescription>
          En ligne depuis au moins {dureeLisible(anciennete)}
          {watch.lastSweptAt ? ` · relevée ${formatRelativeFr(watch.lastSweptAt)}` : ''}
        </CardDescription>
        <CardAction className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Relever ${watch.label} maintenant`}
            disabled={busy === watch.id || !watch.active}
            onClick={() => onSweep(watch.id)}
          >
            {busy === watch.id ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Ne plus surveiller ${watch.label}`}
            disabled={busy === watch.id}
            onClick={() => onRemove(watch.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="font-display text-xl font-bold">{watch.liveItems}</p>
            <p className="text-xs text-muted-foreground">en vente</p>
          </div>
          <div>
            <p className="font-display text-xl font-bold">{watch.endedItems}</p>
            <p className="text-xs text-muted-foreground">arrêtés</p>
          </div>
          <div>
            <p className="font-display text-xl font-bold tabular-nums">{watch.itemsWithSales > 0 ? ventes.toLocaleString('fr-FR') : '—'}</p>
            <p className="text-xs text-muted-foreground">{vue === 'globale' ? 'ventes au total' : 'ventes depuis le suivi'}</p>
          </div>
        </div>
        {!watch.active && (
          <Alert variant="destructive">
            <AlertTitle>Surveillance en pause</AlertTitle>
            <AlertDescription>
              {watch.lastError ?? 'Plusieurs relevés ont échoué de suite.'} Retirez-la puis ajoutez-la de nouveau.
            </AlertDescription>
          </Alert>
        )}
        {watch.active && watch.lastError && (
          <p className="text-xs text-amber-600 dark:text-amber-500">Dernier relevé en échec : {watch.lastError}</p>
        )}
        {enRetard && !watch.lastError && (
          <p className="text-xs text-amber-600 dark:text-amber-500">Chiffres du dernier relevé : actualisez cette boutique.</p>
        )}
        {watch.activeAds > 0 && host && (
          <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 gap-1.5 px-2 text-brand-green-text">
            <Link to={`/app/espionnage?boutique=${encodeURIComponent(host)}`}>
              <Megaphone className="size-4" />
              {watch.activeAds} publicité{watch.activeAds > 1 ? 's' : ''} en cours
              {watch.adsCheckedAt ? ` · contrôlé ${formatRelativeFr(watch.adsCheckedAt)}` : ''}
            </Link>
          </Button>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="flex-1" onClick={() => onOpen(watch)}>
            <ListTree className="size-4" />
            Voir le catalogue
          </Button>
          {lien && (
            <Button asChild variant="outline" size="sm">
              <a href={lien} target="_blank" rel="noreferrer noopener">
                Vitrine
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const VUE_VENTES = 'sc.radar.vueVentes';

export function RadarView() {
  const [data, setData] = useCachedState<RadarDashboard>('/api/radar');
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [target, setTarget] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [busyWatch, setBusyWatch] = useState<string | null>(null);
  /** Interrupteur du résumé par e-mail, tenu localement pour répondre au clic sans attendre. */
  const [alerts, setAlerts] = useState(() => data?.alertsEnabled ?? true);
  /**
   * Boutique dont le catalogue est ouvert. On garde l'identifiant, pas l'objet : après un
   * relevé ou un retrait, le panneau suit la liste rechargée au lieu d'afficher des
   * compteurs périmés — ou une boutique qui n'existe plus.
   */
  const [ouverteId, setOuverteId] = useState<string | null>(null);
  /** Lecture des ventes : total depuis la création, ou depuis la mise sous surveillance. Retenue d'une visite à l'autre. */
  const [vue, setVueState] = useState<SalesView>(() => {
    try {
      return window.localStorage.getItem(VUE_VENTES) === 'suivi' ? 'suivi' : 'globale';
    } catch {
      return 'globale';
    }
  });
  const setVue = (next: SalesView) => {
    setVueState(next);
    try {
      window.localStorage.setItem(VUE_VENTES, next);
    } catch {
      // Stockage indisponible : le choix vaudra pour cette visite.
    }
  };
  const [params, setParams] = useSearchParams();
  /** Boutique demandée par un autre écran (« Ouvrir dans le Radar ») et niche à comparer. */
  const boutiqueDemandee = params.get('boutique');
  const niche = params.get('niche');
  const demandeTraitee = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await apiRequest<RadarDashboard>('/api/radar');
      setData(payload);
      setAlerts(payload.alertsEnabled);
      setLoadError(null);
    } catch (caught) {
      setLoadError(toApiError(caught, 'Le radar n’a pas pu être chargé.'));
    }
  }, [setData]);

  useEffect(() => {
    void load();
  }, [load]);

  // Les événements sont marqués lus à l'ouverture : la pastille compte ce qui est arrivé
  // depuis la dernière visite, pas ce que l'utilisateur n'a pas encore fait défiler.
  useEffect(() => {
    if (!data || data.events.every((event) => event.read)) return;
    void apiRequest('/api/radar/events/read', { method: 'POST' })
      .then(resetRadarUnread)
      .catch(() => undefined);
  }, [data]);

  /** Met une cible sous surveillance, qu'elle vienne du champ ou de la liste des repérées. */
  const watchTarget = useCallback(
    async (cible: string) => {
      await apiRequest('/api/radar/watches', { method: 'POST', body: { target: cible } });
      toast.success('Boutique sous surveillance. Le radar repassera chaque jour.');
      await load();
    },
    [load],
  );

  async function add() {
    const saisie = target.trim();
    if (!saisie || isAdding) return;
    setIsAdding(true);
    try {
      await watchTarget(saisie);
      setTarget('');
    } catch (caught) {
      toast.error(toApiError(caught, 'Cette boutique n’a pas pu être ajoutée.').message);
    } finally {
      setIsAdding(false);
    }
  }

  const watchFromList = useCallback(
    async (host: string) => {
      try {
        await watchTarget(host);
      } catch (caught) {
        toast.error(toApiError(caught, 'Cette boutique n’a pas pu être ajoutée.').message);
      }
    },
    [watchTarget],
  );

  async function toggleAlerts(enabled: boolean) {
    setAlerts(enabled);
    try {
      await apiRequest('/api/radar/alerts', { method: 'POST', body: { enabled } });
    } catch (caught) {
      setAlerts(!enabled);
      toast.error(toApiError(caught, 'Le réglage n’a pas pu être enregistré.').message);
    }
  }

  async function sweep(id: string) {
    setBusyWatch(id);
    try {
      await apiRequest(`/api/radar/watches/${id}/sweep`, { method: 'POST' });
      await load();
    } catch (caught) {
      toast.error(toApiError(caught, 'Le relevé n’a pas abouti.').message);
    } finally {
      setBusyWatch(null);
    }
  }

  async function remove(id: string) {
    setBusyWatch(id);
    try {
      await apiRequest(`/api/radar/watches/${id}`, { method: 'DELETE' });
      toast.success('Surveillance retirée, avec son historique.');
      await load();
    } catch (caught) {
      toast.error(toApiError(caught, 'La surveillance n’a pas pu être retirée.').message);
    } finally {
      setBusyWatch(null);
    }
  }

  /*
    Arrivée depuis une publicité (« Ouvrir dans le Radar ») : la boutique s'ouvre si elle est déjà
    surveillée ; sinon elle est mise sous surveillance, puis ouverte. Une seule fois par demande.
  */
  useEffect(() => {
    if (!boutiqueDemandee || !data || demandeTraitee.current === boutiqueDemandee) return;
    demandeTraitee.current = boutiqueDemandee;
    const host = boutiqueDemandee.toLowerCase();
    const trouver = (watches: WatchSummary[]) => watches.find((watch) => (watch.url ?? '').toLowerCase().includes(host.replace(/\.mychariow\.(com|shop)$/, '.mychariow.')));
    const effacer = () => {
      params.delete('boutique');
      setParams(params, { replace: true });
    };
    const deja = trouver(data.watches);
    if (deja) {
      setOuverteId(deja.id);
      effacer();
      return;
    }
    void (async () => {
      try {
        const { watch } = await apiRequest<{ watch: WatchSummary }>('/api/radar/watches', { method: 'POST', body: { target: host } });
        toast.success('Boutique ajoutée à votre radar.');
        await load();
        setOuverteId(watch.id);
      } catch (caught) {
        toast.error(toApiError(caught, 'Cette boutique n’a pas pu être ouverte dans le radar.').message);
      } finally {
        effacer();
      }
    })();
  }, [boutiqueDemandee, data, load, params, setParams]);

  const quotaAtteint =
    data !== null && data.limit !== null && data.watches.filter((watch) => watch.active).length >= data.limit;
  const sansAcces = data?.limit === 0;
  const ouverte = ouverteId === null ? null : (data?.watches.find((watch) => watch.id === ouverteId) ?? null);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voir"
        title="Radar"
        description="Les boutiques de vos concurrents, relevées chaque jour : produits, prix, ventes et publicités."
      />

      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Radar indisponible</AlertTitle>
          <AlertDescription>{loadError.message}</AlertDescription>
        </Alert>
      )}

      {sansAcces ? (
        <Empty className="border border-dashed py-12">
          <EmptyHeader>
            <EmptyTitle>Le radar n’est pas inclus dans votre palier</EmptyTitle>
            <EmptyDescription>
              Cette fonction s’ouvre à partir du palier Plus.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Surveiller une boutique</CardTitle>
            <CardDescription>
              Collez le lien d’une boutique Chariow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(submit) => {
                submit.preventDefault();
                void add();
              }}
            >
              <Input
                value={target}
                onChange={(change) => setTarget(change.target.value)}
                placeholder="boutique.mychariow.com"
                aria-label="Lien de la boutique à surveiller"
                disabled={isAdding || quotaAtteint}
                autoComplete="off"
                spellCheck={false}
              />
              <Button type="submit" disabled={isAdding || quotaAtteint || target.trim().length < 2}>
                {isAdding ? <Spinner className="size-4" /> : <Plus />}
                Surveiller
              </Button>
            </form>
            {quotaAtteint && (
              <p className="mt-2 text-sm text-muted-foreground">
                Votre palier permet de surveiller {data?.limit} boutique{(data?.limit ?? 0) > 1 ? 's' : ''}. Retirez-en une
                pour en ajouter une autre.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {data === null && !loadError && (
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {/*
        Placé APRÈS les surveillances et avant les boutiques à découvrir : on lit d'abord ce
        qu'on observe, puis où l'on se situe, puis qui d'autre observer. L'ordre suit la
        question que l'auteur se pose, pas l'ordre dans lequel les écrans ont été écrits.
      */}
      {!sansAcces && <PerformanceBenchmarkPanel />}

      {!sansAcces && <DiscoveredStoresPanel onWatch={watchFromList} disabled={quotaAtteint} />}

      {niche && !sansAcces && (
        <NicheProductsPanel
          niche={niche}
          vue={vue}
          onVue={setVue}
          onClose={() => {
            params.delete('niche');
            setParams(params, { replace: true });
          }}
        />
      )}

      {ouverte && <WatchItemsPanel watch={ouverte} onBack={() => setOuverteId(null)} vue={vue} onVue={setVue} />}

      {data && data.watches.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold tracking-tight">Boutiques surveillées</h2>
            <SalesViewToggle value={vue} onChange={setVue} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.watches.map((watch) => (
              <WatchCard
                key={watch.id}
                watch={watch}
                onSweep={sweep}
                onRemove={remove}
                onOpen={(cible) => setOuverteId(cible.id)}
                busy={busyWatch}
                vue={vue}
              />
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Ce qui a bougé</CardTitle>
              <CardDescription>
                Sept derniers jours :{' '}
                {COUNTER_ORDER.map(({ kind, label }) => `${data.countsLast7Days[kind] ?? 0} ${label}`).join(' · ')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.events.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Rien n’a encore bougé.
                </p>
              ) : (
                <ul className="divide-y">
                  {data.events.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {data && data.watches.length === 0 && !sansAcces && (
        <Empty className="border border-dashed py-12">
          <EmptyHeader>
            <EmptyTitle>Le radar ne surveille rien pour l’instant</EmptyTitle>
            <EmptyDescription>
              Ajoutez la boutique d’un concurrent ci-dessus.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {data && data.watches.length > 0 && data.emailConfigured && (
        <Card>
          <CardHeader>
            <CardTitle>Être averti par e-mail</CardTitle>
            <CardDescription>Un résumé, au plus une fois par jour.</CardDescription>
            <CardAction>
              <Switch
                checked={alerts && data.emailConfigured}
                disabled={!data.emailConfigured}
                onCheckedChange={(next) => void toggleAlerts(next)}
                aria-label="Recevoir le résumé du radar par e-mail"
              />
            </CardAction>
          </CardHeader>
        </Card>
      )}

    </div>
  );
}
