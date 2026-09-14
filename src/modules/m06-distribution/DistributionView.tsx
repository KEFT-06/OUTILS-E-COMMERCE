import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, PackageSearch, Store, XCircle } from 'lucide-react';
import { ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { MarketplaceInfo, MarketplaceProduct } from '@/shared/types/marketplaces';
import { SalesSummaryCard } from '@/shared/ui/SalesSummaryCard';

/**
 * Distribution marketplace — feuille de route 5.2.
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

export const DistributionView: React.FC = () => {
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
    <div className="space-y-6 animate-in fade-in duration-300">
      <header>
        <span className="mb-2 inline-block rounded-md border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-700">
          Module 06
        </span>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
          <Store className="h-6 w-6 text-indigo-600" />
          Distribution Marketplace
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Reliez vos boutiques pour importer votre catalogue et suivre vos ventes réelles.
        </p>
      </header>

      <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <p className="text-xs leading-relaxed text-slate-600">
          <strong>Publier un produit se fait sur la marketplace.</strong> L'API de Chariow permet de lire le
          catalogue et les ventes, pas de créer un produit : créez-le sur Chariow à partir de votre export
          du Studio, Smart Creator en suivra ensuite les ventes.
        </p>
      </div>

      {loadError && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <p className="text-xs leading-relaxed text-rose-900">{loadError.message}</p>
        </div>
      )}

      {!marketplaces && !loadError && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des connecteurs…
        </div>
      )}

      {marketplaces && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {marketplaces.map((marketplace) => (
            <article key={marketplace.id} className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-900">{marketplace.label}</h2>
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    marketplace.available ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {marketplace.available ? 'Connectée' : 'Non disponible'}
                </span>
              </div>

              <ul className="space-y-1.5">
                {CAPABILITIES.map((capability) => {
                  const supported = marketplace.capabilities[capability.key];
                  return (
                    <li key={capability.key} className="flex items-center gap-1.5 text-xs text-slate-600">
                      {supported ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                      )}
                      <span className={supported ? '' : 'text-slate-400'}>{capability.label}</span>
                    </li>
                  );
                })}
              </ul>

              {marketplace.reason && (
                <p className="border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-500">
                  {marketplace.reason}
                </p>
              )}
            </article>
          ))}
        </div>
      )}

      <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <SalesSummaryCard />
      </section>

      {chariow?.available && (
        <section className="space-y-3 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <PackageSearch className="h-4 w-4 text-indigo-600" />
              Catalogue Chariow
            </h2>
            <button
              type="button"
              onClick={loadCatalog}
              disabled={isLoadingCatalog}
              className="inline-flex items-center gap-1.5 self-start rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-indigo-300 disabled:opacity-50"
            >
              {isLoadingCatalog && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {catalog ? 'Actualiser' : 'Importer le catalogue'}
            </button>
          </div>

          {catalogError && <p className="text-xs text-rose-700">{catalogError.message}</p>}

          {catalog && catalog.products.length === 0 && (
            <p className="text-xs text-slate-500">Aucun produit publié sur cette boutique.</p>
          )}

          {catalog && catalog.products.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {catalog.products.map((product) => (
                <li key={product.externalId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
                    <p className="text-[11px] text-slate-400">{product.type}</p>
                  </div>
                  <span className="shrink-0 text-xs font-bold text-slate-700">
                    {product.isFree ? 'Gratuit' : (product.price?.formatted ?? 'Prix non renseigné')}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {catalog?.truncated && (
            <p className="text-[11px] text-amber-700">Catalogue trop volumineux : seule une partie est affichée.</p>
          )}
        </section>
      )}
    </div>
  );
};
