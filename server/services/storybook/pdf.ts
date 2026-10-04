import { jsPDF } from 'jspdf';
import { toPdfSafe } from '@server/shared/pdfText';
import type { StoryPicture } from '@server/services/storybook/picture';

/**
 * PDF d'un conte illustré par le serveur : une couverture pleine page, puis une page par scène —
 * l'illustration en haut, le texte dessous.
 *
 * Format A5 en hauteur : c'est celui qui se lit sans zoomer sur un téléphone, là où la plupart
 * des contes seront ouverts, et il s'imprime deux par feuille. Le corps du texte s'adapte à sa
 * longueur : un conte pour les 3-5 ans, de trente mots par page, sort en gros caractères ; un
 * texte long descend jusqu'à 10 points, puis se poursuit sur la page suivante plutôt que d'être
 * coupé — on ne perd jamais une phrase de l'auteur.
 */

const WIDTH = 148;
const HEIGHT = 210;
const MARGIN = 14;
const TEXT_WIDTH = WIDTH - 2 * MARGIN;
/** Millimètres par point typographique. */
const POINT = 0.3528;
/** Hauteur au-delà de laquelle une illustration mangerait la place du texte : elle est alors réduite. */
const PICTURE_MAX_HEIGHT = 118;
const BOTTOM = HEIGHT - 16;

type Colour = [number, number, number];
const CREAM: Colour = [255, 248, 236];
const INK: Colour = [41, 37, 36];
const GREEN: Colour = [22, 101, 52];
const MUTED: Colour = [140, 130, 120];

const BODY_SIZES = [17, 16, 15, 14, 13, 12.5, 12, 11.5, 11, 10.5, 10];
const TITLE_SIZES = [28, 25, 22, 19, 17];

export interface PdfStory {
  title: string;
  language: string;
  pages: { heading: string; text: string }[];
}

/** Rang 0 : couverture. Rangs 1 à N : pages. Un rang absent laisse sa page sans image. */
export type PdfPictures = Map<number, StoryPicture>;

const formatOf = (mimeType: string) => (mimeType === 'image/png' ? 'PNG' : mimeType === 'image/webp' ? 'WEBP' : 'JPEG');

/** Espace insécable : la mise en lignes ne coupe que sur les espaces ordinaires. */
const INSECABLE = String.fromCharCode(160);

/**
 * Texte prêt à imprimer. En français, un guillemet ou un signe double ne doit jamais se retrouver
 * seul en bout ou en début de ligne (« noyau. « » puis la réplique à la ligne suivante, vu sur un
 * vrai conte le 04/10/2026) : l'espace qui les accompagne devient insécable.
 */
export function typeset(text: string, language: string): string {
  const safe = toPdfSafe(text);
  if (language !== 'fr') return safe;
  return safe
    .replace(/« +/g, () => `«${INSECABLE}`)
    .replace(/ +»/g, () => `${INSECABLE}»`)
    .replace(/ +([!?;:])/g, (_, sign) => `${INSECABLE}${sign}`);
}

const lineHeight = (size: number, factor: number) => size * POINT * factor;

/**
 * Met un texte en lignes, au corps courant du document.
 *
 * La mise en lignes de jsPDF compte une espace insécable presque deux fois plus large qu'elle ne
 * s'imprime : une ligne qui en portait deux était coupée un mot trop tôt, et la suivante ne
 * gardait qu'un mot (vu sur un vrai conte le 04/10/2026). On mesure donc nous-mêmes, mot par mot,
 * l'insécable comptée pour ce qu'elle est — une espace — et rendue comme telle.
 */
function wrap(doc: jsPDF, text: string, width: number): string[] {
  const plain = (value: string) => value.split(INSECABLE).join(' ');
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(' ').filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (doc.getTextWidth(plain(candidate)) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(plain(line));
      // Un mot plus large que la ligne à lui seul : jsPDF le coupe où il faut.
      const pieces = doc.getTextWidth(plain(word)) > width ? (doc.splitTextToSize(plain(word), width) as string[]) : [word];
      lines.push(...pieces.slice(0, -1));
      line = pieces[pieces.length - 1] ?? '';
    }
    if (line) lines.push(plain(line));
  }
  return lines;
}

function paper(doc: jsPDF): void {
  doc.setFillColor(...CREAM);
  doc.rect(0, 0, WIDTH, HEIGHT, 'F');
}

/** Dimensions d'une image, ou null si elle est illisible : la page sort alors sans illustration. */
function sizeOf(doc: jsPDF, picture: StoryPicture): { data: Uint8Array; width: number; height: number } | null {
  try {
    const data = new Uint8Array(picture.bytes);
    const properties = doc.getImageProperties(data);
    return properties.width > 0 && properties.height > 0 ? { data, width: properties.width, height: properties.height } : null;
  } catch {
    return null;
  }
}

function cover(doc: jsPDF, story: PdfStory, picture: StoryPicture | undefined): void {
  paper(doc);
  const image = picture ? sizeOf(doc, picture) : null;
  if (image && picture) {
    // L'image couvre toute la page ; ce qui dépasse sort du cadre, sans déformation.
    const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    doc.addImage(image.data, formatOf(picture.mimeType), (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height, undefined, 'FAST');
  }

  const bandWidth = WIDTH - 20;
  const titleWidth = bandWidth - 16;
  doc.setFont('helvetica', 'bold');
  let size = TITLE_SIZES[TITLE_SIZES.length - 1]!;
  let lines: string[] = [];
  for (const candidate of TITLE_SIZES) {
    doc.setFontSize(candidate);
    lines = wrap(doc, typeset(story.title, story.language), titleWidth);
    size = candidate;
    if (lines.length <= 3) break;
  }
  const titleHeight = lines.length * lineHeight(size, 1.2);
  const bandHeight = 9 + titleHeight + 9;
  const bandTop = HEIGHT - 14 - bandHeight;
  doc.setFillColor(...CREAM);
  doc.roundedRect(10, bandTop, bandWidth, bandHeight, 5, 5, 'F');

  doc.setTextColor(...GREEN);
  doc.setFontSize(size);
  doc.text(lines, WIDTH / 2, bandTop + 9 + size * POINT * 0.85, { align: 'center', lineHeightFactor: 1.2 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(story.language === 'en' ? 'An illustrated story' : 'Un conte illustré', WIDTH / 2, bandTop + bandHeight - 3.5, { align: 'center' });
}

/** Corps le plus grand qui tient dans la hauteur donnée ; au plus petit, tout le texte est rendu quand même. */
function fitBody(doc: jsPDF, text: string, height: number): { size: number; lines: string[]; factor: number } {
  doc.setFont('helvetica', 'normal');
  let last = { size: BODY_SIZES[BODY_SIZES.length - 1]!, lines: [] as string[], factor: 1.4 };
  for (const size of BODY_SIZES) {
    const factor = size >= 13 ? 1.5 : 1.4;
    doc.setFontSize(size);
    const lines = wrap(doc, text, TEXT_WIDTH);
    last = { size, lines, factor };
    if (lines.length * lineHeight(size, factor) <= height) break;
  }
  return last;
}

function folio(doc: jsPDF, number: number): void {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(String(number), WIDTH / 2, HEIGHT - 7, { align: 'center' });
}

function storyPage(doc: jsPDF, page: PdfStory['pages'][number], picture: StoryPicture | undefined, number: number, language: string): void {
  doc.addPage();
  paper(doc);

  let top = MARGIN;
  const image = picture ? sizeOf(doc, picture) : null;
  if (image && picture) {
    let width = WIDTH;
    let height = (WIDTH * image.height) / image.width;
    if (height > PICTURE_MAX_HEIGHT) {
      height = PICTURE_MAX_HEIGHT;
      width = (PICTURE_MAX_HEIGHT * image.width) / image.height;
    }
    doc.addImage(image.data, formatOf(picture.mimeType), (WIDTH - width) / 2, 0, width, height, undefined, 'FAST');
    top = height + 9;
  }

  const heading = typeset(page.heading, language).trim();
  if (heading) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.5);
    doc.setTextColor(...GREEN);
    const lines = wrap(doc, heading, TEXT_WIDTH).slice(0, 2);
    doc.text(lines, MARGIN, top + 13.5 * POINT, { lineHeightFactor: 1.25 });
    top += lines.length * lineHeight(13.5, 1.25) + 4;
  }

  const body = fitBody(doc, typeset(page.text, language), BOTTOM - top);
  const step = lineHeight(body.size, body.factor);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(body.size);
  doc.setTextColor(...INK);

  // Ce qui ne tient pas, même au plus petit corps, continue sur une page de texte seul.
  let remaining = body.lines;
  let y = top;
  let room = Math.max(1, Math.floor((BOTTOM - top) / step));
  for (;;) {
    doc.text(remaining.slice(0, room), MARGIN, y + body.size * POINT, { lineHeightFactor: body.factor });
    folio(doc, number);
    remaining = remaining.slice(room);
    if (remaining.length === 0) break;
    doc.addPage();
    paper(doc);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(body.size);
    doc.setTextColor(...INK);
    y = MARGIN + 4;
    room = Math.max(1, Math.floor((BOTTOM - y) / step));
  }
}

export function buildStorybookPdf(story: PdfStory, pictures: PdfPictures): Buffer {
  const doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait', compress: true });
  doc.setProperties({ title: toPdfSafe(story.title) });
  cover(doc, story, pictures.get(0));
  story.pages.forEach((page, index) => storyPage(doc, page, pictures.get(index + 1), index + 1, story.language));
  return Buffer.from(doc.output('arraybuffer'));
}
