import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Megaphone } from 'lucide-react';
import { dureeLisible, joursDepuis } from '@/modules/radar/radarText';
import { SalesViewToggle, type SalesView } from '@/modules/radar/SalesViewToggle';
import { apiRequest } from '@/shared/lib/api';
import { cacheEpoch, lastKnown, remember } from '@/shared/lib/apiCache';
import { toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { useMoney } from '@/shared/lib/money';
import type { WatchItemView, WatchSummary } from '@/shared/types/radar';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

/**
 * Catalogue d'une boutique surveillée : prix, ventes, ancienneté et publicités de chaque produit.
 *
 * Deux mesures de ventes, au choix de l'utilisateur : le total depuis la création du produit
 * (ce que la boutique publie), ou ce qui s'est vendu depuis la mise sous surveillance.
 *
 * L'ancienneté est une borne basse : la boutique ne publie aucune date de création. On retient
 * la plus ancienne des deux dates connues — notre premier passage, ou le début de la première
 * publicité repérée pour ce produit, que la régie publie et qui remonte souvent bien avant.
 */

type Etat = 'tous' | 'en_vente' | 'arretes';
type Tri = 'ventes' | 'anciennete' | 'prix';

const SEUILS: { value: string; label: string }[] = [
  { value: '0', label: 'Toute ancienneté' },
  { value: '7', label: 'En ligne depuis 7 jours et plus' },
  { value: '30', label: 'En ligne depuis 30 jours et plus' },
  { value: '60', label: 'En ligne depuis 60 jours et plus' },
];

/** Catégories de la plateforme, dites en français ; une catégorie inconnue est simplement mise en forme. */
const CATEGORIES: Record<string, string> = {
  health_and_wellness: 'Santé et bien-être',
  business_and_money: 'Business et argent',
  education: 'Éducation',
  self_improvement: 'Développement personnel',
  food_and_cooking: 'Cuisine',
  relationships: 'Relations',
  technology: 'Technologie',
  design: 'Design',
  marketing: 'Marketing',
  finance: 'Finance',
  religion_and_spirituality: 'Religion et spiritualité',
  fitness: 'Sport et forme',
  beauty: 'Beauté',
  parenting: 'Parentalité',
  other: 'Autre',
};

export const categoryLabel = (category: string | null): string | null =>
  category ? (CATEGORIES[category] ?? category.replace(/_/g, ' ').replace(/^./, (lettre) => lettre.toUpperCase())) : null;

/** Date la plus ancienne à laquelle le produit était déjà en ligne, à notre connaissance. */
const enLigneDepuis = (item: WatchItemView): string =>
  item.firstAdAt && item.firstAdAt < item.firstSeenAt ? item.firstAdAt : item.firstSeenAt;

/** Jours d'ancienneté connus, arrêtés à la date de retrait pour un produit arrêté. */
const anciennete = (item: WatchItemView): number =>
  joursDepuis(enLigneDepuis(item), item.endedAt ? new Date(item.endedAt).getTime() : Date.now());

export function WatchItemsPanel({
  watch,
  onBack,
  vue,
  onVue,
}: {
  watch: WatchSummary;
  onBack: () => void;
  vue: SalesView;
  onVue: (vue: SalesView) => void;
}) {
  // Prix des boutiques surveillées, convertis dans la devise de l'utilisateur.
  const money = useMoney();
  const path = `/api/radar/watches/${watch.id}/items`;
  const [items, setItems] = useState<WatchItemView[] | null>(() => lastKnown<WatchItemView[]>(path));
  const [error, setError] = useState<string | null>(null);
  const [etat, setEtat] = useState<Etat>('tous');
  const [seuil, setSeuil] = useState('0');
  const [tri, setTri] = useState<Tri>('ventes');

  useEffect(() => {
    let cancelled = false;
    const epoch = cacheEpoch();
    // Catalogue déjà ouvert pendant cette visite : il s'affiche tout de suite, puis il est relu.
    setItems(lastKnown<WatchItemView[]>(path));
    setError(null);
    apiRequest<{ items: WatchItemView[] }>(path)
      .then((payload) => {
        remember(path, payload.items, epoch);
        if (!cancelled) setItems(payload.items);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'Le catalogue n’a pas pu être chargé.').message);
      });
    return () => {
      cancelled = true;
    };
  }, [path, watch.lastSweptAt]);

  const ventes = (item: WatchItemView) => (vue === 'globale' ? item.sales : item.salesTracked);

  const visibles = useMemo(() => {
    if (!items) return [];
    const minimum = Number(seuil);
    const mesure = (item: WatchItemView) => (vue === 'globale' ? item.sales : item.salesTracked);
    const filtres = items.filter((item) => {
      if (etat === 'en_vente' && item.endedAt !== null) return false;
      if (etat === 'arretes' && item.endedAt === null) return false;
      return anciennete(item) >= minimum;
    });
    return [...filtres].sort((a, b) => {
      if (tri === 'anciennete') return anciennete(b) - anciennete(a);
      if (tri === 'prix') return (b.price ?? -1) - (a.price ?? -1);
      return (mesure(b) ?? -1) - (mesure(a) ?? -1);
    });
  }, [items, etat, seuil, tri, vue]);

  const host = watch.url ? watch.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="truncate">{watch.label}</CardTitle>
        <CardDescription>
          {watch.liveItems} en vente, {watch.endedItems} arrêté{watch.endedItems > 1 ? 's' : ''}
          {watch.activeAds > 0 ? ` · ${watch.activeAds} publicité${watch.activeAds > 1 ? 's' : ''} en cours` : ''}
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft />
            Retour
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <SalesViewToggle value={vue} onChange={onVue} />

          <Select value={etat} onValueChange={(value) => setEtat(value as Etat)}>
            <SelectTrigger className="w-full sm:w-44" aria-label="État des produits">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">Tous les produits</SelectItem>
              <SelectItem value="en_vente">En vente</SelectItem>
              <SelectItem value="arretes">Arrêtés</SelectItem>
            </SelectContent>
          </Select>

          <Select value={seuil} onValueChange={setSeuil}>
            <SelectTrigger className="w-full sm:w-64" aria-label="Ancienneté minimum">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEUILS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={tri} onValueChange={(value) => setTri(value as Tri)}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Trier par">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ventes">Plus vendus d’abord</SelectItem>
              <SelectItem value="anciennete">Plus anciens d’abord</SelectItem>
              <SelectItem value="prix">Plus chers d’abord</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Catalogue indisponible</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {items === null && !error && <Skeleton className="h-48 rounded-lg" />}

        {items !== null && visibles.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Aucun produit ne correspond à ce filtre.</p>
        )}

        {visibles.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produit</TableHead>
                <TableHead className="text-right">Prix</TableHead>
                <TableHead className="text-right">{vue === 'globale' ? 'Ventes' : 'Ventes depuis le suivi'}</TableHead>
                <TableHead className="text-right">En ligne depuis</TableHead>
                <TableHead>Publicités</TableHead>
                <TableHead>État</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((item) => {
                const nombre = ventes(item);
                const jours = anciennete(item);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-72 min-w-40">
                      <p className="truncate font-medium" title={item.name}>
                        {item.name}
                      </p>
                      {(categoryLabel(item.category) ?? item.kind) && (
                        <p className="text-xs text-muted-foreground">{categoryLabel(item.category) ?? item.kind}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">{money.format(item.price, item.currency, { round: true })}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {nombre === null ? <span className="text-muted-foreground">non publiées</span> : nombre.toLocaleString('fr-FR')}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {dureeLisible(jours)}
                      <span className="block text-xs text-muted-foreground">
                        {item.firstAdAt && item.firstAdAt < item.firstSeenAt ? '1re publicité le' : 'vu depuis le'} {formatDateFr(enLigneDepuis(item))}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.activeAds > 0 && host ? (
                        <Button asChild variant="ghost" size="sm" className="-ml-2 h-7 gap-1.5 px-2">
                          <Link to={`/app/espionnage?boutique=${encodeURIComponent(host)}`}>
                            <Megaphone className="size-3.5" />
                            {item.activeAds} en cours
                          </Link>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.endedAt ? (
                        <Badge variant="outline" className="whitespace-nowrap">
                          Arrêté le {formatDateFr(item.endedAt)}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">En vente</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
