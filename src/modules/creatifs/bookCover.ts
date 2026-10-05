/**
 * Couverture de livre composée : l'illustration, puis le titre posé par la mise en page.
 *
 * L'illustration est produite SANS texte — un modèle d'image écrit les titres en caractères
 * inventés. Le titre, le sous-titre et le nom de l'auteur sont donc tracés ici, avec la police
 * du site et les vrais accents, sur le tiers supérieur que l'illustration laisse dégagé.
 *
 * Le rapport est celui d'une page A4 ou A5 : la même couverture que celle du PDF de l'ebook.
 */

export interface BookCoverText {
  title: string;
  subtitle?: string;
  author?: string;
}

/** Hauteur d'une page de la série A pour une largeur de 1. */
const PAGE_RATIO = Math.SQRT2;
const FONT_STACK = '"Outfit Variable", "Plus Jakarta Sans Variable", ui-sans-serif, system-ui, sans-serif';
/** Bleu nuit du bandeau de titre des exports. */
const INK = '15, 23, 42';

const font = (weight: number, size: number) => `${weight} ${Math.round(size)}px ${FONT_STACK}`;

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const attempt = line ? `${line} ${word}` : word;
    if (line && context.measureText(attempt).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = attempt;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Garde `max` lignes ; la dernière se termine par des points de suspension si le texte déborde. */
function clamp(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1]!.replace(/[\s,;:.]+$/, '')}…`;
  return kept;
}

export async function loadCoverImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  return image;
}

export async function composeBookCover(image: HTMLImageElement, text: BookCoverText): Promise<HTMLCanvasElement> {
  // La police du site peut ne pas être encore chargée : sans elle, le canevas écrirait en police de secours.
  await document.fonts?.load(font(800, 64)).catch(() => undefined);

  const width = image.naturalWidth;
  const height = Math.round(width * PAGE_RATIO);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('La couverture n’a pas pu être composée.');

  // L'illustration couvre toute la page, recadrée autour de son centre.
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);

  const margin = width * 0.08;
  const textWidth = width - margin * 2;

  // Le titre prend la plus grande taille qui tient en trois lignes.
  const title = text.title.trim();
  let titleSize = width * 0.1;
  let titleLines: string[] = [];
  for (; ; titleSize *= 0.92) {
    context.font = font(800, titleSize);
    titleLines = wrap(context, title, textWidth);
    if (titleLines.length <= 3 || titleSize <= width * 0.058) break;
  }
  titleLines = clamp(titleLines, 5);
  const titleLeading = titleSize * 1.1;

  const subtitleSize = width * 0.036;
  context.font = font(500, subtitleSize);
  const subtitleLines = clamp(wrap(context, text.subtitle?.trim() ?? '', textWidth), 4);
  const subtitleLeading = subtitleSize * 1.4;

  const top = height * 0.075;
  const accentHeight = width * 0.012;
  const titleTop = top + accentHeight + width * 0.045;
  const blockBottom = titleTop + titleLines.length * titleLeading + (subtitleLines.length > 0 ? width * 0.02 + subtitleLines.length * subtitleLeading : 0);

  // Voile sombre derrière le texte : plein sous le titre, fondu dans l'illustration ensuite.
  const veilEnd = Math.min(height, blockBottom + height * 0.16);
  const veil = context.createLinearGradient(0, 0, 0, veilEnd);
  veil.addColorStop(0, `rgba(${INK}, 0.94)`);
  veil.addColorStop(Math.min(0.95, blockBottom / veilEnd), `rgba(${INK}, 0.78)`);
  veil.addColorStop(1, `rgba(${INK}, 0)`);
  context.fillStyle = veil;
  context.fillRect(0, 0, width, veilEnd);

  context.textBaseline = 'top';
  context.fillStyle = '#ffffff';
  context.fillRect(margin, top, width * 0.12, accentHeight);

  context.font = font(800, titleSize);
  titleLines.forEach((line, index) => context.fillText(line, margin, titleTop + index * titleLeading));

  if (subtitleLines.length > 0) {
    context.font = font(500, subtitleSize);
    context.fillStyle = 'rgba(226, 232, 240, 0.96)';
    const subtitleTop = titleTop + titleLines.length * titleLeading + width * 0.02;
    subtitleLines.forEach((line, index) => context.fillText(line, margin, subtitleTop + index * subtitleLeading));
  }

  const author = text.author?.trim();
  if (author) {
    const authorSize = width * 0.038;
    const foot = context.createLinearGradient(0, height * 0.82, 0, height);
    foot.addColorStop(0, `rgba(${INK}, 0)`);
    foot.addColorStop(1, `rgba(${INK}, 0.88)`);
    context.fillStyle = foot;
    context.fillRect(0, height * 0.82, width, height * 0.18);
    context.font = font(600, authorSize);
    context.fillStyle = '#ffffff';
    context.textBaseline = 'alphabetic';
    context.fillText(clamp(wrap(context, author, textWidth), 1)[0] ?? '', margin, height - height * 0.05);
  }

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('La couverture n’a pas pu être enregistrée.'))), 'image/jpeg', 0.93);
  });
}
