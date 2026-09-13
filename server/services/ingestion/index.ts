import { env } from '@server/env';
import { AdIngestionAdapter } from '@server/services/ingestion/types';
import { metaAdLibraryAdapter } from '@server/services/ingestion/metaAdLibrary';
import { fixtureAdapter } from '@server/services/ingestion/fixture';

export * from '@server/services/ingestion/types';

/**
 * Registre des sources d'ingestion — feuille de route 2.1.
 *
 * Ajouter TikTok Creative Center ou un fournisseur tiers revient à déposer une
 * implémentation ici. Aucune route, aucun composant et surtout pas le moteur de
 * scoring n'ont à en être informés.
 */
const ADAPTERS: Record<string, AdIngestionAdapter> = {
  [metaAdLibraryAdapter.id]: metaAdLibraryAdapter,
  [fixtureAdapter.id]: fixtureAdapter,
};

/**
 * Adaptateur actif.
 *
 * Par défaut Meta : le jeu de démonstration ne doit jamais être sélectionné
 * implicitement. S'il se déclenchait par simple absence de configuration, une
 * installation mal paramétrée servirait des chiffres fictifs en croyant servir
 * le marché — précisément le scénario que tout le reste du produit cherche à
 * rendre impossible.
 */
export function getActiveAdapter(): AdIngestionAdapter {
  const requested = env.AD_INGESTION_ADAPTER ?? metaAdLibraryAdapter.id;
  const adapter = ADAPTERS[requested];

  if (!adapter) {
    throw new Error(
      `Adaptateur d'ingestion inconnu : « ${requested} ». Valeurs acceptées : ${Object.keys(ADAPTERS).join(', ')}.`,
    );
  }

  return adapter;
}

export function listAdapters() {
  return Object.values(ADAPTERS).map((adapter) => {
    const availability = adapter.isAvailable();
    return {
      id: adapter.id,
      label: adapter.label,
      available: availability.available,
      ...(availability.available ? {} : { reason: availability.reason }),
    };
  });
}
