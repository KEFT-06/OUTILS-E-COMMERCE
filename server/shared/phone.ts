/**
 * Numéros de téléphone, tels que les gens les tapent : avec des espaces, un « + », un « 00 », ou
 * sans l'indicatif du pays. Module pur, partagé avec le site.
 */

/**
 * Le numéro au format international, en chiffres seulement (sans « + »), ou `null` s'il ne peut
 * pas en être un.
 *
 * L'indicatif est ajouté quand il manque. Le zéro initial d'un numéro local n'est PAS retiré : il
 * fait partie du numéro dans plusieurs pays (Côte d'Ivoire : +225 07…, Bénin : +229 01…), et
 * l'enlever enverrait la demande de paiement à quelqu'un d'autre.
 */
export function internationalNumber(input: string, prefix: string): string | null {
  const dial = prefix.replace(/\D/g, '');
  let digits = input.trim();
  const explicit = /^(\+|00)/.test(digits);
  digits = digits.replace(/^(\+|00)/, '').replace(/\D/g, '');
  if (!digits) return null;
  // Écrit avec « + » ou « 00 » : l'indicatif y est déjà, quel qu'il soit.
  const full = explicit || (dial && digits.startsWith(dial) && digits.length > dial.length + 6) ? digits : `${dial}${digits}`;
  // Recommandation E.164 : quinze chiffres au plus ; en dessous de huit, ce n'est pas un numéro de mobile.
  return full.length >= 8 && full.length <= 15 ? full : null;
}

/** Ce qu'on garde d'un numéro pour le reconnaître sans le conserver : ses deux derniers chiffres. */
export function phoneHint(international: string): string {
  return `•••• ${international.slice(-2)}`;
}
