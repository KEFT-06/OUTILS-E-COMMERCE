import { searchKey } from '@server/shared/countries';

/**
 * Rangement automatique d'une niche ajoutée par l'utilisateur dans le catalogue qui lui convient.
 *
 * Le rapprochement se fait sur les mots, sans appel extérieur : il est instantané, gratuit, et
 * donne le même résultat à chaque fois. Les mots sont comparés sur leur racine (« diabétique »
 * rejoint « diabète », « poulets » rejoint « poulet ») ; les mots vides (« pour », « avec »…) ne
 * comptent pas.
 *
 * C'est le mot le plus SPÉCIFIQUE qui décide. Un mot présent dans beaucoup de catalogues ne dit
 * rien du sujet : mesuré contre le vrai catalogue, « Gestion du diabète au quotidien » partait
 * dans « Business » à cause de « gestion », que quinze secteurs emploient. Chaque mot pèse donc
 * d'autant moins qu'il est répandu.
 *
 * Aucune correspondance : rien n'est deviné. L'écran range alors la niche dans le catalogue
 * personnel de l'utilisateur.
 */

export interface MatchableCatalog {
  id: string;
  label: string;
  description?: string;
  niches: readonly string[];
  /** Catalogue créé par l'utilisateur : s'il porte le sujet dans son nom, il passe devant les secteurs du site. */
  own?: boolean;
}

const STOP_WORDS = new Set(
  'a au aux avec ce ces chez comment dans de des du elle en et il la le les leur leurs ma mes mon ne nos notre ou par pas plus pour qu que qui sa sans se ses son sur ta tes ton tout tous toute toutes un une vos votre vous y bien faire etre avoir soi entre vers depuis pendant quand tres aussi comme sous'.split(
    ' ',
  ),
);

/**
 * Racine d'un mot : ses six premières lettres, sans le pluriel. Assez pour rapprocher les formes
 * d'un même mot (« diabétique », « diabète ») ; cinq lettres confondaient « Chariow » et
 * « charisme », et rangeaient une niche de vente en ligne dans le développement personnel.
 */
function stem(word: string): string {
  // « Vendre », « vente » et « vendeur » sont le même sujet, et c'est celui du site : ils se rejoignent.
  if (/^(vend|vente)/.test(word)) return 'vend';
  const singular = word.length > 4 ? word.replace(/(s|x)$/, '') : word;
  return singular.slice(0, 6);
}

function stems(text: string): string[] {
  return searchKey(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
    .map(stem);
}

interface Indexed {
  heading: Set<string>;
  /** Nombre de niches du catalogue qui portent chaque racine. */
  members: Map<string, number>;
}

interface Index {
  catalogs: Indexed[];
  /** Nombre de catalogues où chaque racine apparaît. */
  spread: Map<string, number>;
}

/** L'index d'un catalogue ne change pas tant que la liste est la même : il n'est calculé qu'une fois. */
const indexes = new WeakMap<readonly MatchableCatalog[], Index>();

function indexOf(catalogs: readonly MatchableCatalog[]): Index {
  const known = indexes.get(catalogs);
  if (known) return known;
  const spread = new Map<string, number>();
  const indexed = catalogs.map((catalog) => {
    const heading = new Set(stems(`${catalog.label} ${catalog.description ?? ''}`));
    const members = new Map<string, number>();
    for (const niche of catalog.niches) {
      for (const word of new Set(stems(niche))) members.set(word, (members.get(word) ?? 0) + 1);
    }
    for (const word of new Set([...heading, ...members.keys()])) spread.set(word, (spread.get(word) ?? 0) + 1);
    return { heading, members };
  });
  const index = { catalogs: indexed, spread };
  indexes.set(catalogs, index);
  return index;
}

/** Catalogue le plus proche d'une niche, ou null si aucun mot ne s'y retrouve. */
export function suggestCatalog<T extends MatchableCatalog>(niche: string, catalogs: readonly T[]): T | null {
  const wanted = [...new Set(stems(niche))];
  if (wanted.length === 0) return null;
  const { catalogs: indexed, spread } = indexOf(catalogs);

  let best: T | null = null;
  let bestScore = 0;
  /** Catalogue de l'utilisateur dont le NOM porte un mot de la niche : il l'a créé pour cela. */
  let bestOwn: T | null = null;
  let bestOwnScore = 0;
  indexed.forEach((entry, position) => {
    let score = 0;
    for (const word of wanted) {
      // Dans le nom ou la description : le catalogue se réclame du sujet. Dans trois niches : il le traite.
      const hits = (entry.heading.has(word) ? 3 : 0) + Math.min(3, entry.members.get(word) ?? 0);
      if (hits > 0) score += hits / (spread.get(word) ?? 1) ** 2;
    }
    if (score > bestScore) {
      best = catalogs[position]!;
      bestScore = score;
    }
    if (catalogs[position]!.own && score > bestOwnScore && wanted.some((word) => entry.heading.has(word))) {
      bestOwn = catalogs[position]!;
      bestOwnScore = score;
    }
  });
  return bestOwn ?? best;
}
