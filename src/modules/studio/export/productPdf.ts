import { jsPDF } from 'jspdf';
import type { BookBlock } from '@server/shared/bookText';
import { toFileSlug, toPdfSafe, truncateText } from '@/shared/lib/pdfText';
import {
  EMPTY_CHAPTER_NOTICE,
  ProductDocument,
  SOURCE_ANCHOR,
  SOURCE_TITLE,
  chapterHeading,
  sectionAnchor,
  tableOfContents,
} from '@/modules/studio/export/productDocument';

/**
 * Rendu PDF d'un ouvrage, composé comme un livre.
 *
 * Le premier ebook sorti du site (04/10/2026) alignait titres, sous-titres et texte dans le même
 * corps, sans gras, les chapitres enchaînés sur la même page. Les règles appliquées ici sont
 * celles de l'édition courante :
 *  · une page de titre, puis le sommaire à deux niveaux (chapitres et sections), cliquable ;
 *  · chaque chapitre commence en haut d'une page ;
 *  · trois niveaux de titres en gras, de corps décroissant (20, 14, 12 points), jamais laissés
 *    seuls en bas de page ;
 *  · texte en corps 11,5 sur une ligne de 158 mm, interligne d'une fois et demie, un blanc
 *    entre deux paragraphes ; listes à puces et étapes numérotées en retrait ;
 *  · au pied de page, le titre de l'ouvrage et le numéro de page — rien d'autre : le livre est
 *    celui de son auteur.
 *
 * Les numéros de page des chapitres ne sont connus qu'après leur rendu : le sommaire est
 * dimensionné d'avance (pages réservées), puis rempli à la fin.
 */

type RGB = [number, number, number];

const MARGIN_X = 26;
const MARGIN_TOP = 26;
const BOTTOM_LIMIT_OFFSET = 24;
/** Millimètres par point typographique. */
const POINT = 0.3528;

const BODY_SIZE = 11.5;
const BODY_LINE = 6;
const PARAGRAPH_GAP = 3.2;
const LIST_INDENT = 7;

const INK: RGB = [30, 41, 59];
const TITLE_INK: RGB = [15, 23, 42];
const ACCENT: RGB = [22, 101, 52];
const MUTED: RGB = [100, 116, 139];
const RULE: RGB = [226, 232, 240];

const TOC_CHAPTER_LINE = 8.5;
const TOC_SECTION_LINE = 6.2;

/** Image de couverture générée, intégrée en première page. */
export interface ProductCoverImage {
  dataUrl: string;
  format: 'PNG' | 'JPEG' | 'WEBP';
}

/** Construit le document sans le télécharger : séparé pour pouvoir être vérifié hors navigateur. */
export function buildProductPDF(productDocument: ProductDocument, cover: ProductCoverImage | null = null): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN_X * 2;
  const bottomLimit = pageHeight - BOTTOM_LIMIT_OFFSET;
  const toc = tableOfContents(productDocument);
  doc.setProperties({ title: toPdfSafe(productDocument.title) });

  const lines = (text: string, width: number) => doc.splitTextToSize(toPdfSafe(text), width) as string[];

  // --- Couverture illustrée : une page de plus, avant la page de titre ---
  const offset = cover ? 1 : 0;
  if (cover) {
    // Image 9:16 en pleine page, recadrée en haut et en bas ; bandeau sombre pour le titre.
    const imageHeight = pageWidth * (16 / 9);
    doc.addImage(cover.dataUrl, cover.format, 0, (pageHeight - imageHeight) / 2, pageWidth, imageHeight);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    const coverTitle = lines(productDocument.title, contentWidth);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    const coverSubtitle = productDocument.subtitle ? lines(productDocument.subtitle, contentWidth) : [];

    const titleY = MARGIN_TOP + 8;
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, titleY + coverTitle.length * 11 + coverSubtitle.length * 6 + 8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(199, 210, 254);
    doc.text(toPdfSafe(productDocument.typeName.toUpperCase()), MARGIN_X, MARGIN_TOP - 6);
    doc.setFontSize(26);
    doc.setTextColor(255, 255, 255);
    doc.text(coverTitle, MARGIN_X, titleY);
    if (coverSubtitle.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(203, 213, 225);
      doc.text(coverSubtitle, MARGIN_X, titleY + coverTitle.length * 11);
    }
    doc.addPage();
  }

  // --- Page de titre ---
  const titlePage = 1 + offset;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  const titleLines = lines(productDocument.title, contentWidth);
  const titleTop = pageHeight * 0.32;
  doc.setFontSize(9.5);
  doc.setTextColor(...ACCENT);
  doc.text(toPdfSafe(productDocument.typeName.toUpperCase()), pageWidth / 2, titleTop - 12, { align: 'center', charSpace: 0.6 });
  doc.setFontSize(28);
  doc.setTextColor(...TITLE_INK);
  doc.text(titleLines, pageWidth / 2, titleTop, { align: 'center', lineHeightFactor: 1.2 });
  const afterTitle = titleTop + titleLines.length * 28 * POINT * 1.2;
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.6);
  doc.line(pageWidth / 2 - 14, afterTitle, pageWidth / 2 + 14, afterTitle);
  if (productDocument.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    doc.setTextColor(...MUTED);
    doc.text(lines(productDocument.subtitle, contentWidth - 20), pageWidth / 2, afterTitle + 12, { align: 'center', lineHeightFactor: 1.35 });
  }

  // --- Sommaire : pages réservées, remplies une fois les numéros de page connus ---
  const tocTop = MARGIN_TOP + 16;
  const tocHeight = toc.reduce((total, entry) => total + (entry.level === 1 ? TOC_CHAPTER_LINE : TOC_SECTION_LINE), 0);
  const tocPageCount = Math.max(1, Math.ceil(tocHeight / (bottomLimit - tocTop)));
  const firstTocPage = titlePage + 1;
  for (let page = 0; page < tocPageCount; page += 1) doc.addPage();
  doc.outline.add(null, 'Sommaire', { pageNumber: firstTocPage });

  // --- Contenu ---
  const pageOf: Record<string, number> = {};
  let y = MARGIN_TOP;

  const newPage = () => {
    doc.addPage();
    y = MARGIN_TOP;
  };
  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) newPage();
  };

  /** Écrit des lignes déjà coupées, en changeant de page au besoin. */
  const writeLines = (wrapped: string[], x: number, size: number, lineHeight: number) => {
    wrapped.forEach((line) => {
      ensureSpace(lineHeight);
      doc.text(line, x, y + size * POINT);
      y += lineHeight;
    });
  };

  const body = (text: string, options: { x?: number; width?: number; style?: 'normal' | 'italic'; color?: RGB } = {}) => {
    doc.setFont('helvetica', options.style ?? 'normal');
    doc.setFontSize(BODY_SIZE);
    doc.setTextColor(...(options.color ?? INK));
    // Un retour à la ligne simple garde deux phrases ensemble, sans le blanc d'un nouveau paragraphe.
    text.split('\n').forEach((part) => writeLines(lines(part, options.width ?? contentWidth), options.x ?? MARGIN_X, BODY_SIZE, BODY_LINE));
  };

  /** Titre de section (14 points) ou sous-titre (12 points), en gras, jamais seul en bas de page. */
  const subheading = (text: string, level: 2 | 3) => {
    const size = level === 2 ? 14 : 12;
    const lineHeight = size * POINT * 1.3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    const wrapped = lines(text, contentWidth);
    y += level === 2 ? 5 : 2.5;
    ensureSpace(wrapped.length * lineHeight + 3 * BODY_LINE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    doc.setTextColor(...TITLE_INK);
    writeLines(wrapped, MARGIN_X, size, lineHeight);
    y += level === 2 ? 2.4 : 1.6;
  };

  const list = (items: string[], ordered: boolean) => {
    items.forEach((item, index) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(BODY_SIZE);
      doc.setTextColor(...INK);
      const wrapped = lines(item, contentWidth - LIST_INDENT);
      ensureSpace(Math.min(wrapped.length, 2) * BODY_LINE);
      doc.setFont('helvetica', ordered ? 'bold' : 'normal');
      doc.setTextColor(...(ordered ? TITLE_INK : ACCENT));
      doc.text(ordered ? `${index + 1}.` : '•', MARGIN_X + (ordered ? 0 : 1.6), y + BODY_SIZE * POINT);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...INK);
      writeLines(wrapped, MARGIN_X + LIST_INDENT, BODY_SIZE, BODY_LINE);
      y += 1.4;
    });
    y += PARAGRAPH_GAP - 1.4;
  };

  const renderBlocks = (blocks: BookBlock[], chapterAnchor: string) => {
    let section = 0;
    blocks.forEach((block) => {
      if (block.type === 'h2') {
        subheading(block.text, 2);
        // La page d'une section se lit APRÈS l'écriture de son titre : il a pu passer à la page suivante.
        pageOf[sectionAnchor(chapterAnchor, section)] = doc.getCurrentPageInfo().pageNumber;
        section += 1;
      } else if (block.type === 'h3') {
        subheading(block.text, 3);
      } else if (block.type === 'p') {
        body(block.text);
        y += PARAGRAPH_GAP;
      } else {
        list(block.items, block.type === 'ol');
      }
    });
  };

  /** Ouverture de chapitre : toujours en haut d'une page. */
  const chapterOpening = (anchor: string, label: string, title: string, bookmark: string) => {
    newPage();
    const pageNumber = doc.getCurrentPageInfo().pageNumber;
    pageOf[anchor] = pageNumber;
    doc.outline.add(null, truncateText(toPdfSafe(bookmark), 80), { pageNumber });

    y += 6;
    if (label) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...ACCENT);
      doc.text(toPdfSafe(label.toUpperCase()), MARGIN_X, y, { charSpace: 0.6 });
      y += 7;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...TITLE_INK);
    const wrapped = lines(title, contentWidth);
    writeLines(wrapped, MARGIN_X, 20, 20 * POINT * 1.25);
    y += 2;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.4);
    doc.line(MARGIN_X, y, pageWidth - MARGIN_X, y);
    y += 9;
  };

  productDocument.chapters.forEach((chapter) => {
    chapterOpening(chapter.anchor, chapter.label, chapter.title, chapterHeading(chapter));
    if (chapter.blocks.length === 0) body(EMPTY_CHAPTER_NOTICE, { style: 'italic', color: [148, 163, 184] });
    else renderBlocks(chapter.blocks, chapter.anchor);
  });

  if (productDocument.bibliography.length > 0) {
    chapterOpening(SOURCE_ANCHOR, '', SOURCE_TITLE, SOURCE_TITLE);
    productDocument.bibliography.forEach((entry) => {
      body(`${entry.kind} : ${entry.label}${entry.detail ? ` · ${entry.detail}` : ''}`);
      if (entry.url) {
        ensureSpace(BODY_LINE);
        doc.setFontSize(9.5);
        doc.setTextColor(...ACCENT);
        doc.textWithLink(truncateText(entry.url, 90), MARGIN_X, y + 3, { url: entry.url });
        y += BODY_LINE;
      }
      y += PARAGRAPH_GAP;
    });
  }

  // --- Sommaire, maintenant que les pages cibles sont connues ---
  let tocPage = firstTocPage;
  doc.setPage(tocPage);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...TITLE_INK);
  doc.text('Sommaire', MARGIN_X, MARGIN_TOP + 6);
  let tocY = tocTop;

  toc.forEach((entry) => {
    const lineHeight = entry.level === 1 ? TOC_CHAPTER_LINE : TOC_SECTION_LINE;
    if (tocY + lineHeight > bottomLimit && tocPage < firstTocPage + tocPageCount - 1) {
      tocPage += 1;
      doc.setPage(tocPage);
      tocY = MARGIN_TOP + 6;
    }
    const target = pageOf[entry.anchor];
    const indent = entry.level === 1 ? 0 : 6;
    if (entry.level === 1) tocY += 2;
    doc.setFont('helvetica', entry.level === 1 ? 'bold' : 'normal');
    doc.setFontSize(entry.level === 1 ? 11.5 : 10);
    doc.setTextColor(...(entry.level === 1 ? TITLE_INK : INK));
    const label = truncateText(toPdfSafe(entry.title), entry.level === 1 ? 70 : 78);
    doc.text(label, MARGIN_X + indent, tocY + 4);

    if (target !== undefined) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      doc.text(String(target - offset), pageWidth - MARGIN_X, tocY + 4, { align: 'right' });
      doc.link(MARGIN_X, tocY - 1, contentWidth, lineHeight - 1, { pageNumber: target });
    }
    tocY += lineHeight - (entry.level === 1 ? 2 : 0);
  });

  // --- Pied de page : le titre de l'ouvrage et le numéro de page, à partir du sommaire ---
  const totalPages = doc.getNumberOfPages();
  const footerTitle = truncateText(toPdfSafe(productDocument.title), 70);
  for (let page = firstTocPage; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text(footerTitle, MARGIN_X, pageHeight - 12);
    // La couverture illustrée ne compte pas : la page de titre est la page 1.
    doc.text(String(page - offset), pageWidth - MARGIN_X, pageHeight - 12, { align: 'right' });
  }

  return doc;
}

export function renderProductPDF(productDocument: ProductDocument, cover: ProductCoverImage | null = null): void {
  buildProductPDF(productDocument, cover).save(`${toFileSlug(productDocument.title, 'produit')}.pdf`);
}
