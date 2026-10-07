/**
 * Couverture de livre : un seul dessin, pour l'écran, le fichier à télécharger et le PDF.
 *
 * Tout ouvrage a une couverture, avec son titre dessus. S'il a une illustration, le titre est
 * posé sur elle ; sinon la couverture est typographique — un fond de reliure, un filet, le titre.
 * Aucune image « d'attente » ni image sans rapport : ce qui tient lieu de couverture EST une
 * couverture (demande du propriétaire, 06/10/2026).
 *
 * L'illustration est produite SANS texte — un modèle d'image écrit les titres en caractères
 * inventés. Titre, sous-titre et auteur sont donc tracés ici, avec la police du site et les vrais
 * accents. Le rapport est celui d'une page A4 ou A5.
 */

export interface BookCoverText {
  title: string;
  subtitle?: string;
  author?: string;
  /** Nature de l'ouvrage, en petites capitales au-dessus du titre : « Ebook », « Guide »… */
  label?: string;
}

export interface CoverPalette {
  /** Fond de la reliure. */
  background: string;
  /** Filet et reflets. */
  accent: string;
}

/** Reliures sobres : assez sombres pour porter un titre blanc, assez différentes pour distinguer deux ouvrages. */
export const COVER_PALETTES: readonly CoverPalette[] = [
  { background: '#0f172a', accent: '#34d399' },
  { background: '#14312b', accent: '#fbbf24' },
  { background: '#3b0d1e', accent: '#fda4af' },
  { background: '#1e1b4b', accent: '#a5b4fc' },
  { background: '#0c2f3f', accent: '#67e8f9' },
  { background: '#3a1f0b', accent: '#fdba74' },
  { background: '#2a1438', accent: '#e9a8ff' },
  { background: '#1f2937', accent: '#f9fafb' },
];

/** La reliure d'un ouvrage : toujours la même pour le même ouvrage. */
export function coverPalette(seed: string): CoverPalette {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return COVER_PALETTES[hash % COVER_PALETTES.length]!;
}

/** Taille du titre, en fraction de la largeur de la couverture, selon sa longueur. */
export function coverTitleScale(title: string): number {
  const length = title.trim().length;
  if (length <= 28) return 0.1;
  if (length <= 55) return 0.084;
  if (length <= 85) return 0.072;
  return 0.062;
}

/** Hauteur d'une page de la série A pour une largeur de 1. */
export const COVER_RATIO = Math.SQRT2;
/** Largeur minimale de la couverture composée, en pixels. */
const MIN_WIDTH = 1600;
const FONT_STACK = '"Outfit Variable", "Plus Jakarta Sans Variable", ui-sans-serif, system-ui, sans-serif';
/** Bleu nuit du voile posé sur une illustration. */
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

/**
 * Compose la couverture. `image` : l'illustration, ou null pour une couverture typographique ;
 * `seed` : ce qui identifie l'ouvrage, pour lui donner toujours la même reliure.
 */
export async function composeBookCover(image: HTMLImageElement | null, text: BookCoverText, seed = text.title): Promise<HTMLCanvasElement> {
  // La police du site peut ne pas être encore chargée : sans elle, le canevas écrirait en police de secours.
  await document.fonts?.load(font(800, 64)).catch(() => undefined);

  const width = Math.max(image?.naturalWidth ?? 0, MIN_WIDTH);
  const height = Math.round(width * COVER_RATIO);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('La couverture n’a pas pu être composée.');
  const palette = coverPalette(seed);

  if (image) {
    // L'illustration couvre toute la page, recadrée autour de son centre.
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawnWidth = image.naturalWidth * scale;
    const drawnHeight = image.naturalHeight * scale;
    context.drawImage(image, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
  } else {
    // Reliure : le fond, un reflet venu du coin bas-droit, et deux cercles discrets.
    context.fillStyle = palette.background;
    context.fillRect(0, 0, width, height);
    const sheen = context.createRadialGradient(width * 0.9, height * 1.02, 0, width * 0.9, height * 1.02, width * 1.05);
    sheen.addColorStop(0, `${palette.accent}55`);
    sheen.addColorStop(1, `${palette.accent}00`);
    context.fillStyle = sheen;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = `${palette.accent}40`;
    context.lineWidth = width * 0.004;
    for (const radius of [0.34, 0.5]) {
      context.beginPath();
      context.arc(width * 0.86, height * 0.84, width * radius, 0, Math.PI * 2);
      context.stroke();
    }
  }

  const margin = width * 0.08;
  const textWidth = width - margin * 2;

  // Le titre prend la taille de sa longueur, puis se réduit s'il dépasse cinq lignes.
  const title = text.title.trim() || 'Sans titre';
  let titleSize = width * coverTitleScale(title);
  let titleLines: string[] = [];
  for (; ; titleSize *= 0.92) {
    context.font = font(800, titleSize);
    titleLines = wrap(context, title, textWidth);
    if (titleLines.length <= 5 || titleSize <= width * 0.05) break;
  }
  titleLines = clamp(titleLines, 6);
  const titleLeading = titleSize * 1.1;

  const subtitleSize = width * 0.036;
  context.font = font(500, subtitleSize);
  const subtitleLines = clamp(wrap(context, text.subtitle?.trim() ?? '', textWidth), 4);
  const subtitleLeading = subtitleSize * 1.4;

  const label = text.label?.trim().toUpperCase() ?? '';
  const labelSize = width * 0.03;
  const top = height * 0.075;
  const accentHeight = width * 0.012;
  const labelTop = top + accentHeight + width * 0.04;
  const titleTop = labelTop + (label ? labelSize + width * 0.03 : 0);
  const blockBottom = titleTop + titleLines.length * titleLeading + (subtitleLines.length > 0 ? width * 0.02 + subtitleLines.length * subtitleLeading : 0);

  if (image) {
    // Voile sombre derrière le texte : plein sous le titre, fondu dans l'illustration ensuite.
    const veilEnd = Math.min(height, blockBottom + height * 0.16);
    const veil = context.createLinearGradient(0, 0, 0, veilEnd);
    veil.addColorStop(0, `rgba(${INK}, 0.94)`);
    veil.addColorStop(Math.min(0.95, blockBottom / veilEnd), `rgba(${INK}, 0.78)`);
    veil.addColorStop(1, `rgba(${INK}, 0)`);
    context.fillStyle = veil;
    context.fillRect(0, 0, width, veilEnd);
  }

  context.textBaseline = 'top';
  context.fillStyle = image ? '#ffffff' : palette.accent;
  context.fillRect(margin, top, width * 0.12, accentHeight);

  if (label) {
    context.font = font(700, labelSize);
    context.fillStyle = 'rgba(255, 255, 255, 0.82)';
    // L'espacement des capitales n'existe pas partout : sans lui, le libellé reste simplement plus serré.
    (context as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${Math.round(labelSize * 0.18)}px`;
    context.fillText(label, margin, labelTop);
    (context as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
  }

  context.fillStyle = '#ffffff';
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
    if (image) {
      const foot = context.createLinearGradient(0, height * 0.82, 0, height);
      foot.addColorStop(0, `rgba(${INK}, 0)`);
      foot.addColorStop(1, `rgba(${INK}, 0.88)`);
      context.fillStyle = foot;
      context.fillRect(0, height * 0.82, width, height * 0.18);
    }
    context.font = font(600, authorSize);
    context.fillStyle = '#ffffff';
    context.textBaseline = 'alphabetic';
    context.fillText(clamp(wrap(context, author, textWidth), 1)[0] ?? '', margin, height - height * 0.05);
  }

  // Le dos du livre : une ombre le long du bord gauche.
  const spine = context.createLinearGradient(0, 0, width * 0.045, 0);
  spine.addColorStop(0, 'rgba(0, 0, 0, 0.38)');
  spine.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = spine;
  context.fillRect(0, 0, width * 0.045, height);

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('La couverture n’a pas pu être enregistrée.'))), 'image/jpeg', 0.93);
  });
}
