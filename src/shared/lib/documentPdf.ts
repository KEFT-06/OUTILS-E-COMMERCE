import { jsPDF } from 'jspdf';
import { parseMarkdown, plainInline } from '@/shared/lib/markdownBlocks';
import type { PDFComplianceStamp } from '@/shared/lib/pdfGenerator';
import { toFileSlug, toPdfSafe } from '@/shared/lib/pdfText';
import type { ReportDocument } from '@/shared/types/analysis';

/**
 * PDF du rapport rédigé : le texte tel que le rédacteur l'a structuré, puis l'annexe des sites
 * consultés, le tampon de conformité et la mention légale sur chaque page (CdC §9.4).
 * Appelé seulement par la porte de conformité (complianceGate), jamais directement.
 */
export function generateDocumentPDF(document: ReportDocument, meta: { nicheName: string; dateLabel: string }, stamp: PDFComplianceStamp): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const width = pageWidth - margin * 2;
  const bottom = pageHeight - 24;
  let y = margin + 4;

  const header = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(0, 160, 70);
    doc.text('Smart Creator', margin, 10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(140, 140, 140);
    doc.text(toPdfSafe(meta.nicheName).slice(0, 60), pageWidth - margin, 10, { align: 'right' });
    doc.setDrawColor(228, 228, 231);
    doc.setLineWidth(0.3);
    doc.line(margin, 12.5, pageWidth - margin, 12.5);
  };

  const ensure = (height: number) => {
    if (y + height > bottom) {
      doc.addPage();
      header();
      y = margin + 4;
    }
  };

  /** Texte coupé à la largeur donnée, ligne par ligne pour franchir les sauts de page. */
  const write = (text: string, options: { size: number; style?: 'normal' | 'bold' | 'italic'; color?: [number, number, number]; indent?: number; lineHeight?: number; after?: number }) => {
    doc.setFont('helvetica', options.style ?? 'normal');
    doc.setFontSize(options.size);
    doc.setTextColor(...(options.color ?? [30, 41, 59]));
    const indent = options.indent ?? 0;
    const lineHeight = options.lineHeight ?? options.size * 0.5;
    const lines = doc.splitTextToSize(toPdfSafe(text), width - indent) as string[];
    for (const line of lines) {
      ensure(lineHeight);
      doc.text(line, margin + indent, y);
      y += lineHeight;
    }
    y += options.after ?? 0;
  };

  header();

  // Page de titre sobre : le rapport commence tout de suite après.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(toPdfSafe(`Rapport d’étude de marché — ${meta.dateLabel}`), margin, y);
  y += 8;

  const blocks = parseMarkdown(document.markdown ?? '');
  let titled = false;
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const text = plainInline(block.text);
        if (block.level === 1 && !titled) {
          titled = true;
          write(text, { size: 19, style: 'bold', color: [15, 23, 42], lineHeight: 8, after: 4 });
          break;
        }
        const size = block.level <= 2 ? 14 : block.level === 3 ? 12 : 11;
        ensure(size * 1.4);
        y += block.level <= 2 ? 4 : 2;
        write(text, { size, style: 'bold', color: [15, 23, 42], lineHeight: size * 0.52, after: 1.5 });
        break;
      }
      case 'paragraph':
        write(plainInline(block.text), { size: 10.5, lineHeight: 5.2, after: 3 });
        break;
      case 'list':
        block.items.forEach((item, index) => {
          const mark = block.ordered ? `${index + 1}.` : '•';
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10.5);
          ensure(5.2);
          doc.setTextColor(0, 160, 70);
          doc.text(mark, margin + 1, y);
          write(plainInline(item), { size: 10.5, indent: 7, lineHeight: 5.2, after: 1 });
        });
        y += 2;
        break;
      case 'quote': {
        const start = y;
        write(plainInline(block.text), { size: 10.5, style: 'italic', color: [71, 85, 105], indent: 6, lineHeight: 5.2 });
        doc.setDrawColor(0, 160, 70);
        doc.setLineWidth(0.8);
        // La barre reste sur la page où la citation se termine.
        doc.line(margin + 1.5, Math.max(margin + 4, Math.min(start, y) - 4), margin + 1.5, y - 3.5);
        y += 3;
        break;
      }
      case 'table': {
        const columns = Math.max(block.header.length, ...block.rows.map((row) => row.length));
        const cellWidth = width / columns;
        const drawRow = (row: string[], bold: boolean) => {
          doc.setFont('helvetica', bold ? 'bold' : 'normal');
          doc.setFontSize(9);
          const wrapped = Array.from({ length: columns }, (_, column) => doc.splitTextToSize(toPdfSafe(plainInline(row[column] ?? '')), cellWidth - 3) as string[]);
          const height = Math.max(...wrapped.map((lines) => lines.length)) * 4.3 + 3;
          ensure(height);
          if (bold) {
            doc.setFillColor(241, 245, 249);
            doc.rect(margin, y - 4, width, height, 'F');
          }
          doc.setTextColor(30, 41, 59);
          wrapped.forEach((lines, column) => doc.text(lines, margin + column * cellWidth + 1.5, y));
          doc.setDrawColor(226, 232, 240);
          doc.setLineWidth(0.2);
          doc.line(margin, y - 4 + height, margin + width, y - 4 + height);
          y += height;
        };
        drawRow(block.header, true);
        for (const row of block.rows) drawRow(row, false);
        y += 4;
        break;
      }
      case 'rule':
        ensure(6);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.line(margin, y, pageWidth - margin, y);
        y += 6;
        break;
    }
  }

  // Annexe : les sites consultés, sur une page à part.
  if (document.bibliography.length > 0) {
    doc.addPage();
    header();
    y = margin + 4;
    write('Annexe — Bibliographie des sites consultés', { size: 14, style: 'bold', color: [15, 23, 42], lineHeight: 7, after: 2 });
    write('Les numéros entre crochets dans le texte renvoient à ces pages. Consultées lors de l’étude du marché.', { size: 9, color: [100, 116, 139], lineHeight: 4.5, after: 4 });
    for (const source of document.bibliography) {
      ensure(14);
      write(`[${source.id}] ${source.title}`, { size: 10, style: 'bold', lineHeight: 5 });
      const details = [source.site, source.publishedAt ? `publié le ${source.publishedAt}` : null, source.cited ? 'cité dans le rapport' : 'consulté'].filter(Boolean).join(' · ');
      write(details, { size: 8.5, color: [100, 116, 139], lineHeight: 4.2 });
      ensure(5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(0, 120, 60);
      const url = toPdfSafe(source.url);
      const shown = (doc.splitTextToSize(url, width) as string[])[0] ?? url;
      doc.textWithLink(shown, margin, y, { url: source.url });
      y += 7;
    }
  }

  // Tampon de conformité.
  ensure(26);
  y += 4;
  doc.setDrawColor(209, 250, 229);
  doc.setFillColor(236, 253, 245);
  doc.roundedRect(margin, y, width, 20, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(4, 120, 87);
  doc.text('Contrôle de conformité', margin + 5, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(stamp.warningCount > 0 ? 180 : 4, stamp.warningCount > 0 ? 83 : 120, stamp.warningCount > 0 ? 9 : 87);
  doc.text(
    stamp.warningCount > 0
      ? `Aucune formulation bloquante. ${stamp.warningCount} point(s) de vigilance signalé(s).`
      : 'Aucune formulation bloquante ni point de vigilance relevé.',
    margin + 5,
    y + 12.5,
  );
  doc.setTextColor(100, 116, 139);
  const checked = new Date(stamp.checkedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  doc.text(toPdfSafe(`Contrôle effectué le ${checked} — table de règles v${stamp.rulesVersion}.`), margin + 5, y + 17);

  // Mention légale et numéro sur chaque page : un rapport circule souvent page par page.
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(120, 130, 145);
    doc.text((doc.splitTextToSize(toPdfSafe(stamp.disclaimer), width) as string[]).slice(0, 2), pageWidth / 2, pageHeight - 12, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Smart Creator • Page ${page} sur ${total}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
  }

  doc.save(`SmartCreator_Rapport_redige_${toFileSlug(meta.nicheName, 'niche')}.pdf`);
}
