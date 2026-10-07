/**
 * La publicité dont on part pour créer la sienne.
 *
 * L'Espionnage la passe aux Créatifs dans l'état de navigation (« Créer ma vidéo à partir de
 * cette publicité »). Elle sert de repère sous les yeux : on reprend un angle, jamais le texte
 * ni les images d'un autre annonceur.
 */
export interface AdReference {
  annonceur: string;
  titre: string;
  texte: string;
  /** L'annonce d'origine est une vidéo (sinon une image). */
  video: boolean;
}

const texteDe = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Lit la référence dans l'état de navigation ; `null` quand on n'arrive pas d'une publicité. */
export function readAdReference(state: unknown): AdReference | null {
  const reference = (state as { reference?: unknown } | null)?.reference;
  if (!reference || typeof reference !== 'object') return null;
  const brut = reference as Record<string, unknown>;
  const annonceur = texteDe(brut.annonceur, 120);
  if (!annonceur) return null;
  return { annonceur, titre: texteDe(brut.titre, 160), texte: texteDe(brut.texte, 900), video: brut.video === true };
}
