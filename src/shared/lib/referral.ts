/**
 * Lien de parrainage suivi par ce visiteur.
 *
 * Deux niveaux, parce que retenir un parrainage sur l'appareil demande un accord :
 *   · PENDANT LA VISITE — le code vit en mémoire, rien n'est écrit. Si l'inscription a lieu
 *     maintenant, il part avec elle ;
 *   · RETENU — le visiteur a accepté : le code est gardé trente jours (cookie posé par le serveur,
 *     et une trace ici, avec sa date, qui dit quand il expire).
 */

const CLE = 'sc.parrain';
export const REFERRAL_CODE = /^[A-Za-z2-9]{6,12}$/;
const TRENTE_JOURS_MS = 30 * 86_400_000;

let suivi: string | null = null;

/** Code déjà retenu avec l'accord du visiteur, s'il n'a pas expiré. */
export function rememberedReferral(): string | null {
  try {
    const garde = JSON.parse(window.localStorage.getItem(CLE) ?? 'null') as { code?: unknown; at?: unknown } | null;
    if (!garde || typeof garde.code !== 'string' || typeof garde.at !== 'string') return null;
    if (Date.now() - new Date(garde.at).getTime() > TRENTE_JOURS_MS) {
      window.localStorage.removeItem(CLE);
      return null;
    }
    return REFERRAL_CODE.test(garde.code) ? garde.code : null;
  } catch {
    return null;
  }
}

/** Le visiteur vient d'arriver par ce lien : il vaut pour cette visite. */
export function followReferral(code: string): void {
  suivi = code.toUpperCase();
}

/** Le visiteur accepte qu'on retienne le parrainage : la trace locale accompagne le cookie. */
export function rememberReferral(code: string): void {
  try {
    window.localStorage.setItem(CLE, JSON.stringify({ code: code.toUpperCase(), at: new Date().toISOString() }));
  } catch {
    // Stockage indisponible : le cookie posé par le serveur suffit au rattachement.
  }
}

/** Code à joindre à une inscription faite maintenant : celui de la visite, sinon celui retenu. */
export function currentReferral(): string | null {
  return suivi ?? rememberedReferral();
}
