import { z } from 'zod';
import { askGroq, groqConfigured } from '@server/services/ai/groq';
import type { ImageResult } from '@server/services/ai/imageTypes';
import type { CoverDesign } from '@server/services/covers/design';

/**
 * Relecture d'une couverture rendue, avant qu'elle parte chez son auteur.
 *
 * Le moteur d'images écrit ce qu'on lui cite, et la plupart du temps sans faute. Pas toujours :
 * sur trois couvertures rendues le 08/10/2026, les trois titres étaient exacts, mais l'une portait
 * un panneau d'école que personne n'avait demandé, couvert d'un texte inventé. Une couverture se
 * montre pour vendre : un mot faux dessus, et l'auteur a payé pour une image qu'il ne peut pas
 * utiliser. Le relecteur lit donc l'image rendue et la compare à la commande ; un défaut fait
 * refaire le rendu une fois, en le nommant.
 *
 * Son silence ne bloque rien : sans relecture, la couverture part telle qu'elle a été rendue.
 */

export interface CoverProof {
  /** Le titre de la première de couverture est-il celui commandé, mot pour mot ? */
  titleCorrect: boolean;
  /** Textes commandés rendus avec une faute, tels qu'ils se lisent sur l'image. */
  misspelled: string[];
  /** Ce qui s'y lit et que personne n'a commandé. */
  stray: string[];
}

export const COVER_PROOF_SYSTEM = [
  'You proofread book covers before they are delivered to their authors, who use them to sell their work. You are shown one rendered cover — a hardcover book in 3D — and the list of texts that were ordered for it. An image model painted those texts. It usually copies them faithfully, but it sometimes changes a letter, drops an accent, or adds writing that nobody ordered: a sign in the photograph, a slogan, a number, a code to scan.',
  '',
  'Read every piece of writing on the cover, small print included, and compare it with the order. Then report:',
  '- titleCorrect: whether the title on the front cover reads exactly as ordered, word for word and accent for accent. Line breaks, letter case, and the difference between a straight and a curly apostrophe do not matter.',
  '- misspelled: each ordered text that appears with a wrong, missing or extra letter, accent or word. Quote it as it appears on the cover.',
  '- stray: each piece of legible writing that is not in the order. The title repeated along the spine is expected and is not stray. Marks too blurred or too small to be read as words are not writing: leave them out.',
  '',
  'The author cannot use a cover with a wrong word on it, so be exact. Equally, a second rendering costs time and money, so report only what you can actually read: when you are not sure a mark is writing, or not sure a letter is wrong, do not report it.',
].join('\n');

export const COVER_PROOF_SCHEMA = {
  type: 'object',
  properties: {
    titleCorrect: { type: 'boolean' },
    misspelled: { type: 'array', items: { type: 'string' } },
    stray: { type: 'array', items: { type: 'string' } },
  },
  required: ['titleCorrect', 'misspelled', 'stray'],
  additionalProperties: false,
};

const lines = z
  .array(z.string().catch(''))
  .catch([])
  .transform((values) =>
    values
      .map((value) => value.replace(/\s+/g, ' ').trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 8),
  );
const proofSchema = z.object({ titleCorrect: z.boolean().catch(true), misspelled: lines, stray: lines });

/** La commande, telle que le relecteur la reçoit. Fonction pure. */
export function orderedTexts(design: CoverDesign): string {
  const quote = (value: string) => `"${value}"`;
  return [
    'Ordered texts:',
    `- Title: ${quote(design.titleLines.map((line) => line.text).join(' '))}`,
    ...(design.label ? [`- Label above the title: ${quote(design.label)}`] : []),
    ...(design.tagline ? [`- Tagline: ${quote(design.tagline)}`] : []),
    ...design.benefits.map((benefit) => `- Benefit: ${quote(benefit.text)}`),
    ...(design.seal ? [`- Seal: ${quote(design.seal)}`] : []),
    ...design.footer.map((claim) => `- Bottom strip: ${quote(claim.text)}`),
  ].join('\n');
}

/** Un mot inventé compte s'il se lit vraiment : quatre lettres au moins. */
const legible = (value: string) => value.replace(/[^\p{L}]/gu, '').length >= 4;

/** Poids des défauts d'une couverture : 0, elle part telle quelle. Fonction pure. */
export function proofScore(proof: CoverProof): number {
  return (proof.titleCorrect ? 0 : 10) + proof.misspelled.length * 2 + proof.stray.filter(legible).length;
}

/** Ce qu'il faut dire au moteur d'images pour le second rendu. Fonction pure. */
export function correctionNote(proof: CoverProof): string {
  const quote = (values: string[]) => values.map((value) => `"${value.replace(/"/g, '')}"`).join(', ');
  const stray = proof.stray.filter(legible);
  return [
    'CORRECTION — an earlier rendering of this cover was rejected. Avoid its defects:',
    ...(proof.titleCorrect ? [] : ['- the title was not spelled exactly as ordered: copy it letter by letter;']),
    ...(proof.misspelled.length > 0 ? [`- these texts were misspelled: ${quote(proof.misspelled)}; copy each ordered text letter by letter;`] : []),
    ...(stray.length > 0 ? [`- this writing was added and must not appear: ${quote(stray)}; keep every sign, board, screen and document in the picture blank, or leave it out.`] : []),
  ].join('\n');
}

const mimeOf = (image: ImageResult) => (image.mimeType === 'image/png' ? 'image/png' : image.mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg');

/** Au-delà, l'image ne passe pas en pièce jointe : elle part sans relecture. */
const PROOF_MAX_BYTES = 3_600_000;
const ATTEMPT_MS = 40_000;

/** Relit la couverture rendue. `null` : pas de relecture possible — la couverture part telle quelle. Ne lève jamais. */
export async function proofreadCover(image: ImageResult, design: CoverDesign, timeoutMs = ATTEMPT_MS): Promise<CoverProof | null> {
  if (!groqConfigured() || image.bytes.length > PROOF_MAX_BYTES) return null;
  try {
    const answer = await askGroq({
      system: COVER_PROOF_SYSTEM,
      prompt: orderedTexts(design),
      images: [{ mimeType: mimeOf(image), bytes: image.bytes }],
      maxTokens: 4000,
      timeoutMs,
      // Un seul essai : le temps de la couverture est compté, et sans relecture elle part quand même.
      retries: 0,
      jsonSchema: COVER_PROOF_SCHEMA,
    });
    return proofSchema.parse(JSON.parse(answer));
  } catch {
    return null;
  }
}
