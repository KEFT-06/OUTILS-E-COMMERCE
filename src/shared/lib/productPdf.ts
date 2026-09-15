import { jsPDF } from 'jspdf';
import { toFileSlug, toPdfSafe, truncateText } from '@/shared/lib/pdfText';
import {
  BIBLIOGRAPHY_ANCHOR,
  BIBLIOGRAPHY_TITLE,
  CONTROLS_ANCHOR,
  CONTROLS_TITLE,
  DEMONSTRATION_BIBLIOGRAPHY_NOTICE,
  DEMONSTRATION_COVER_NOTICE,
  EDITED_VERSION_NOTICE,
  EMPTY_BIBLIOGRAPHY_NOTICE,
  EMPTY_CHAPTER_NOTICE,
  ProductDocument,
  ProductExportStamp,
  describeCheckDate,
  describeCompliance,
  describeOriginality,
  tableOfContents,
} from '@/shared/lib/productDocument';

/**
 * Rendu PDF d'un produit — feuille de route 3.3 : sommaire cliquable et bibliographie.
 *
 * Le sommaire est cliquable de deux façons, parce que les lecteurs PDF n'exploitent
 * pas tous la même : un lien interne sur chaque ligne du sommaire, et un signet
 * par chapitre dans le panneau latéral.
 *
 * Les numéros de page des chapitres ne sont connus qu'après leur rendu. Le
 * sommaire est donc dimensionné d'avance (pages réservées), puis rempli à la fin.
 */

type RGB = [number, number, number];

const MARGIN = 18;
const LINE_HEIGHT = 5;
const TOC_LINE_HEIGHT = 8;
const TOC_HEADING_GAP = 14;
const CHAPTER_MIN_SPACE = 40;

/** Image de couverture générée, intégrée en première page. */
export interface ProductCoverImage {
  dataUrl: string;
  format: 'PNG' | 'JPEG' | 'WEBP';
}

/** Construit le document sans le télécharger : séparé pour pouvoir être vérifié hors navigateur. */
export function buildProductPDF(
  productDocument: ProductDocument,
  stamp: ProductExportStamp,
  cover: ProductCoverImage | null = null,
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  const bottomLimit = pageHeight - 26;
  const toc = tableOfContents(productDocument);

  // --- Couverture illustrée : une page de plus, avant le sommaire ---
  const offset = cover ? 1 : 0;
  if (cover) {
    // Image 9:16 en pleine page, recadrée en haut et en bas ; bandeau sombre pour le titre.
    const imageHeight = pageWidth * (16 / 9);
    doc.addImage(cover.dataUrl, cover.format, 0, (pageHeight - imageHeight) / 2, pageWidth, imageHeight);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    const coverTitle = doc.splitTextToSize(toPdfSafe(productDocument.title), contentWidth) as string[];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    const coverSubtitle = productDocument.subtitle
      ? (doc.splitTextToSize(toPdfSafe(productDocument.subtitle), contentWidth) as string[])
      : [];

    const titleY = MARGIN + 16;
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, titleY + coverTitle.length * 11 + coverSubtitle.length * 6 + 8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(199, 210, 254);
    doc.text(toPdfSafe(productDocument.typeName.toUpperCase()), MARGIN, MARGIN + 2);
    doc.setFontSize(26);
    doc.setTextColor(255, 255, 255);
    doc.text(coverTitle, MARGIN, titleY);
    if (coverSubtitle.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(203, 213, 225);
      doc.text(coverSubtitle, MARGIN, titleY + coverTitle.length * 11);
    }
    doc.addPage();
  }

  // --- Couverture : mesurée avant tout rendu, pour dimensionner le sommaire ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  const titleLines = doc.splitTextToSize(toPdfSafe(productDocument.title), contentWidth) as string[];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  const subtitleLines = productDocument.subtitle
    ? (doc.splitTextToSize(toPdfSafe(productDocument.subtitle), contentWidth) as string[])
    : [];

  doc.setFontSize(9);
  const coverNotices = [
    ...(productDocument.containsDemonstrationData ? [DEMONSTRATION_COVER_NOTICE] : []),
    ...(productDocument.isEditedVersion ? [EDITED_VERSION_NOTICE] : []),
  ];
  const noticeLines = coverNotices.flatMap(
    (notice) => doc.splitTextToSize(toPdfSafe(notice), contentWidth - 8) as string[],
  );
  const noticeBoxHeight = noticeLines.length > 0 ? 6 + noticeLines.length * 4.5 : 0;

  const titleTop = MARGIN + 10;
  const subtitleTop = titleTop + titleLines.length * 9 + 4;
  const noticeTop = subtitleTop + subtitleLines.length * 6 + 2;
  const coverBottom = noticeTop + (noticeBoxHeight > 0 ? noticeBoxHeight + 4 : 0);

  const firstTocHeadingY = coverBottom + TOC_HEADING_GAP;
  const firstTocStart = firstTocHeadingY + 10;
  const nextTocStart = MARGIN + 14;
  const firstPageCapacity = Math.max(0, Math.floor((bottomLimit - firstTocStart) / TOC_LINE_HEIGHT));
  const nextPageCapacity = Math.floor((bottomLimit - nextTocStart) / TOC_LINE_HEIGHT);
  const tocPageCount =
    toc.length <= firstPageCapacity
      ? 1
      : 1 + Math.ceil((toc.length - firstPageCapacity) / nextPageCapacity);

  for (let page = 1; page < tocPageCount; page += 1) doc.addPage();
  doc.outline.add(null, 'Sommaire', { pageNumber: 1 + offset });

  // --- Contenu ---
  const pageOf: Record<string, number> = {};
  doc.addPage();
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const heading = (anchor: string, title: string) => {
    // Un titre de chapitre ne reste pas seul en bas de page, séparé de son contenu.
    ensureSpace(CHAPTER_MIN_SPACE);

    const pageNumber = doc.getCurrentPageInfo().pageNumber;
    pageOf[anchor] = pageNumber;
    doc.outline.add(null, truncateText(toPdfSafe(title), 80), { pageNumber });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(toPdfSafe(title), contentWidth) as string[];
    doc.text(lines, MARGIN, y + 6);
    y += 4 + lines.length * 7;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
    y += 6;
  };

  const paragraph = (
    text: string,
    options: { size?: number; color?: RGB; style?: 'normal' | 'italic' } = {},
  ) => {
    doc.setFont('helvetica', options.style ?? 'normal');
    doc.setFontSize(options.size ?? 10.5);
    const [r, g, b] = options.color ?? [51, 65, 85];
    doc.setTextColor(r, g, b);

    const lines = doc.splitTextToSize(toPdfSafe(text), contentWidth) as string[];
    lines.forEach((line) => {
      ensureSpace(LINE_HEIGHT);
      doc.text(line, MARGIN, y + 4);
      y += LINE_HEIGHT;
    });
    y += 3;
  };

  productDocument.chapters.forEach((chapter) => {
    heading(chapter.anchor, chapter.title);
    if (chapter.paragraphs.length === 0) {
      paragraph(EMPTY_CHAPTER_NOTICE, { style: 'italic', color: [148, 163, 184] });
    }
    chapter.paragraphs.forEach((text) => paragraph(text));
    y += 4;
  });

  heading(BIBLIOGRAPHY_ANCHOR, BIBLIOGRAPHY_TITLE);
  if (productDocument.containsDemonstrationData) {
    paragraph(DEMONSTRATION_BIBLIOGRAPHY_NOTICE, { size: 9, color: [180, 83, 9], style: 'italic' });
  }
  if (productDocument.bibliography.length === 0) {
    paragraph(EMPTY_BIBLIOGRAPHY_NOTICE, { style: 'italic', color: [100, 116, 139] });
  }
  productDocument.bibliography.forEach((entry, index) => {
    paragraph(
      `[${index + 1}] ${entry.kind} — ${entry.label}${entry.detail ? ` · ${entry.detail}` : ''}`,
      { size: 9.5 },
    );
    if (entry.url) {
      ensureSpace(LINE_HEIGHT);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(79, 70, 229);
      doc.textWithLink(truncateText(entry.url, 95), MARGIN + 6, y, { url: entry.url });
      y += LINE_HEIGHT + 1;
    }
  });

  heading(CONTROLS_ANCHOR, CONTROLS_TITLE);
  paragraph(describeCompliance(stamp));
  paragraph(describeOriginality(stamp.originality));
  paragraph(describeCheckDate(stamp), { size: 9, color: [100, 116, 139] });

  // --- Couverture et sommaire, maintenant que les pages cibles sont connues ---
  let tocIndex = 0;

  for (let page = 1; page <= tocPageCount; page += 1) {
    doc.setPage(page + offset);
    let tocY: number;

    if (page === 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(79, 70, 229);
      doc.text(toPdfSafe(productDocument.typeName.toUpperCase()), MARGIN, MARGIN + 4);

      doc.setFontSize(22);
      doc.setTextColor(15, 23, 42);
      doc.text(titleLines, MARGIN, titleTop + 7);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(100, 116, 139);
      if (subtitleLines.length > 0) doc.text(subtitleLines, MARGIN, subtitleTop + 5);

      if (noticeLines.length > 0) {
        doc.setFillColor(254, 243, 199);
        doc.roundedRect(MARGIN, noticeTop, contentWidth, noticeBoxHeight, 2, 2, 'F');
        doc.setFontSize(9);
        doc.setTextColor(120, 53, 15);
        doc.text(noticeLines, MARGIN + 4, noticeTop + 5);
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text('Sommaire', MARGIN, firstTocHeadingY);
      tocY = firstTocStart;
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text('Sommaire (suite)', MARGIN, MARGIN + 6);
      tocY = nextTocStart;
    }

    const capacity = page === 1 ? firstPageCapacity : nextPageCapacity;

    for (let line = 0; line < capacity && tocIndex < toc.length; line += 1) {
      const entry = toc[tocIndex];
      const target = pageOf[entry.anchor];

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59);
      doc.text(truncateText(toPdfSafe(entry.title), 75), MARGIN, tocY);

      if (target !== undefined) {
        doc.setTextColor(100, 116, 139);
        doc.text(String(target), pageWidth - MARGIN, tocY, { align: 'right' });
        doc.link(MARGIN, tocY - 5, contentWidth, TOC_LINE_HEIGHT - 1, { pageNumber: target });
      }

      tocY += TOC_LINE_HEIGHT;
      tocIndex += 1;
    }
  }

  // --- Pied de page : mention légale sur chaque page (CdC §9.4) ---
  const totalPages = doc.getNumberOfPages();
  doc.setFontSize(6.5);
  const disclaimerLines = doc.splitTextToSize(toPdfSafe(stamp.disclaimer), contentWidth) as string[];
  const footerTitle = truncateText(toPdfSafe(productDocument.title), 60);

  // La couverture illustrée reste sans pied de page.
  for (let page = 1 + offset; page <= totalPages; page += 1) {
    doc.setPage(page);

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(120, 130, 145);
    doc.text(disclaimerLines.slice(0, 2), pageWidth / 2, pageHeight - 12, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`${footerTitle} • Page ${page} sur ${totalPages}`, pageWidth / 2, pageHeight - 6, {
      align: 'center',
    });
  }

  return doc;
}

export function renderProductPDF(
  productDocument: ProductDocument,
  stamp: ProductExportStamp,
  cover: ProductCoverImage | null = null,
): void {
  buildProductPDF(productDocument, stamp, cover).save(`${toFileSlug(productDocument.title, 'produit')}.pdf`);
}
