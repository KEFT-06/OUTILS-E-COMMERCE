import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Megaphone, X } from 'lucide-react';
import { dureeLisible, joursDepuis } from '@/modules/radar/radarText';
import { SalesViewToggle, type SalesView } from '@/modules/radar/SalesViewToggle';
import { categoryLabel } from '@/modules/radar/WatchItemsPanel';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { useMoney } from '@/shared/lib/money';
import type { MarketProduct, MarketSearch } from '@/shared/types/radar';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

/**
 * Concurrence d'une niche : qui vend déjà cela, à quel prix, et combien.
 * Ouvert depuis l'analyse d'une niche (« Voir la concurrence »), sans rien ressaisir.
 */

/** Plus ancienne date connue pour le produit : notre premier relevé, ou la première publicité de sa boutique. */
const enLigneDepuis = (product: MarketProduct) =>
  product.firstAdAt && product.firstAdAt < product.firstSeenAt ? product.firstAdAt : product.firstSeenAt;

const mediane = (valeurs: number[]): number | null => {
  if (valeurs.length === 0) return null;
  const tri = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(tri.length / 2);
  return tri.length % 2 ? tri[milieu]! : (tri[milieu - 1]! + tri[milieu]!) / 2;
};

export function NicheProductsPanel({
  niche,
  vue,
  onVue,
  onClose,
}: {
  niche: string;
  vue: SalesView;
  onVue: (vue: SalesView) => void;
  onClose: () => void;
}) {
  const money = useMoney();
  const path = `/api/radar/market?niche=${encodeURIComponent(niche)}`;
  const [data, setData] = useCachedState<MarketSearch>(path);

  useEffect(() => {
    apiRequest<MarketSearch>(path)
      .then(setData)
      .catch(() => undefined);
  }, [path, setData]);

  // Prix médian des produits trouvés, dans la devise de l'utilisateur : le repère pour fixer le sien.
  const prixMedian = useMemo(() => {
    const prix = (data?.products ?? []).flatMap((product) => {
      const converti = product.price === null ? null : money.convert(product.price, product.currency);
      return converti === null || converti <= 0 ? [] : [converti];
    });
    return mediane(prix);
  }, [data, money]);

  const ventes = (product: MarketProduct) => (vue === 'globale' ? product.sales : product.salesTracked);
  const produits = useMemo(
    () => [...(data?.products ?? [])].sort((a, b) => ((vue === 'globale' ? b.sales : b.salesTracked) ?? -1) - ((vue === 'globale' ? a.sales : a.salesTracked) ?? -1)),
    [data, vue],
  );

  return (
    <Card className="border-brand-green-text/40">
      <CardHeader>
        <CardTitle className="truncate">Concurrence sur « {niche} »</CardTitle>
        <CardDescription>
          {data === null
            ? 'Recherche des produits en vente…'
            : produits.length === 0
              ? 'Aucun produit en vente sur cette niche dans les boutiques connues.'
              : `${produits.length} produit${produits.length > 1 ? 's' : ''} chez ${data.stores} boutique${data.stores > 1 ? 's' : ''}${
                  prixMedian !== null ? ` · prix médian ${money.format(prixMedian, undefined, { round: true })}` : ''
                }`}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer la concurrence de cette niche">
            <X />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {data === null && <Skeleton className="h-40 rounded-lg" />}

        {produits.length > 0 && (
          <>
            <SalesViewToggle value={vue} onChange={onVue} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead>Boutique</TableHead>
                  <TableHead className="text-right">Prix</TableHead>
                  <TableHead className="text-right">{vue === 'globale' ? 'Ventes' : 'Ventes depuis le suivi'}</TableHead>
                  <TableHead className="text-right">En ligne depuis</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {produits.map((product) => {
                  const nombre = ventes(product);
                  return (
                    <TableRow key={product.id}>
                      <TableCell className="max-w-72 min-w-44">
                        <p className="line-clamp-2 font-medium whitespace-normal" title={product.name}>
                          {product.name}
                        </p>
                        {categoryLabel(product.category) && <p className="text-xs text-muted-foreground">{categoryLabel(product.category)}</p>}
                      </TableCell>
                      <TableCell className="max-w-44">
                        <a
                          href={product.storeUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex max-w-full items-center gap-1 font-medium underline-offset-4 hover:underline"
                        >
                          <span className="truncate">{product.storeLabel ?? product.storeHost}</span>
                          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                        </a>
                        {product.activeAds > 0 && (
                          <Link
                            to={`/app/espionnage?boutique=${encodeURIComponent(product.storeHost)}`}
                            className="mt-0.5 flex items-center gap-1 text-xs text-brand-green-text hover:underline"
                          >
                            <Megaphone className="size-3" aria-hidden="true" />
                            {product.activeAds} publicité{product.activeAds > 1 ? 's' : ''} en cours
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{money.format(product.price, product.currency, { round: true })}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {nombre === null ? <span className="text-muted-foreground">non publiées</span> : nombre.toLocaleString('fr-FR')}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{dureeLisible(joursDepuis(enLigneDepuis(product)))}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/app/radar?boutique=${encodeURIComponent(product.storeHost)}`}>Ouvrir la boutique</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
