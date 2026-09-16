import { REVIEW_LEVELS, type GuideSection, type ReviewLevel } from '@server/shared/guides';
import { findLanguage } from '@server/shared/languages';
import { type Guide, coversApi } from '@/modules/multilingue/guidesApi';
import { triggerDownload } from '@/shared/lib/download';
import { toFileSlug } from '@/shared/lib/pdfText';
import { recordExport } from '@/shared/lib/usage';

/**
 * Exports d'un guide, dans sa langue d'origine ou dans une traduction : page
 * HTML autonome, document Word, et PDF par la fenêtre d'impression du
 * navigateur — le seul rendu qui affiche correctement toutes les écritures
 * (arabe de droite à gauche, devanagari, bengali, chinois) sans embarquer des
 * dizaines de mégaoctets de polices.
 */

export interface GuideExportDocument {
  guideId: string;
  title: string;
  language: string;
  direction: 'ltr' | 'rtl';
  sections: GuideSection[];
  /** null : version originale. */
  level: ReviewLevel | null;
  /** Couverture prête, sinon null. */
  coverId: string | null;
}

/** `language` : code d'une traduction ; absent, « original » ou langue du guide : la version originale. */
export function guideDocumentOf(guide: Guide, language: string | null | undefined): GuideExportDocument | null {
  const coverId = guide.cover?.status === 'ready' ? guide.cover.id : null;
  if (!language || language === 'original' || language === guide.sourceLanguage) {
    return {
      guideId: guide.id,
      title: guide.title,
      language: guide.sourceLanguage,
      direction: findLanguage(guide.sourceLanguage)?.direction ?? 'ltr',
      sections: guide.sections,
      level: null,
      coverId,
    };
  }
  const translation = guide.translations.find((candidate) => candidate.language === language);
  if (!translation) return null;
  return {
    guideId: guide.id,
    title: translation.title,
    language,
    direction: findLanguage(language)?.direction ?? 'ltr',
    sections: translation.sections,
    level: translation.level,
    coverId,
  };
}

export function exportNotice(document: GuideExportDocument): string {
  if (document.level === null) return `Version originale (${findLanguage(document.language)?.fr ?? document.language})`;
  const level = REVIEW_LEVELS[document.level];
  return `${level.name} · ${level.exportNotice}`;
}

export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

const FONT_STACK =
  '"Segoe UI", "Noto Sans", "Nirmala UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Noto Sans Arabic", "Noto Sans Devanagari", "Noto Sans Bengali", Ebrima, Tahoma, Arial, sans-serif';

/** Mise en page commune à la page HTML exportée et à la page d'impression. */
export const GUIDE_DOCUMENT_CSS = `
.guide { max-width: 760px; margin: 0 auto; padding: 32px 28px 48px; color: #0f172a; background: #ffffff; font-family: ${FONT_STACK}; font-size: 16px; line-height: 1.7; }
.guide h1 { font-size: 2.1rem; line-height: 1.2; margin: 0; }
.guide h2 { font-size: 1.35rem; line-height: 1.3; margin: 2.2rem 0 0.8rem; }
.guide p { margin: 0 0 1rem; white-space: pre-line; }
.guide-cover { position: relative; display: flex; align-items: flex-end; min-height: 220px; margin: 0 0 2.5rem; overflow: hidden; border-radius: 12px; background: #0f172a; color: #ffffff; }
.guide-cover img { display: block; width: 100%; max-height: 85vh; aspect-ratio: 9 / 16; object-fit: cover; }
.guide-cover-title { padding: 32px 28px; }
.guide-cover.has-image .guide-cover-title { position: absolute; inset: 0 0 auto 0; padding: 32px 28px 72px; background: linear-gradient(rgba(15, 23, 42, 0.85), rgba(15, 23, 42, 0)); }
.guide-colophon { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; color: #64748b; font-family: system-ui, sans-serif; font-size: 0.8rem; }
@media print {
  @page { size: A4; margin: 16mm; }
  .guide { max-width: none; padding: 0; border-radius: 0; box-shadow: none; }
  .guide-cover { height: 262mm; margin: 0; border-radius: 0; break-after: page; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .guide-cover img { height: 100%; max-height: none; aspect-ratio: auto; }
  .guide h2 { break-after: avoid; }
  .guide p { orphans: 3; widows: 3; }
}
`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function buildGuideHtml(document: GuideExportDocument, coverDataUrl: string | null): string {
  const image = coverDataUrl && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(coverDataUrl) ? coverDataUrl : null;
  const sections = document.sections
    .map(
      (section) =>
        `<section>${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ''}${paragraphsOf(section.body)
          .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
          .join('')}</section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="${escapeHtml(document.language)}" dir="${document.direction}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.title)}</title>
<style>body { margin: 0; background: #f1f5f9; }${GUIDE_DOCUMENT_CSS}</style>
</head>
<body>
<main class="guide">
<header class="guide-cover${image ? ' has-image' : ''}">${image ? `<img src="${image}" alt="">` : ''}<div class="guide-cover-title"><h1>${escapeHtml(document.title)}</h1></div></header>
${sections}
<footer class="guide-colophon" lang="fr" dir="ltr">${escapeHtml(exportNotice(document))} · Smart Creator</footer>
</main>
</body>
</html>`;
}

const fileName = (document: GuideExportDocument, extension: string) => `${toFileSlug(document.title, 'guide')}-${document.language}.${extension}`;

export async function downloadGuideHtml(document: GuideExportDocument): Promise<void> {
  let coverDataUrl: string | null = null;
  if (document.coverId) {
    try {
      coverDataUrl = (await coversApi.image(document.coverId)).dataUrl;
    } catch {
      // Sans couverture plutôt que sans fichier.
    }
  }
  triggerDownload(new Blob([buildGuideHtml(document, coverDataUrl)], { type: 'text/html;charset=utf-8' }), fileName(document, 'html'));
  recordExport('ebook', 'html');
}

export async function downloadGuideDocx(document: GuideExportDocument): Promise<void> {
  // Chargé à la demande : la bibliothèque DOCX est lourde et ne sert qu'à cet export.
  const { AlignmentType, Document, HeadingLevel, ImageRun, Packer, PageBreak, Paragraph, TextRun } = await import('docx');
  const rtl = document.direction === 'rtl';
  const alignment = rtl ? AlignmentType.RIGHT : AlignmentType.LEFT;
  const runs = (text: string, options: { size?: number; color?: string; italics?: boolean } = {}) =>
    text.split('\n').map((line, index) => new TextRun({ text: line, break: index > 0 ? 1 : undefined, rightToLeft: rtl, ...options }));

  let cover: { type: 'png' | 'jpg'; data: Uint8Array } | null = null;
  if (document.coverId) {
    try {
      const image = await coversApi.image(document.coverId);
      const type = image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/jpeg' ? 'jpg' : null;
      if (type) cover = { type, data: image.bytes };
    } catch {
      cover = null;
    }
  }

  const children = [
    ...(cover
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ type: cover.type, data: cover.data, transformation: { width: 420, height: 747 } })],
          }),
        ]
      : []),
    new Paragraph({ heading: HeadingLevel.TITLE, bidirectional: rtl, alignment, children: runs(document.title) }),
    new Paragraph({ children: [new TextRun({ text: exportNotice(document), italics: true, size: 18, color: '64748B' })] }),
    new Paragraph({ children: [new PageBreak()] }),
    ...document.sections.flatMap((section) => [
      ...(section.heading ? [new Paragraph({ heading: HeadingLevel.HEADING_1, bidirectional: rtl, alignment, children: runs(section.heading) })] : []),
      ...paragraphsOf(section.body).map(
        (paragraph) => new Paragraph({ bidirectional: rtl, alignment, spacing: { after: 160 }, children: runs(paragraph) }),
      ),
    ]),
  ];

  const file = new Document({ creator: 'Smart Creator', title: document.title, sections: [{ children }] });
  triggerDownload(await Packer.toBlob(file), fileName(document, 'docx'));
  recordExport('ebook', 'docx');
}

/** Page d'impression dans un nouvel onglet : « Enregistrer au format PDF » dans la fenêtre d'impression. */
export function guidePrintPath(guideId: string, language: string): string {
  return `/imprimer/guide/${encodeURIComponent(guideId)}/${encodeURIComponent(language)}`;
}
