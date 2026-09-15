import { jsPDF } from 'jspdf';
import { triggerDownload } from '@/shared/lib/download';
import { fetchRequiredDisclaimer } from '@/shared/lib/legal';
import { toPdfSafe } from '@/shared/lib/pdfText';
import { recordExport } from '@/shared/lib/usage';
import { SwipeEntry } from '@/shared/lib/useSwipeFile';

/**
 * Export du swipe file en CSV et PDF — feuille de route 2.3.
 *
 * Ce document ne passe pas par le veto de conformité (1.2), et c'est un choix
 * assumé. Il rassemble des publicités de TIERS collectées pour la veille, pas un
 * contenu destiné à être publié. Le bloquer rendrait l'outil inutile précisément
 * sur les annonces qui méritent d'être étudiées — celles qui promettent des gains.
 * En contrepartie, chaque export se déclare en tête comme document de veille non
 * destiné à la diffusion, et porte la mention légale.
 */

const RESEARCH_NOTICE =
  "Document de veille interne : publicités de tiers collectées à des fins d'analyse. " +
  'Non destiné à la diffusion.';

const DEMONSTRATION_NOTICE =
  'ATTENTION : ce document contient des publicités de DÉMONSTRATION, fictives, ' +
  'qui ne décrivent aucun marché réel.';

/** Excel en locale française attend « ; » comme séparateur de colonnes. */
const CSV_SEPARATOR = ';';

const CSV_COLUMNS: { header: string; value: (entry: SwipeEntry) => string }[] = [
  { header: 'Annonceur', value: (e) => e.ad.advertiserName },
  { header: 'Identifiant annonceur', value: (e) => e.ad.advertiserId },
  { header: 'Identifiant publicité', value: (e) => e.ad.externalId },
  { header: 'Niche', value: (e) => e.niche },
  { header: 'Marché', value: (e) => e.ad.market },
  { header: 'Début de diffusion', value: (e) => e.ad.startedAt },
  { header: 'Fin de diffusion', value: (e) => e.ad.endedAt ?? '' },
  { header: 'Statut à la collecte', value: (e) => (e.ad.isActive ? 'Active' : 'Arrêtée') },
  { header: 'Durée de diffusion (jours)', value: (e) => e.ad.lifetimeDays.toLocaleString('fr-FR') },
  { header: 'Texte publicitaire', value: (e) => e.ad.creativeBody ?? '' },
  { header: 'Lien', value: (e) => e.ad.landingPageUrl ?? '' },
  { header: 'Note personnelle', value: (e) => e.note },
  { header: 'Source', value: (e) => e.source },
  { header: 'Démonstration', value: (e) => (e.isDemonstration ? 'Oui' : 'Non') },
  { header: 'Collectée le', value: (e) => e.collectedAt },
  { header: 'Ajoutée le', value: (e) => e.savedAt },
];

/**
 * Échappe une cellule CSV.
 *
 * Une cellule commençant par =, +, - ou @ est interprétée comme une formule par
 * les tableurs. Les textes publicitaires viennent de tiers : sans neutralisation,
 * une annonce piégée exécuterait une formule à l'ouverture du fichier.
 */
function escapeCsvCell(raw: string): string {
  const neutralised = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${neutralised.replace(/"/g, '""')}"`;
}

function fileStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function exportSwipeFileCSV(entries: SwipeEntry[]): Promise<void> {
  const disclaimer = await fetchRequiredDisclaimer();
  const hasDemonstration = entries.some((entry) => entry.isDemonstration);

  const lines = [
    escapeCsvCell(RESEARCH_NOTICE),
    ...(hasDemonstration ? [escapeCsvCell(DEMONSTRATION_NOTICE)] : []),
    escapeCsvCell(disclaimer),
    '',
    CSV_COLUMNS.map((column) => escapeCsvCell(column.header)).join(CSV_SEPARATOR),
    ...entries.map((entry) =>
      CSV_COLUMNS.map((column) => escapeCsvCell(column.value(entry))).join(CSV_SEPARATOR),
    ),
  ];

  // BOM : sans lui, Excel lit l'UTF-8 comme du Windows-1252 et casse les accents.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, `swipe-file_${fileStamp()}.csv`);
  recordExport('swipe_file', 'csv');
}

export async function exportSwipeFilePDF(entries: SwipeEntry[]): Promise<void> {
  const disclaimer = await fetchRequiredDisclaimer();
  const hasDemonstration = entries.some((entry) => entry.isDemonstration);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 22) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Swipe file — publicités sauvegardées', margin, y + 6);
  y += 13;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `${entries.length} publicité(s) · exporté le ${new Date().toLocaleString('fr-FR')}`,
    margin,
    y,
  );
  y += 7;

  const notices = hasDemonstration ? [RESEARCH_NOTICE, DEMONSTRATION_NOTICE] : [RESEARCH_NOTICE];
  const noticeLines = notices.flatMap(
    (notice) => doc.splitTextToSize(toPdfSafe(notice), contentWidth - 8) as string[],
  );
  const noticeHeight = 6 + noticeLines.length * 4;

  doc.setFillColor(254, 243, 199);
  doc.roundedRect(margin, y, contentWidth, noticeHeight, 2, 2, 'F');
  doc.setFontSize(8);
  doc.setTextColor(120, 53, 15);
  doc.text(noticeLines, margin + 4, y + 5);
  y += noticeHeight + 6;

  entries.forEach((entry, index) => {
    const bodyLines = entry.ad.creativeBody
      ? (doc.splitTextToSize(toPdfSafe(entry.ad.creativeBody), contentWidth - 8) as string[]).slice(0, 6)
      : [];
    const noteLines = entry.note
      ? (doc.splitTextToSize(toPdfSafe(`Note : ${entry.note}`), contentWidth - 8) as string[])
      : [];

    const blockHeight = 19 + bodyLines.length * 4 + noteLines.length * 4;
    ensureSpace(blockHeight);

    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, contentWidth, blockHeight, 2, 2, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(toPdfSafe(`${index + 1}. ${entry.ad.advertiserName}`), margin + 4, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    const status = entry.ad.isActive ? 'active' : 'arrêtée';
    doc.text(
      toPdfSafe(
        `Niche « ${entry.niche} » · marché ${entry.ad.market} · ${status} à la collecte · ` +
          `${entry.ad.lifetimeDays.toLocaleString('fr-FR')} j de diffusion · source : ${entry.source}` +
          (entry.isDemonstration ? ' (démonstration)' : ''),
      ),
      margin + 4,
      y + 11,
    );

    let lineY = y + 16;
    doc.setTextColor(51, 65, 85);
    bodyLines.forEach((line) => {
      doc.text(line, margin + 4, lineY);
      lineY += 4;
    });

    doc.setFont('helvetica', 'italic');
    doc.setTextColor(79, 70, 229);
    noteLines.forEach((line) => {
      doc.text(line, margin + 4, lineY);
      lineY += 4;
    });

    y += blockHeight + 4;
  });

  // Mention légale sur chaque page, comme pour le rapport (CdC §9.4).
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(120, 130, 145);
    const disclaimerLines = doc.splitTextToSize(toPdfSafe(disclaimer), contentWidth) as string[];
    doc.text(disclaimerLines.slice(0, 2), pageWidth / 2, pageHeight - 12, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Smart Creator • Swipe file • Page ${page} sur ${totalPages}`, pageWidth / 2, pageHeight - 6, {
      align: 'center',
    });
  }

  doc.save(`swipe-file_${fileStamp()}.pdf`);
  recordExport('swipe_file', 'pdf');
}
