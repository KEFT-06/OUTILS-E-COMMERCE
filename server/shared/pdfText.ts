/**
 * Texte imprimable par les polices standard de jsPDF : règle commune au navigateur (exports PDF)
 * et au serveur (PDF des contes).
 */

/**
 * Les polices standard de jsPDF n'impriment que la page de code Windows-1252. Pire qu'un
 * signe manquant : dès qu'UN caractère hors de cette table apparaît, jsPDF encode toute la
 * ligne sur deux octets, et c'est la ligne ENTIÈRE qui sort illisible (vérifié sur jsPDF :
 * « ŋ ok » y devient « \u0001K\u0000 \u0000o\u0000k »).
 *
 * L'ancien filtre laissait passer tout le latin étendu (jusqu'à U+024F) : « ŋ », « ā »,
 * « ğ »… — courants dans un nom propre ou une traduction — corrompaient la ligne où ils
 * tombaient. On garde désormais exactement Windows-1252 ; les espaces fines insécables du
 * formatage français (« 50 000 ») deviennent des espaces au lieu de coller les chiffres.
 */
const WINDOWS_1252_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const ESPACES = /[\u2000-\u200a\u202f\u205f]/g;

export function toPdfSafe(text: string): string {
  return [...text.replace(ESPACES, ' ')]
    .filter((char) => {
      const code = char.charCodeAt(0);
      if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
      if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return false;
      return code <= 0xff || WINDOWS_1252_EXTRAS.includes(char);
    })
    .join('');
}
