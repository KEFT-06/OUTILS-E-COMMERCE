import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Megaphone, X } from 'lucide-react';
import { FirstAdCell, ProductRowActions } from '@/modules/radar/ProductRowActions';
import { dureeLisible, joursDepuis } from '@/modules/radar/radarText';
import { SalesViewToggle, type SalesView } from '@/modules/radar/SalesViewToggle';
import { categoryLabel } from '@/modules/radar/WatchItemsPanel';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { formatDateFr } from '@/shared/lib/formatDate';
import { useMoney } from '@/shared/lib/money';
import { followableOnRadar } from '@server/shared/storefronts';
import type { AdvertisedOffer, MarketProduct, MarketSearch } from '@/shared/types/radar';
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

  const offres = data?.advertised ?? [];

  return (
    <Card className="border-brand-green-text/40">
      <CardHeader>
        <CardTitle className="truncate">Concurrence sur « {niche} »</CardTitle>
        <CardDescription>
          {data === null
            ? 'Recherche des produits en vente…'
            : produits.length === 0
              ? offres.length > 0
                ? `Aucun produit de cette niche dans les catalogues relevés ; ${offres.length} offre${offres.length > 1 ? 's' : ''} vue${offres.length > 1 ? 's' : ''} en publicité ci-dessous.`
                : 'Aucun produit en vente sur cette niche dans les boutiques connues, ni aucune publicité sur le mur.'
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
                  <TableHead>1re publicité sur Meta</TableHead>
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
                      <TableCell>
                        <FirstAdCell firstAdAt={product.productFirstAdAt} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-nowrap items-center justify-end gap-1.5">
                          <ProductRowActions name={product.name} host={product.storeHost} slug={product.slug} externalId={product.externalId} url={product.url} productAds={product.productAds} storeAds={product.activeAds} />
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/app/radar?boutique=${encodeURIComponent(product.storeHost)}`}>Boutique</Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}

        {offres.length > 0 && <AdvertisedOffers offers={offres} />}
      </CardContent>
    </Card>
  );
}

/** Clé du produit dans l'adresse de l'offre (son nom d'adresse ou son identifiant), pour filtrer le mur dessus. */
const cleProduit = (landingUrl: string) => {
  try {
    const segments = new URL(landingUrl).pathname.split('/').filter(Boolean).filter((segment) => segment.toLowerCase() !== 'checkout');
    return segments.at(-1) ?? null;
  } catch {
    return null;
  }
};

/**
 * Ce que le mur d'espionnage montre de la niche : les offres que ses boutiques paient pour diffuser.
 * Le Radar les ignorait quand l'index des catalogues n'avait rien — les vitrines Chariow refusent
 * d'être relues depuis le 11/10/2026 (demande du propriétaire, 18/10/2026 : Radar et Espionnage se
 * complètent).
 */
function AdvertisedOffers({ offers }: { offers: AdvertisedOffer[] }) {
  const money = useMoney();
  return (
    <section className="space-y-2" aria-labelledby="offres-publicite">
      <h3 id="offres-publicite" className="flex items-center gap-1.5 text-sm font-semibold">
        <Megaphone className="size-4 text-brand-green-text" aria-hidden="true" />
        Offres de la niche vues en publicité
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Offre</TableHead>
            <TableHead>Boutique</TableHead>
            <TableHead className="text-right">Publicités</TableHead>
            <TableHead className="text-right">Diffusée depuis</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {offers.map((offer) => {
            const cle = cleProduit(offer.landingUrl);
            const mur = `/app/espionnage?boutique=${encodeURIComponent(offer.storeHost)}${cle ? `&produit=${encodeURIComponent(cle)}` : ''}`;
            return (
              <TableRow key={`${offer.storeHost}${offer.landingUrl}`}>
                <TableCell className="max-w-72 min-w-44">
                  <p className="line-clamp-2 font-medium whitespace-normal" title={offer.title}>
                    {offer.title}
                  </p>
                  {offer.product && (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {offer.product.sales !== null ? `${offer.product.sales.toLocaleString('fr-FR')} vente${offer.product.sales > 1 ? 's' : ''}` : 'Ventes non publiées'}
                      {offer.product.price !== null && ` · ${money.format(offer.product.price, offer.product.currency, { round: true })}`}
                      {` · relevé le ${formatDateFr(offer.product.readAt)}`}
                    </p>
                  )}
                </TableCell>
                <TableCell className="max-w-44">
                  <a href={`https://${offer.storeHost}`} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 font-medium underline-offset-4 hover:underline">
                    <span className="truncate">{offer.storeHost}</span>
                    <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                  </a>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {offer.activeAds > 0 ? `${offer.activeAds} en cours / ${offer.ads}` : `${offer.ads} (arrêtée${offer.ads > 1 ? 's' : ''})`}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">{offer.longestDays !== null ? dureeLisible(offer.longestDays) : '—'}</TableCell>
                <TableCell>
                  <div className="flex flex-nowrap items-center justify-end gap-1.5">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={mur}>Publicités</Link>
                    </Button>
                    {followableOnRadar(offer.storeHost) && (
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/app/radar?boutique=${encodeURIComponent(offer.storeHost)}`}>Boutique</Link>
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
