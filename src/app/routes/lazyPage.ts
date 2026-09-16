import { lazy, type ComponentType } from 'react';

/**
 * Page chargée à la première ouverture de son adresse, depuis l'export nommé d'un module : le
 * code d'une page n'est téléchargé que par qui la visite.
 */
export function lazyPage<P extends object, K extends string>(load: () => Promise<Record<K, ComponentType<P>>>, name: K) {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}
