import type { AlertWatch } from '@/shared/types/radar';

const JOUR_MS = 86_400_000;

/**
 * Ce que le fil vide veut dire. « Aucune alerte » ne signifie « rien ne bouge » que si les
 * boutiques ont bien été relevées : l'écran dit donc combien le sont, et de quand date le relevé.
 *
 * Question du propriétaire, 11/10/2026 : « on mentionne aucune alerte pour l'instant, est-ce que
 * c'est vrai ? ». C'était vrai, et trompeur : le relevé qui produit les alertes n'avait pas relu
 * neuf boutiques sur dix depuis cinq jours, et l'écran promettait qu'elles arriveraient « dès
 * qu'un produit décolle ».
 */
export function etatDeLaVeille(watch: AlertWatch | null, now = Date.now()): string {
  const attente = 'Les alertes arrivent ici dès qu’un produit décolle ou qu’un concurrent bouge.';
  if (!watch || watch.stores === 0) return attente;
  const boutiques = `${watch.stores.toLocaleString('fr-FR')} boutique${watch.stores > 1 ? 's' : ''}`;
  const dernier = watch.readings[0];
  if (!dernier) return `${boutiques} sous veille. Leurs ventes se comparent d’un jour sur l’autre : la première alerte peut arriver dès le deuxième relevé.`;
  const age = Math.round((Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${dernier.day}T00:00:00Z`)) / JOUR_MS);
  const lues = `${dernier.stores.toLocaleString('fr-FR')} relevée${dernier.stores > 1 ? 's' : ''}`;
  if (age <= 1) return `${boutiques} sous veille, dont ${lues} ${age <= 0 ? 'aujourd’hui' : 'hier'}. ${attente}`;
  const jour = new Date(`${dernier.day}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `${boutiques} sous veille ; leur dernier relevé date du ${jour}. Les alertes se calculent d’un jour sur l’autre : elles reprennent avec le prochain relevé.`;
}
