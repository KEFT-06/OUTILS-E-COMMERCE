import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Mémoire des écrans : ce que chaque écran affichait la dernière fois, gardé le temps de la
 * visite (mémoire de l'onglet, rien sur le disque).
 *
 * Sans elle, revenir sur un écran déjà vu repartait d'un squelette et attendait le serveur,
 * à chaque fois. Avec elle, l'écran réaffiche aussitôt ce qu'il montrait, puis sa lecture
 * habituelle le met à jour : la donnée affichée n'est donc jamais plus vieille que la visite
 * précédente, et jamais laissée telle quelle.
 *
 * Vidée à chaque changement de compte (connexion, déconnexion, session expirée) : un écran
 * ne montre jamais ce qu'un autre compte a chargé dans le même onglet. Une réponse demandée
 * avant le changement et arrivée après n'est pas retenue non plus (voir `cacheEpoch`).
 */

/** Au-delà, les entrées les plus anciennes sont oubliées (filtres essayés puis abandonnés). */
const MAX_ENTRIES = 80;

const responses = new Map<string, unknown>();
/** Avance à chaque changement de compte. */
let epoch = 0;

/** Époque courante, à relever AVANT une lecture pour la passer à `remember` à son retour. */
export function cacheEpoch(): number {
  return epoch;
}

export function lastKnown<T>(key: string): T | null {
  return (responses.get(key) as T | undefined) ?? null;
}

/** `at` : époque relevée au départ de la lecture. Une réponse d'une autre époque est ignorée. */
export function remember(key: string, value: unknown, at: number = epoch): void {
  if (at !== epoch) return;
  // Réinsérée en fin de file : la plus récemment écrite est la dernière oubliée.
  responses.delete(key);
  if (value === null || value === undefined) return;
  responses.set(key, value);
  if (responses.size > MAX_ENTRIES) responses.delete(responses.keys().next().value as string);
}

export function forgetResponses(): void {
  responses.clear();
  epoch += 1;
}

/**
 * Remplace `useState<T | null>(null)` pour la donnée principale d'un écran : l'état démarre
 * sur la dernière valeur connue, et toute écriture (lecture du serveur ou mise à jour locale
 * après une action) est retenue pour la prochaine ouverture.
 *
 * `key` : l'adresse lue, paramètres compris. Quand elle change (un filtre), la valeur affichée
 * reste en place jusqu'à la réponse suivante, comme avec un état ordinaire.
 *
 * Troisième valeur, `keep` : retient une réponse sans toucher à l'état. Pour les lectures qui
 * n'écrivent plus l'état une fois l'écran quitté (`if (!cancelled) set…`) : sur une connexion
 * lente, la réponse d'un écran quitté trop tôt sert quand même à sa prochaine ouverture.
 */
export function useCachedState<T>(key: string): [T | null, Dispatch<SetStateAction<T | null>>, (value: T | null) => void] {
  const [value, setValue] = useState<T | null>(() => lastKnown<T>(key));
  // Époque du compte sous lequel l'écran s'est ouvert.
  const [born] = useState(cacheEpoch);

  const keep = useCallback((next: T | null) => remember(key, next, born), [key, born]);

  const set = useCallback<Dispatch<SetStateAction<T | null>>>(
    (next) => {
      if (typeof next !== 'function') {
        // Retenue tout de suite, même si l'écran a été quitté avant la réponse.
        remember(key, next, born);
        setValue(next);
        return;
      }
      setValue((previous) => {
        const resolved = (next as (current: T | null) => T | null)(previous);
        remember(key, resolved, born);
        return resolved;
      });
    },
    [key, born],
  );

  return [value, set, keep];
}
