/**
 * Marque blanche : un utilisateur ne voit jamais le nom des fournisseurs qui font tourner le
 * service (rédaction, recherche, images, vidéos, mise en page, collecte publicitaire).
 *
 * Les messages ont été écrits sans ces noms. Ce module est le FILET : un message qui en
 * contiendrait encore un (texte d'un fournisseur relayé, message ajouté plus tard) est
 * neutralisé avant de partir, ainsi que le code d'erreur, visible dans le navigateur.
 *
 * Deux exceptions, voulues : l'administration, qui doit savoir quel service est en panne, et
 * la connexion avec Google, que l'utilisateur choisit lui-même et reconnaît.
 */

const NAMES = 'Gemini|Perplexity|Gamma|Apify|Cloudflare|Workers AI|fal\\.ai|Veo|Higgsfield|Nano Banana(?: Pro)?|Kling|FLUX(?:\\.\\d)?';

const CHEZ = new RegExp(`\\s+chez\\s+(?:Google|${NAMES})\\b`, 'gi');
const APRES_PREPOSITION = new RegExp(`\\b(de|du|à|au)\\s+(?:${NAMES})\\b`, 'gi');
const NOM = new RegExp(`\\b(?:${NAMES})\\b`, 'gi');
const TEST = new RegExp(`\\b(?:${NAMES})\\b|chez\\s+Google`, 'i');

/** Message sans nom de fournisseur, en gardant une phrase lisible. */
export function neutralizeMessage(message: string): string {
  if (!TEST.test(message)) return message;
  const neutre = message
    .replace(CHEZ, '')
    .replace(APRES_PREPOSITION, (_all, preposition: string) => (preposition.toLowerCase() === 'à' || preposition.toLowerCase() === 'au' ? 'au service' : 'du service'))
    .replace(NOM, 'le service')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return neutre.charAt(0).toUpperCase() + neutre.slice(1);
}

/** Préfixes de codes qui nomment un fournisseur, et leur équivalent neutre. */
const CODE_PREFIXES: [RegExp, string][] = [
  [/^GEMINI_IMAGE_/, 'IMAGE_'],
  [/^CF_IMAGE_/, 'IMAGE_'],
  [/^GEMINI_/, 'SERVICE_'],
  [/^GAMMA_/, 'LAYOUT_'],
  [/^FAL_/, 'VIDEO_'],
  [/^VEO_/, 'VIDEO_'],
  [/^PERPLEXITY_/, 'RESEARCH_'],
  [/^APIFY_/, 'AD_LIBRARY_'],
];

export function neutralizeCode(code: string): string {
  for (const [prefix, replacement] of CODE_PREFIXES) if (prefix.test(code)) return code.replace(prefix, replacement);
  return code;
}

/** Les routes où les noms restent : l'administration, et la connexion avec Google. */
export const keepsProviderNames = (path: string) => path.startsWith('/api/admin') || path.startsWith('/api/auth');
