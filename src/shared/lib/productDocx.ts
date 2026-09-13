import {
  AlignmentType,
  Bookmark,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  InternalHyperlink,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  TextRun,
} from 'docx';
import { triggerDownload } from '@/shared/lib/download';
import { toFileSlug } from '@/shared/lib/pdfText';
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
 * Rendu DOCX d'un produit — feuille de route 3.3.
 *
 * Même modèle et mêmes phrases que le PDF. Le sommaire est une liste de liens
 * internes vers des signets posés sur chaque titre : il est cliquable dès
 * l'ouverture. Une table des matières automatique de Word, elle, reste vide tant
 * que l'utilisateur n'a pas demandé la mise à jour des champs — elle se présente
 * comme un sommaire sans en être un.
 */

const LINK_COLOR = '4F46E5';

function linkRun(text: string): TextRun {
  return new TextRun({ text, color: LINK_COLOR, underline: {} });
}

function heading(anchor: string, title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({ id: anchor, children: [new TextRun(title)] })],
  });
}

function body(
  text: string,
  options: { italics?: boolean; color?: string; size?: number } = {},
): Paragraph {
  return new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun({ text, italics: options.italics, color: options.color, size: options.size })],
  });
}

/** Construit le document sans le télécharger : séparé pour pouvoir être vérifié hors navigateur. */
export function buildProductDOCX(productDocument: ProductDocument, stamp: ProductExportStamp): Document {
  const notices = [
    ...(productDocument.containsDemonstrationData ? [DEMONSTRATION_COVER_NOTICE] : []),
    ...(productDocument.isEditedVersion ? [EDITED_VERSION_NOTICE] : []),
  ];

  const cover = [
    new Paragraph({
      children: [
        new TextRun({ text: productDocument.typeName.toUpperCase(), bold: true, color: LINK_COLOR, size: 18 }),
      ],
    }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(productDocument.title)] }),
    ...(productDocument.subtitle
      ? [new Paragraph({ children: [new TextRun({ text: productDocument.subtitle, color: '64748B', size: 26 })] })]
      : []),
    ...notices.map((notice) => body(notice, { italics: true, color: 'B45309', size: 18 })),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Sommaire')] }),
    ...tableOfContents(productDocument).map(
      (entry) =>
        new Paragraph({
          spacing: { after: 80 },
          children: [new InternalHyperlink({ anchor: entry.anchor, children: [linkRun(entry.title)] })],
        }),
    ),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const chapters = productDocument.chapters.flatMap((chapter) => [
    heading(chapter.anchor, chapter.title),
    ...(chapter.paragraphs.length === 0
      ? [body(EMPTY_CHAPTER_NOTICE, { italics: true, color: '94A3B8' })]
      : chapter.paragraphs.map((text) => body(text))),
  ]);

  const bibliography = [
    heading(BIBLIOGRAPHY_ANCHOR, BIBLIOGRAPHY_TITLE),
    ...(productDocument.containsDemonstrationData
      ? [body(DEMONSTRATION_BIBLIOGRAPHY_NOTICE, { italics: true, color: 'B45309', size: 18 })]
      : []),
    ...(productDocument.bibliography.length === 0
      ? [body(EMPTY_BIBLIOGRAPHY_NOTICE, { italics: true, color: '64748B' })]
      : []),
    ...productDocument.bibliography.map(
      (entry, index) =>
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: `[${index + 1}] ${entry.kind} — ${entry.label}${entry.detail ? ` · ${entry.detail}` : ''}`,
              size: 20,
            }),
            ...(entry.url
              ? [new TextRun({ break: 1 }), new ExternalHyperlink({ link: entry.url, children: [linkRun(entry.url)] })]
              : []),
          ],
        }),
    ),
  ];

  const controls = [
    heading(CONTROLS_ANCHOR, CONTROLS_TITLE),
    body(describeCompliance(stamp)),
    body(describeOriginality(stamp.originality)),
    body(describeCheckDate(stamp), { color: '64748B', size: 18 }),
  ];

  // Mention légale en pied de page : répétée sur chaque page, comme dans le PDF (CdC §9.4).
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: stamp.disclaimer, italics: true, size: 14, color: '78828F' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            children: ['Page ', PageNumber.CURRENT, ' sur ', PageNumber.TOTAL_PAGES],
            size: 15,
            color: '94A3B8',
          }),
        ],
      }),
    ],
  });

  return new Document({
    creator: 'Smart Creator',
    title: productDocument.title,
    description: 'Export de produit digital — Smart Creator',
    sections: [
      {
        footers: { default: footer },
        children: [...cover, ...chapters, ...bibliography, ...controls],
      },
    ],
  });
}

export async function buildProductDOCXBlob(
  productDocument: ProductDocument,
  stamp: ProductExportStamp,
): Promise<Blob> {
  return Packer.toBlob(buildProductDOCX(productDocument, stamp));
}

export async function renderProductDOCX(
  productDocument: ProductDocument,
  stamp: ProductExportStamp,
): Promise<void> {
  const blob = await buildProductDOCXBlob(productDocument, stamp);
  triggerDownload(blob, `${toFileSlug(productDocument.title, 'produit')}.docx`);
}
