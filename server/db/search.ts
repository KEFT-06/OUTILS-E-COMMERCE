import { or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Recherche insensible à la casse ET aux accents, sur une ou plusieurs colonnes texte.
 *
 * `ilike` seul ignore la casse mais pas les accents : « Aicha » ne trouvait pas « Aïcha »,
 * « Adje » ne trouvait pas « Adjé » — les prénoms les plus courants du public visé. Le
 * motif est plié côté serveur (NFD, diacritiques retirés) et chaque colonne l'est en SQL
 * par `translate`, fonction native de PostgreSQL. L'extension `unaccent` aurait été plus
 * complète, mais elle doit être installée sur la base — ce qu'on ne contrôle pas chez
 * l'hébergeur, et que la base embarquée de développement n'a pas.
 *
 * Les deux chaînes vont de pair, caractère pour caractère : les modifier ensemble ou pas du
 * tout. Minuscules seulement, la colonne étant passée par `lower` avant. Les ligatures « œ »
 * et « æ » en sont exclues à dessein : `translate` remplace un caractère par UN seul, si bien
 * que « cœur » deviendrait « cour » — et une recherche sur « cour » trouverait le cœur.
 * Mieux vaut ne pas plier que plier faux.
 */
const ACCENTUEES = 'àâäáãåéèêëíìîïóòôöõúùûüýÿçñ';
const SANS_ACCENT = 'aaaaaaeeeeiiiiooooouuuuyycn';

export const sansAccents = (valeur: string) => valeur.normalize('NFD').replace(/\p{M}/gu, '');

/** Condition « une des colonnes contient le texte », sans tenir compte des accents ni de la casse. */
export function containsIgnoringAccents(columns: AnyColumn[], search: string): SQL {
  // `%` et `_` sont les jokers de LIKE, l'antislash leur échappement : tous trois sont retirés.
  // Une saisie finissant par « \ » échappait sinon le « % » final et ne trouvait plus rien.
  const motif = `%${sansAccents(search).toLowerCase().replace(/[\\%_]/g, '')}%`;
  const plier = (colonne: AnyColumn) => sql`translate(lower(${colonne}), ${ACCENTUEES}, ${SANS_ACCENT})`;
  return or(...columns.map((colonne) => sql`${plier(colonne)} like ${motif}`))!;
}
