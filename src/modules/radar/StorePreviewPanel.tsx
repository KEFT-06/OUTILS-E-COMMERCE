import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Megaphone, Plus, Store, X } from 'lucide-react';
import { ACCOUNT_PATH } from '@/app/navigation';
import { FirstAdCell, ProductRowActions } from '@/modules/radar/ProductRowActions';
import { dureeLisible, joursDepuis } from '@/modules/radar/radarText';
import { SalesViewToggle, type SalesView } from '@/modules/radar/SalesViewToggle';
import { categoryLabel } from '@/modules/radar/WatchItemsPanel';
import { BrandIcon } from '@/shared/components/BrandIcon';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { formatRelativeFr } from '@/shared/lib/formatDate';
import { useMoney } from '@/shared/lib/money';
import type { StorePreview, StorePreviewProduct } from '@/shared/types/radar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

/**
 * Fiche d'une boutique ouverte depuis une publicité, une alerte ou la concurrence d'une niche.
 *
 * « Ouvrir dans le Radar » mettait la boutique sous surveillance pour pouvoir la montrer : quota
 * atteint, on restait devant un refus, sans la boutique. La fiche se lit maintenant sans rien
 * ajouter au compte ; « Surveiller » est un bouton, et quand le palier est plein l'écran le dit
 * à cet endroit, avec ce qu'on peut faire, au lieu d'une erreur.
 */

/** Relances de la fiche pendant le premier relevé du catalogue, espacées de cinq secondes. */
const RELANCES = 8;

const enLigneDepuis = (product: StorePreviewProduct, firstAdAt: string | null) =>
  product.launchedAt ?? (firstAdAt && firstAdAt < product.firstSeenAt ? firstAdAt : product.firstSeenAt);

export function StorePreviewPanel({
  host,
  vue,
  onVue,
  quotaAtteint,
  onWatch,
  onAlreadyWatched,
  onClose,
}: {
  host: string;
  vue: SalesView;
  onVue: (vue: SalesView) => void;
  /** Toutes les surveillances du palier sont utilisées. */
  quotaAtteint: boolean;
  /** Met la boutique sous surveillance ; résout avec l'identifiant de la surveillance créée. */
  onWatch: (host: string) => Promise<void>;
  /** La boutique est déjà surveillée par ce compte : l'écran ouvre son catalogue suivi. */
  onAlreadyWatched: (watchId: string) => void;
  onClose: () => void;
}) {
  const money = useMoney();
  const path = `/api/radar/store?host=${encodeURIComponent(host)}`;
  const [data, setData] = useCachedState<StorePreview>(path);
  const [introuvable, setIntrouvable] = useState(false);
  const [ajout, setAjout] = useState(false);
  const essais = useRef(0);

  useEffect(() => {
    let actif = true;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    essais.current = 0;
    setIntrouvable(false);
    const lire = () => {
      apiRequest<StorePreview>(path)
        .then((fiche) => {
          if (!actif) return;
          setData(fiche);
          // Premier relevé encore en cours : la fiche revient d'elle-même, sans geste.
          if (fiche.pending && essais.current < RELANCES) {
            essais.current += 1;
            minuterie = setTimeout(lire, 5000);
          }
        })
        .catch(() => {
          if (!actif) return;
          if (essais.current < 2) {
            essais.current += 1;
            minuterie = setTimeout(lire, 3000);
          } else setIntrouvable(true);
        });
    };
    lire();
    return () => {
      actif = false;
      clearTimeout(minuterie);
    };
  }, [path, setData]);

  // Déjà surveillée : c'est son catalogue suivi qu'il faut montrer, avec son historique.
  const dejaSuivie = data?.host === host ? data.watchId : null;
  useEffect(() => {
    if (dejaSuivie) onAlreadyWatched(dejaSuivie);
  }, [dejaSuivie, onAlreadyWatched]);

  const produits = useMemo(() => {
    const ventes = (product: StorePreviewProduct) => (vue === 'globale' ? product.sales : product.salesTracked) ?? -1;
    return [...(data?.products ?? [])].sort((a, b) => Number(a.endedAt !== null) - Number(b.endedAt !== null) || ventes(b) - ventes(a));
  }, [data, vue]);

  const surveiller = async () => {
    setAjout(true);
    try {
      await onWatch(host);
    } finally {
      setAjout(false);
    }
  };

  const sansRadar = data?.limit === 0;
  const releve = data !== null && data.pending && data.products.length === 0;

  return (
    <Card className="border-brand-green-text/40">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          {data?.storefront ? <BrandIcon brand={data.storefront} decorative /> : <Store className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="truncate">{data?.label ?? host}</span>
          {data && !data.watchId && <Badge variant="outline">Non surveillée</Badge>}
        </CardTitle>
        <CardDescription className="truncate">
          {host}
          {data?.indexedAt ? ` · catalogue relevé ${formatRelativeFr(data.indexedAt)}` : ''}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer la fiche de cette boutique">
            <X />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {data === null && !introuvable && <Skeleton className="h-40 rounded-lg" />}

        {introuvable && data === null && (
          <p className="text-sm text-muted-foreground">
            La fiche de cette boutique n’a pas pu être chargée. Sa vitrine reste accessible :{' '}
            <a href={`https://${host}`} target="_blank" rel="noreferrer noopener" className="font-medium text-foreground underline underline-offset-2">
              {host}
            </a>
          </p>
        )}

        {data && (
          <>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="font-display text-xl font-bold tabular-nums">{releve ? '…' : data.liveItems}</p>
                <p className="text-xs text-muted-foreground">en vente</p>
              </div>
              <div>
                <p className="font-display text-xl font-bold tabular-nums">{data.itemsWithSales > 0 ? data.totalSales.toLocaleString('fr-FR') : '—'}</p>
                <p className="text-xs text-muted-foreground">ventes au total</p>
              </div>
              <div>
                <p className="font-display text-xl font-bold tabular-nums">{data.ads.active}</p>
                <p className="text-xs text-muted-foreground">publicité{data.ads.active > 1 ? 's' : ''} en cours</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {data.followable && !sansRadar && !quotaAtteint && (
                <Button onClick={() => void surveiller()} disabled={ajout}>
                  {ajout ? <Spinner className="size-4" /> : <Plus />}
                  Surveiller cette boutique
                </Button>
              )}
              {data.ads.total > 0 && (
                <Button asChild variant="secondary">
                  <Link to={`/app/espionnage?boutique=${encodeURIComponent(host)}`}>
                    <Megaphone />
                    {data.ads.total > 1 ? `Voir ses ${data.ads.total} publicités` : 'Voir sa publicité'}
                  </Link>
                </Button>
              )}
              <Button asChild variant="outline">
                <a href={data.url} target="_blank" rel="noreferrer noopener">
                  Vitrine
                  <ExternalLink />
                </a>
              </Button>
            </div>

            {data.followable && (sansRadar || quotaAtteint) && (
              <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {sansRadar
                  ? 'Le suivi quotidien de cette boutique — nouveaux produits, prix, ventes jour après jour — s’ouvre à partir du palier Plus. '
                  : `Vos ${data.limit} surveillance${(data.limit ?? 0) > 1 ? 's sont utilisées' : ' est utilisée'} : retirez-en une plus bas pour suivre celle-ci jour après jour, ou passez au palier supérieur. `}
                <Link to={`${ACCOUNT_PATH}#paliers`} className="font-medium text-foreground underline underline-offset-2">
                  Voir les paliers
                </Link>
              </p>
            )}

            {releve && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Relevé du catalogue en cours…
              </p>
            )}

            {!data.followable && (
              <p className="text-sm text-muted-foreground">
                Le Radar suit les publicités de cette boutique ; son catalogue se consulte sur sa vitrine.
              </p>
            )}

            {produits.length > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Catalogue · {data.liveItems} produit{data.liveItems > 1 ? 's' : ''} en vente
                    {data.endedItems > 0 ? `, ${data.endedItems} arrêté${data.endedItems > 1 ? 's' : ''}` : ''}
                  </h3>
                  <SalesViewToggle value={vue} onChange={onVue} />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produit</TableHead>
                      <TableHead className="text-right">Prix</TableHead>
                      <TableHead className="text-right">{vue === 'globale' ? 'Ventes' : 'Ventes depuis le suivi'}</TableHead>
                      <TableHead className="text-right">En ligne depuis</TableHead>
                      <TableHead>1re publicité sur Meta</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {produits.map((product) => {
                      const nombre = vue === 'globale' ? product.sales : product.salesTracked;
                      return (
                        <TableRow key={product.id} className={product.endedAt ? 'text-muted-foreground' : undefined}>
                          <TableCell className="max-w-80 min-w-44">
                            <p className="line-clamp-2 font-medium whitespace-normal" title={product.name}>
                              {product.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {[categoryLabel(product.category), product.endedAt ? 'Arrêté' : null, product.launchedAt && !product.endedAt ? 'Lancement constaté' : null]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">{money.format(product.price, product.currency, { round: true })}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {nombre === null ? <span className="text-muted-foreground">non publiées</span> : nombre.toLocaleString('fr-FR')}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            {dureeLisible(joursDepuis(enLigneDepuis(product, data.ads.firstAdAt), product.endedAt ? new Date(product.endedAt).getTime() : Date.now()))}
                          </TableCell>
                          <TableCell>
                            <FirstAdCell firstAdAt={product.firstAdAt} />
                          </TableCell>
                          <TableCell>
                            <ProductRowActions name={product.name} host={host} slug={product.slug} externalId={product.externalId} url={product.url} productAds={product.totalAds} storeAds={data.ads.total} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </>
            )}

            {data.followable && !data.pending && data.products.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {data.unreachable
                  ? 'Sa vitrine ne répond pas en ce moment : son catalogue s’affichera ici dès qu’elle sera de nouveau lisible.'
                  : 'Cette boutique n’affiche aucun produit en vente pour l’instant.'}
              </p>
            )}

            {/* Ce qu'elle pousse en publicité : connu même sans son catalogue, et c'est ce qui dit où elle met son argent. */}
            {data.advertised.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Ce qu’elle met en avant en publicité</h3>
                <ul className="divide-y rounded-lg border">
                  {data.advertised.map((offre) => (
                    <li key={offre.url} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={offre.title}>
                          {offre.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {offre.ads} publicité{offre.ads > 1 ? 's' : ''}
                          {offre.active > 0 ? ` · ${offre.active} en cours` : ' · arrêtée' + (offre.ads > 1 ? 's' : '')}
                        </p>
                      </div>
                      <Button asChild variant="ghost" size="sm">
                        <a href={offre.url} target="_blank" rel="noreferrer noopener" aria-label={`Ouvrir la page de « ${offre.title} »`}>
                          Voir la page
                          <ExternalLink />
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
