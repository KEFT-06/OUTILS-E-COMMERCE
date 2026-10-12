/** Petites mises en forme de texte, partagées par les écrans qui préremplissent des champs. */

/** Coupe à la fin d'un mot, avec des points de suspension, plutôt qu'au milieu. */
export function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.!?…–—-]+$/, '')}…`;
}

/**
 * Les `max` premiers mots d'un texte, en s'arrêtant à la fin d'une phrase quand il y en a une.
 * Sert aux voix off : un texte prérempli ne doit pas dépasser ce que la durée permet de dire.
 */
export function limitWords(text: string, max: number): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length <= max) return words.join(' ');
  const kept = words.slice(0, Math.max(1, max)).join(' ');
  const sentenceEnd = Math.max(kept.lastIndexOf('. '), kept.lastIndexOf('? '), kept.lastIndexOf('! '));
  // Une phrase entière vaut mieux qu'une phrase interrompue, tant qu'il en reste l'essentiel.
  return sentenceEnd > kept.length * 0.5 ? kept.slice(0, sentenceEnd + 1) : kept.replace(/[\s,;:–—-]+$/, '');
}
