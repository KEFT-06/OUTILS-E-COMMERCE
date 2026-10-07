import { type BookCoverText, canvasToBlob, composeBookCover, loadCoverImage } from '@/shared/lib/bookCover';
import { triggerDownload } from '@/shared/lib/download';
import { toFileSlug } from '@/shared/lib/pdfText';

/**
 * Compose la couverture d'un ouvrage — sur son illustration s'il en a une, typographique sinon —
 * telle qu'elle se voit à l'écran. Une illustration illisible ne prive pas de couverture : elle
 * devient typographique.
 */
export async function composeCoverFor(input: { imageUrl?: string | null; text: BookCoverText; seed: string }): Promise<HTMLCanvasElement> {
  const image = input.imageUrl ? await loadCoverImage(input.imageUrl).catch(() => null) : null;
  return composeBookCover(image, input.text, input.seed);
}

/** Télécharge la couverture en image, titre compris. */
export async function downloadBookCover(input: { imageUrl?: string | null; text: BookCoverText; seed: string }): Promise<void> {
  const canvas = await composeCoverFor(input);
  triggerDownload(await canvasToBlob(canvas), `${toFileSlug(input.text.title, 'livre')}-couverture.jpg`);
}
