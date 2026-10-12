import { dialCodeOf } from './dialCodes';

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

/**
 * Le numéro d'un compte, tel qu'il est enregistré : « + », puis l'indicatif et le numéro, sans
 * espace. `null` quand la saisie ne peut pas être un numéro.
 *
 * Sans pays connu, le numéro doit porter lui-même son indicatif (« + » ou « 00 ») : on ne devine
 * pas le pays de quelqu'un.
 */
export function accountPhone(input: string, country: string | null | undefined): string | null {
  const dial = dialCodeOf(country);
  if (!dial && !/^\s*(\+|00)/.test(input)) return null;
  const digits = internationalNumber(input, dial);
  return digits ? `+${digits}` : null;
}

/** Le numéro tel qu'on le lit : indicatif, puis le reste par groupes de deux ou trois chiffres. */
export function formatPhone(phone: string | null | undefined, country?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const dial = dialCodeOf(country);
  const local = dial && digits.startsWith(dial) && digits.length > dial.length + 5 ? digits.slice(dial.length) : null;
  const grouped = (value: string) => (value.length % 2 === 1 ? [value.slice(0, 3), ...(value.slice(3).match(/.{1,2}/g) ?? [])] : (value.match(/.{1,2}/g) ?? [])).join(' ');
  return local ? `+${dial} ${grouped(local)}` : `+${grouped(digits)}`;
}
