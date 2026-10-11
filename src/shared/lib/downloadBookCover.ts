import { type BookCoverText, canvasToBlob, composeBookCover, loadCoverImage } from '@/shared/lib/bookCover';
import { triggerDownload } from '@/shared/lib/download';
import { toFileSlug } from '@/shared/lib/pdfText';

/**
 * Compose la couverture d'un ouvrage telle qu'elle se voit à l'écran : sa couverture complète
 * posée sur la page, son illustration sous le titre, ou une couverture typographique. Une illustration illisible ne prive pas de couverture : elle
 * devient typographique.
 */
export async function composeCoverFor(input: { imageUrl?: string | null; complete?: boolean; text: BookCoverText; seed: string }): Promise<HTMLCanvasElement> {
  const image = input.imageUrl ? await loadCoverImage(input.imageUrl).catch(() => null) : null;
  return composeBookCover(image, input.text, input.seed, Boolean(input.complete && image));
}

/** Télécharge la couverture en image, titre compris. */
export async function downloadBookCover(input: { imageUrl?: string | null; complete?: boolean; text: BookCoverText; seed: string }): Promise<void> {
  if (input.complete && input.imageUrl) {
    // Couverture complète : le fichier d'origine, dans toute sa définition, sans le recomposer.
    const response = await fetch(input.imageUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('La couverture n’a pas pu être chargée.');
    const file = await response.blob();
    triggerDownload(file, `${toFileSlug(input.text.title, 'livre')}-couverture.${file.type === 'image/png' ? 'png' : 'jpg'}`);
    return;
  }
  const canvas = await composeCoverFor(input);
  triggerDownload(await canvasToBlob(canvas), `${toFileSlug(input.text.title, 'livre')}-couverture.jpg`);
}
