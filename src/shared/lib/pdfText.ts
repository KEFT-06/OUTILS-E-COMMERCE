/**
 * Utilitaires de texte communs aux exports PDF.
 */

/** Texte imprimable par les polices standard : règle partagée avec le PDF des contes, assemblé par le serveur. */
export { toPdfSafe } from '@server/shared/pdfText';

/** Raccourcit un libellé trop long pour une ligne, en évitant de couper un mot. */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/** Nom de fichier sûr : sans accents, sans espaces ni caractères spéciaux. */
export function toFileSlug(text: string, fallback: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

  return slug || fallback;
}
