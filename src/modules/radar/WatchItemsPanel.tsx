import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import type { WatchItemView, WatchSummary } from '@/shared/types/radar';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

/**
 * Catalogue d'une boutique surveillée, avec le filtre d'ancienneté.
 *
 * C'est la vue qui ressemble le plus aux outils d'espionnage du marché — à une différence
 * qui change tout : leur « ancienneté » est lue sur la page du concurrent, la nôtre est
 * MESURÉE par nos propres passages. Un outil qui lit une page ne peut pas afficher un
 * produit arrêté : la page ne le montre plus. Nous, si, avec sa date d'arrêt.
 *
 * L'ancienneté sert de filtre parce qu'elle sépare deux choses que le débutant confond :
 * un produit vu depuis 3 jours est un test en cours, un produit encore là au bout de 60
 * jours est une offre qui tient. Les deux méritent des décisions opposées.
 */

type Etat = 'tous' | 'en_vente' | 'arretes';
type Tri = 'ventes' | 'anciennete' | 'prix';

/** Seuils du filtre d'ancienneté, choisis sur le cycle de vie d'un produit numérique. */
const SEUILS: { value: string; label: string; hint: string }[] = [
  { value: '0', label: 'Toute ancienneté', hint: '' },
  { value: '7', label: 'Suivi 7 jours et plus', hint: 'a passé la première semaine' },
  { value: '30', label: 'Suivi 30 jours et plus', hint: 'tient depuis un mois' },
  { value: '60', label: 'Suivi 60 jours et plus', hint: 'offre installée' },
];

const money = (value: number | null, currency: string | null) =>
  value === null ? '—' : `${value.toLocaleString('fr-FR')} ${currency ?? ''}`.trim();

export function WatchItemsPanel({ watch, onBack }: { watch: WatchSummary; onBack: () => void }) {
  const [items, setItems] = useState<WatchItemView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [etat, setEtat] = useState<Etat>('tous');
  const [seuil, setSeuil] = useState('0');
  const [tri, setTri] = useState<Tri>('ventes');

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    apiRequest<{ items: WatchItemView[] }>(`/api/radar/watches/${watch.id}/items`)
      .then((payload) => {
        if (!cancelled) setItems(payload.items);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'Le catalogue suivi n’a pas pu être chargé.').message);
      });
    return () => {
      cancelled = true;
    };
  }, [watch.id, watch.lastSweptAt]);

  const visibles = useMemo(() => {
    if (!items) return [];
    const minimum = Number(seuil);
    const filtres = items.filter((item) => {
      if (etat === 'en_vente' && item.endedAt !== null) return false;
      if (etat === 'arretes' && item.endedAt === null) return false;
      return item.trackedDays >= minimum;
    });
    return [...filtres].sort((a, b) => {
      if (tri === 'anciennete') return b.trackedDays - a.trackedDays;
      if (tri === 'prix') return (b.price ?? -1) - (a.price ?? -1);
      return (b.sales ?? -1) - (a.sales ?? -1);
    });
  }, [items, etat, seuil, tri]);

  const hint = SEUILS.find((option) => option.value === seuil)?.hint ?? '';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="truncate">{watch.label}</CardTitle>
        <CardDescription>
          {watch.liveItems} en vente, {watch.endedItems} arrêté{watch.endedItems > 1 ? 's' : ''} · suivi depuis{' '}
          {watch.trackedDays} jour{watch.trackedDays > 1 ? 's' : ''}
          {hint ? ` · filtre : ${hint}` : ''}
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft />
            Retour
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
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
            <SelectTrigger className="w-full sm:w-56" aria-label="Ancienneté minimum du suivi">
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
          <p className="py-6 text-center text-sm text-muted-foreground">
            Aucun produit ne correspond à ce filtre. L’ancienneté se construit un jour à la fois : le radar ne peut pas
            l’inventer pour les produits qu’il vient de découvrir.
          </p>
        )}

        {visibles.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produit</TableHead>
                <TableHead className="text-right">Prix</TableHead>
                <TableHead className="text-right">Ventes</TableHead>
                <TableHead className="text-right">Suivi</TableHead>
                <TableHead>État</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-72 min-w-40">
                    <p className="truncate font-medium" title={item.name}>
                      {item.name}
                    </p>
                    {item.kind && <p className="text-xs text-muted-foreground">{item.kind}</p>}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">{money(item.price, item.currency)}</TableCell>
                  <TableCell className="text-right">{item.sales === null ? '—' : item.sales.toLocaleString('fr-FR')}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {item.trackedDays} j
                    <span className="block text-xs text-muted-foreground">depuis {formatDateFr(item.firstSeenAt)}</span>
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
              ))}
            </TableBody>
          </Table>
        )}

        <p className="text-xs text-muted-foreground">
          « Suivi » compte les jours depuis notre premier passage, pas depuis la mise en ligne réelle du produit : la
          vitrine ne publie aucune date de création. Ce chiffre ne peut donc que grandir avec le temps — et c’est
          précisément ce qu’aucun concurrent ne peut rattraper.
        </p>
      </CardContent>
    </Card>
  );
}
