/**
 * Lit un montant tel qu'un utilisateur d'Afrique francophone ou anglophone le tape.
 *
 * Trois champs du site avaient chacun leur propre lecture, et toutes les trois se trompaient
 * sur les écritures les plus courantes du marché visé :
 *
 *   « 50 000 »   → 50       parseFloat s'arrête au premier espace ;
 *   « 50.000 »   → 50       le point y est pris pour une virgule décimale ;
 *   « 1.500,50 » → illisible.
 *
 * Or « 50.000 FCFA » et « 50 000 FCFA » sont les deux façons ordinaires d'écrire cinquante
 * mille francs. Un montant mille fois trop petit, lu en silence, est pire qu'un refus : le
 * budget d'une campagne, ou un paiement enregistré par l'administration, part faux sans que
 * personne ne le voie.
 *
 * LES RÈGLES, dans l'ordre :
 *  1. espaces (y compris insécables) et devise en tête ou en fin sont retirés — « 50 000 FCFA » ;
 *  2. si point ET virgule apparaissent, le DERNIER des deux est la marque décimale — c'est
 *     vrai en français (1.500,50) comme en anglais (1,500.50) ;
 *  3. un seul type de séparateur suivi de groupes d'EXACTEMENT trois chiffres est un
 *     séparateur de milliers — « 50.000 », « 1,500,000 » ;
 *  4. sinon, c'est une marque décimale — « 1,5 », « 12.50 ».
 *
 * La règle 3 tranche un cas réellement ambigu (« 1.500 » peut vouloir dire un et demi) dans le
 * sens du marché : trois décimales n'ont pas de sens pour un montant en francs CFA, qui n'a pas
 * de sous-unité en usage, alors que le point des milliers y est partout.
 *
 * Tout ce qui ne se lit pas proprement renvoie `null` plutôt qu'un nombre approximatif : une
 * lettre au milieu, deux marques décimales, une notation scientifique.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;

  const texte = raw
    .replace(/[\s\u00a0\u202f]/g, '')
    // Devise en tête ou en fin : « FCFA », « XAF », « € », « $ », « F »… jamais au milieu.
    .replace(/^[a-z€$£%+]+/i, '')
    .replace(/[a-z€$£%]+$/i, '');

  if (!texte || /[^0-9.,-]/.test(texte) || texte.lastIndexOf('-') > 0) return null;

  const signe = texte.startsWith('-') ? '-' : '';
  let corps = signe ? texte.slice(1) : texte;
  const dernierPoint = corps.lastIndexOf('.');
  const derniereVirgule = corps.lastIndexOf(',');

  if (dernierPoint >= 0 && derniereVirgule >= 0) {
    const decimale = dernierPoint > derniereVirgule ? '.' : ',';
    const milliers = decimale === '.' ? ',' : '.';
    const [entier = '', ...reste] = corps.split(decimale);
    if (reste.length !== 1) return null;
    // Les milliers ne peuvent être que dans la partie entière, par groupes de trois.
    const groupes = entier.split(milliers);
    if (groupes.slice(1).some((groupe) => groupe.length !== 3)) return null;
    corps = `${groupes.join('')}.${reste[0]}`;
  } else if (dernierPoint >= 0 || derniereVirgule >= 0) {
    const separateur = dernierPoint >= 0 ? '.' : ',';
    const parties = corps.split(separateur);
    const [tete = ''] = parties;
    const milliers =
      parties.length > 1 && parties.slice(1).every((partie) => partie.length === 3) && tete.length >= 1 && tete.length <= 3 && tete !== '0';
    if (milliers) corps = parties.join('');
    else if (parties.length === 2) corps = parties.join('.');
    else return null;
  }

  if (!/^\d+(\.\d+)?$/.test(corps)) return null;
  const valeur = Number(`${signe}${corps}`);
  return Number.isFinite(valeur) ? valeur : null;
}
