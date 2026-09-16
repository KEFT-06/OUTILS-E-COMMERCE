import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, PackageSearch, XCircle } from 'lucide-react';
import { ConnectChariowLink } from '@/shared/components/ConnectChariowLink';
import { PageHeader } from '@/shared/components/PageHeader';
import { type ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { cn } from '@/shared/lib/utils';
import type { MarketplaceInfo, MarketplaceProduct } from '@/shared/types/marketplaces';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { SalesSummaryCard } from '@/shared/components/SalesSummaryCard';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

/**
 * Distribution marketplace.
 *
 * L'écran reflète les capacités déclarées par chaque connecteur, et rien de plus.
 * Chariow ne permet pas de publier un produit par API : il n'y a donc pas de
 * bouton « Publier », mais une explication de la marche à suivre.
 */

const CAPABILITIES: { key: keyof MarketplaceInfo['capabilities']; label: string }[] = [
  { key: 'readProducts', label: 'Import du catalogue' },
  { key: 'readSales', label: 'Remontée des ventes' },
  { key: 'publishProducts', label: 'Publication de produits' },
];

export function DistributionView() {
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [catalog, setCatalog] = useState<{ products: MarketplaceProduct[]; truncated: boolean } | null>(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/marketplaces')
      .then(async (response) => {
        if (!response.ok) {
          throw await readApiError(response, `Les connecteurs n'ont pas pu être chargés (${response.status}).`);
        }
        return (await response.json()) as { marketplaces: MarketplaceInfo[] };
      })
      .then((payload) => {
        if (!cancelled) setMarketplaces(payload.marketplaces);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoadError(toApiError(caught, "Les connecteurs n'ont pas pu être chargés."));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const chariow = marketplaces?.find((marketplace) => marketplace.id === 'chariow');

  const loadCatalog = async () => {
    setIsLoadingCatalog(true);
    setCatalogError(null);
    try {
      const response = await fetch('/api/marketplaces/chariow/products');
      if (!response.ok) {
        throw await readApiError(response, `Le catalogue n'a pas pu être chargé (${response.status}).`);
      }
      setCatalog((await response.json()) as { products: MarketplaceProduct[]; truncated: boolean });
    } catch (caught) {
      setCatalogError(toApiError(caught, "Le catalogue n'a pas pu être chargé."));
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Vendre"
        title="Distribution"
        description="Reliez vos boutiques pour importer votre catalogue et suivre vos ventes réelles."
      />

      <Alert variant="info">
        <Info />
        <AlertTitle>La publication d’un produit se fait sur la marketplace</AlertTitle>
        <AlertDescription>
          L’API de Chariow permet de lire le catalogue et les ventes, pas de créer un produit. Créez-le sur Chariow à
          partir de votre export du Studio : Smart Creator en suivra ensuite les ventes.
        </AlertDescription>
      </Alert>

      {loadError && (
        <Alert variant="danger">
          <AlertTriangle />
          <AlertTitle>Connecteurs indisponibles</AlertTitle>
          <AlertDescription>{loadError.message}</AlertDescription>
        </Alert>
      )}

      {!marketplaces && !loadError && (
        <div className="grid gap-4 md:grid-cols-3" aria-label="Chargement des connecteurs">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      )}

      {marketplaces && (
        <div className="grid gap-4 md:grid-cols-3">
          {marketplaces.map((marketplace) => (
            <Card key={marketplace.id} className="gap-4 py-5">
              <CardHeader className="px-5">
                <CardTitle>{marketplace.label}</CardTitle>
                <CardAction>
                  <Badge variant={marketplace.available ? 'success' : 'secondary'}>
                    {marketplace.available ? 'Connectée' : 'Non disponible'}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3 px-5">
                <ul className="space-y-2">
                  {CAPABILITIES.map((capability) => {
                    const supported = marketplace.capabilities[capability.key];
                    return (
                      <li
                        key={capability.key}
                        className={cn('flex items-center gap-2 text-sm', !supported && 'text-muted-foreground')}
                      >
                        {supported ? (
                          <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Disponible" />
                        ) : (
                          <XCircle className="size-4 shrink-0 text-muted-foreground" aria-label="Indisponible" />
                        )}
                        {capability.label}
                      </li>
                    );
                  })}
                </ul>
                {marketplace.reason && (
                  <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">{marketplace.reason}</p>
                )}
                {marketplace.id === 'chariow' && !marketplace.available && <ConnectChariowLink />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent>
          <SalesSummaryCard />
        </CardContent>
      </Card>

      {chariow?.available && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackageSearch className="size-4 text-brand-green-text" aria-hidden="true" />
              Catalogue Chariow
            </CardTitle>
            <CardDescription>Les produits publiés sur votre boutique.</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" onClick={loadCatalog} disabled={isLoadingCatalog}>
                {isLoadingCatalog && <Spinner />}
                {catalog ? 'Actualiser' : 'Importer le catalogue'}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            {catalogError && (
              <Alert variant="danger">
                <AlertTriangle />
                <AlertDescription>{catalogError.message}</AlertDescription>
              </Alert>
            )}

            {catalog && catalog.products.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun produit publié sur cette boutique.</p>
            )}

            {catalog && catalog.products.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Prix</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalog.products.map((product) => (
                    <TableRow key={product.externalId}>
                      <TableCell className="font-medium whitespace-normal">{product.name}</TableCell>
                      <TableCell className="text-muted-foreground">{product.type}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {product.isFree ? 'Gratuit' : (product.price?.formatted ?? 'Prix non renseigné')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {catalog?.truncated && (
              <p className="text-xs text-warning">Catalogue trop volumineux : seule une partie est affichée.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
