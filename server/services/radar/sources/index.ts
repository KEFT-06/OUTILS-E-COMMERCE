import type { WatchSource } from '@server/db/schema';
import { chariowStoreSource } from '@server/services/radar/sources/chariowStore';
import type { RadarSource } from '@server/services/radar/types';

/**
 * Sources branchées sur le radar. Le moteur de comparaison n'en connaît aucune en
 * particulier : ajouter les publicités Meta, ou une autre plateforme, se fait ici et
 * dans l'énumération `WATCH_SOURCES` du schéma, sans rien changer d'autre.
 */
const SOURCES: Record<WatchSource, RadarSource> = {
  chariow_store: chariowStoreSource,
};

export function sourceFor(source: WatchSource): RadarSource {
  return SOURCES[source];
}
