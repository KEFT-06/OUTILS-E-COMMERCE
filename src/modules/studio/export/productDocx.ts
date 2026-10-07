import {
  AlignmentType,
  Bookmark,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  TextRun,
} from 'docx';
import type { BookBlock } from '@server/shared/bookText';
import { triggerDownload } from '@/shared/lib/download';
import { toFileSlug } from '@/shared/lib/pdfText';
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
 * Rendu DOCX d'un ouvrage — même modèle et mêmes règles de composition que le PDF : page de
 * titre, sommaire à deux niveaux, un chapitre par page, trois niveaux de titres en gras, corps
 * de 11,5 points à interligne d'une fois et demie, listes en retrait.
 *
 * Le sommaire est une liste de liens internes vers des signets posés sur chaque titre : il est
 * cliquable dès l'ouverture. Une table des matières automatique de Word, elle, reste vide tant
 * que l'utilisateur n'a pas demandé la mise à jour des champs.
 */

const LINK_COLOR = '166534';
const INK = '1E293B';
const TITLE_INK = '0F172A';
/** Corps du texte, en demi-points : 11,5 points. */
const BODY_SIZE = 23;
/** Interligne d'une fois et demie (240 = simple). */
const BODY_SPACING = { line: 360, lineRule: LineRuleType.AUTO } as const;

/** Un retour à la ligne simple, dans un paragraphe, reste un retour à la ligne. */
function runs(text: string, options: { bold?: boolean; italics?: boolean; color?: string; size?: number } = {}): TextRun[] {
  return text
    .split('\n')
    .map((part, index) => new TextRun({ text: part, break: index > 0 ? 1 : undefined, size: BODY_SIZE, color: INK, ...options }));
}

function body(text: string, options: { italics?: boolean; color?: string } = {}): Paragraph {
  return new Paragraph({ spacing: { ...BODY_SPACING, after: 180 }, children: runs(text, options) });
}

function blockParagraphs(blocks: BookBlock[], chapterAnchor: string): Paragraph[] {
  let section = 0;
  return blocks.flatMap((block) => {
    if (block.type === 'h2') {
      const anchor = sectionAnchor(chapterAnchor, section);
      section += 1;
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          keepNext: true,
          spacing: { before: 320, after: 140 },
          children: [new Bookmark({ id: anchor, children: [new TextRun({ text: block.text, bold: true, size: 28, color: TITLE_INK })] })],
        }),
      ];
    }
    if (block.type === 'h3') {
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          keepNext: true,
          spacing: { before: 220, after: 100 },
          children: [new TextRun({ text: block.text, bold: true, size: 24, color: TITLE_INK })],
        }),
      ];
    }
    if (block.type === 'p') return [body(block.text)];
    return block.items.map(
      (item, index) =>
        new Paragraph({
          spacing: { ...BODY_SPACING, after: 80 },
          indent: { left: 440, hanging: 440 },
          children: [
            new TextRun({ text: block.type === 'ol' ? `${index + 1}.\t` : '•\t', bold: block.type === 'ol', size: BODY_SIZE, color: block.type === 'ol' ? TITLE_INK : LINK_COLOR }),
            ...runs(item),
          ],
          tabStops: [{ type: 'left', position: 440 }],
        }),
    );
  });
}

/** Image de couverture générée, placée en première page. */
export interface ProductDocxCover {
  type: 'png' | 'jpg';
  data: Uint8Array;
  /** Couverture composée, au format d'une page : ses proportions ne sont pas celles de l'illustration seule. */
  composed?: boolean;
}

/** Construit le document sans le télécharger : séparé pour pouvoir être vérifié hors navigateur. */
export function buildProductDOCX(productDocument: ProductDocument, coverImage: ProductDocxCover | null = null): Document {
  const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

  const titlePage = [
    ...(coverImage
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                type: coverImage.type,
                data: coverImage.data,
                transformation: coverImage.composed ? { width: 500, height: 707 } : { width: 420, height: 747 },
              }),
            ],
          }),
          pageBreak(),
        ]
      : []),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 3200, after: 240 },
      children: [new TextRun({ text: productDocument.typeName.toUpperCase(), bold: true, color: LINK_COLOR, size: 19, characterSpacing: 30 })],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: productDocument.title, bold: true, size: 56, color: TITLE_INK })],
    }),
    ...(productDocument.subtitle
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240 },
            children: [new TextRun({ text: productDocument.subtitle, color: '64748B', size: 28 })],
          }),
        ]
      : []),
    pageBreak(),
  ];

  const contents = [
    new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: 'Sommaire', bold: true, size: 40, color: TITLE_INK })] }),
    ...tableOfContents(productDocument).map(
      (entry) =>
        new Paragraph({
          spacing: { before: entry.level === 1 ? 160 : 0, after: 60 },
          indent: { left: entry.level === 1 ? 0 : 340 },
          children: [
            new InternalHyperlink({
              anchor: entry.anchor,
              children: [new TextRun({ text: entry.title, bold: entry.level === 1, size: entry.level === 1 ? 23 : 20, color: entry.level === 1 ? TITLE_INK : INK })],
            }),
          ],
        }),
    ),
  ];

  /** Ouverture de chapitre : toujours en haut d'une page. */
  const chapterOpening = (anchor: string, label: string, title: string) => [
    new Paragraph({
      pageBreakBefore: true,
      spacing: { after: 100 },
      children: label ? [new TextRun({ text: label.toUpperCase(), bold: true, color: LINK_COLOR, size: 19, characterSpacing: 30 })] : [],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      spacing: { after: 320 },
      border: { bottom: { color: 'E2E8F0', size: 6, space: 8, style: 'single' } },
      children: [new Bookmark({ id: anchor, children: [new TextRun({ text: title, bold: true, size: 40, color: TITLE_INK })] })],
    }),
  ];

  const chapters = productDocument.chapters.flatMap((chapter) => [
    ...chapterOpening(chapter.anchor, chapter.label, chapter.title),
    ...(chapter.blocks.length === 0 ? [body(EMPTY_CHAPTER_NOTICE, { italics: true, color: '94A3B8' })] : blockParagraphs(chapter.blocks, chapter.anchor)),
  ]);

  const source =
    productDocument.bibliography.length > 0
      ? [
          ...chapterOpening(SOURCE_ANCHOR, '', SOURCE_TITLE),
          ...productDocument.bibliography.map(
            (entry) =>
              new Paragraph({
                spacing: { ...BODY_SPACING, after: 160 },
                children: [
                  ...runs(`${entry.kind} : ${entry.label}${entry.detail ? ` · ${entry.detail}` : ''}`),
                  ...(entry.url
                    ? [new TextRun({ break: 1 }), new ExternalHyperlink({ link: entry.url, children: [new TextRun({ text: entry.url, color: LINK_COLOR, underline: {}, size: 19 })] })]
                    : []),
                ],
              }),
          ),
        ]
      : [];

  // Pied de page : le titre de l'ouvrage et le numéro de page — le livre est celui de son auteur.
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: `${productDocument.title} · `, size: 16, color: '94A3B8' }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '94A3B8' }),
        ],
      }),
    ],
  });

  return new Document({
    title: productDocument.title,
    description: chapterHeading({ label: productDocument.typeName, title: productDocument.title }),
    styles: { default: { document: { run: { font: 'Calibri', size: BODY_SIZE } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1470, bottom: 1360, left: 1470, right: 1470 } } },
        footers: { default: footer },
        children: [...titlePage, ...contents, ...chapters, ...source],
      },
    ],
  });
}

export async function buildProductDOCXBlob(productDocument: ProductDocument, coverImage: ProductDocxCover | null = null): Promise<Blob> {
  return Packer.toBlob(buildProductDOCX(productDocument, coverImage));
}

export async function renderProductDOCX(productDocument: ProductDocument, coverImage: ProductDocxCover | null = null): Promise<void> {
  const blob = await buildProductDOCXBlob(productDocument, coverImage);
  triggerDownload(blob, `${toFileSlug(productDocument.title, 'produit')}.docx`);
}
