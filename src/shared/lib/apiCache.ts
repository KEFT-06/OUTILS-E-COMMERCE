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
export const MAX_ENTRIES = 240;

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

/** Ce que l'utilisateur faisait sur un écran se range à part des réponses du serveur. */
const screenKey = (key: string) => `écran:${key}`;

/**
 * Remplace `useState(initial)` pour ce que l'utilisateur FAIT sur un écran : une saisie en cours,
 * un filtre, un onglet, l'ouvrage ouvert, un résultat affiché.
 *
 * Demande du propriétaire, 11/10/2026 : « si un utilisateur sort d'un module il doit pouvoir
 * revenir et retrouver ce qu'il faisait, et non une page blanche ». Mesuré ce jour-là : sur seize
 * modules, neuf perdaient quelque chose quand on sortait par le menu et qu'on revenait — la niche
 * tapée, le lien d'une boutique, le mot-clé d'une recherche, le brief d'un conte, un filtre, un
 * onglet. Chaque écran repartait de ses valeurs de départ, parce qu'il les gardait pour lui seul.
 *
 * Même mémoire que celle des réponses : celle de l'onglet, vidée au changement de compte. La
 * valeur est rangée dans une enveloppe, pour qu'un champ vidé ou une case décochée se retienne
 * aussi — « rien » est un choix comme un autre.
 */
export function useScreenMemory<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const known = lastKnown<{ v: T }>(screenKey(key));
    if (known) return known.v;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  const [born] = useState(cacheEpoch);
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValue((previous) => {
        const resolved = typeof next === 'function' ? (next as (current: T) => T)(previous) : next;
        remember(screenKey(key), { v: resolved }, born);
        return resolved;
      });
    },
    [key, born],
  );
  return [value, set];
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
