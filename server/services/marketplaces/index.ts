import { AppError } from '@server/middleware';
import { chariowAdapter } from '@server/services/marketplaces/chariow';
import { MarketplaceAdapter } from '@server/services/marketplaces/types';

export * from '@server/services/marketplaces/types';

/**
 * Connecteur prévu, sans API publique à brancher.
 *
 * Inscrit au registre plutôt qu'omis : l'écran peut dire pourquoi Maketou ou
 * Taliopay ne sont pas disponibles, au lieu de laisser croire qu'ils ont été
 * oubliés — ou pire, d'afficher un bouton de connexion qui ne mène nulle part.
 */
function plannedAdapter(id: string, label: string): MarketplaceAdapter {
  const reason =
    `${label} ne publie pas de documentation d'API (CdC §6.6). ` +
    "Le connecteur se branchera sur la même interface une fois le partenariat négocié.";
  const refuse = () => Promise.reject(new AppError(501, reason, 'MARKETPLACE_NOT_AVAILABLE'));

  return {
    id,
    label,
    capabilities: { readProducts: false, publishProducts: false, readSales: false },
    isAvailable: () => ({ available: false, reason }),
    listProducts: refuse,
    salesSummary: refuse,
  };
}

const MARKETPLACES: Record<string, MarketplaceAdapter> = {
  [chariowAdapter.id]: chariowAdapter,
  maketou: plannedAdapter('maketou', 'Maketou'),
  taliopay: plannedAdapter('taliopay', 'Taliopay'),
};

export function getMarketplace(id: string): MarketplaceAdapter {
  const adapter = MARKETPLACES[id];
  if (!adapter) throw new AppError(404, `Marketplace inconnue : « ${id} ».`, 'MARKETPLACE_UNKNOWN');
  return adapter;
}

/** Marketplaces branchées et disponibles, dans l'ordre du registre. */
export function availableMarketplaces(): MarketplaceAdapter[] {
  return Object.values(MARKETPLACES).filter((adapter) => adapter.isAvailable().available);
}

export function listMarketplaces() {
  return Object.values(MARKETPLACES).map((adapter) => {
    const availability = adapter.isAvailable();
    return {
      id: adapter.id,
      label: adapter.label,
      capabilities: adapter.capabilities,
      available: availability.available,
      ...(availability.available ? {} : { reason: availability.reason }),
    };
  });
}
