import { jsPDF } from 'jspdf';
import { MarketAnalysisReport } from '@/shared/types/analysis';

/**
 * Preuve de contrôle apposée sur le document exporté (CdC §9.4).
 *
 * Ce paramètre est **obligatoire** : rendre le tampon facultatif reviendrait à
 * autoriser la production d'un PDF qui n'a pas passé le vérificateur, et le
 * droit de veto ne tiendrait plus qu'à la discipline de l'appelant.
 */
export interface PDFComplianceStamp {
  rulesVersion: string;
  /** Horodatage ISO du contrôle. */
  checkedAt: string;
  /** Points de vigilance non bloquants relevés sur l'ensemble du rapport. */
  warningCount: number;
  /** Mention légale imposée par la table de conformité. */
  disclaimer: string;
}

export async function generateAnalysisPDF(
  report: MarketAnalysisReport,
  stamp: PDFComplianceStamp,
): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  let currentY = margin;

  // Helper for adding new page when needed
  const checkPageBreak = (neededHeight: number) => {
    if (currentY + neededHeight > pageHeight - 20) {
      doc.addPage();
      currentY = margin;
      drawPageHeader();
    }
  };

  const drawPageHeader = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(0, 200, 83); // Smart Creator Green
    doc.text('Smart Creator', margin, 10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(140, 140, 140);
    doc.text(' — Rapport Stratégique d\'Intelligence E-Commerce', margin + 20, 10);
    doc.text(report.nicheName.substring(0, 40), pageWidth - margin, 10, { align: 'right' });
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.3);
    doc.line(margin, 12, pageWidth - margin, 12);
  };

  // Helper function to draw rate badge
  const getRateColor = (level: string): [number, number, number] => {
    switch (level) {
      case 'Très élevé':
        return [16, 185, 129]; // Emerald green
      case 'Élevé':
        return [59, 130, 246]; // Blue
      case 'Moyen':
        return [245, 158, 11]; // Amber
      case 'Faible':
        return [239, 68, 68]; // Red
      default:
        return [100, 116, 139];
    }
  };

  // === COVER HEADER / TITLE ===
  doc.setFillColor(15, 23, 42); // Slate 900
  doc.roundedRect(margin, currentY, contentWidth, 38, 3, 3, 'F');

  doc.setTextColor(248, 250, 252);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RAPPORT D\'ANALYSE STRATÉGIQUE & VEILLE CONCURRENTIELLE', margin + 8, currentY + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(148, 163, 184); // Slate 400
  doc.text(`Thématique analysée : ${report.nicheName}`, margin + 8, currentY + 20);

  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text(`Date : ${report.dateCreated}  |  Verdict : ${report.overallVerdict}  |  ID : #${report.id.substring(0, 12)}`, margin + 8, currentY + 30);

  currentY += 44;

  // === EXECUTIVE SUMMARY ===
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Synthèse Exécutive & Opportunité de Marché', margin, currentY);
  currentY += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(51, 65, 85);
  const summaryLines = doc.splitTextToSize(report.executiveSummary, contentWidth);
  doc.text(summaryLines, margin, currentY);
  currentY += summaryLines.length * 4.8 + 6;

  // === TAUX / RATINGS GRID ===
  checkPageBreak(50);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Système de Notation par Taux (Demande, Saturation & Rentabilité)', margin, currentY);
  currentY += 6;

  const rateItems = [
    report.rates.demand,
    report.rates.saturation,
    report.rates.profitability,
    report.rates.opportunity,
    report.rates.virality,
  ].filter(Boolean);

  const cardWidth = (contentWidth - 6) / 2;
  const cardHeight = 22;

  rateItems.forEach((rate, index) => {
    const col = index % 2;
    const x = margin + col * (cardWidth + 6);
    
    if (col === 0 && index > 0) {
      currentY += cardHeight + 4;
      checkPageBreak(cardHeight + 6);
    }

    // Background card
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, currentY, cardWidth, cardHeight, 2, 2, 'FD');

    // Rate name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text(rate.label, x + 4, currentY + 6);

    // Rate level pill
    const [r, g, b] = getRateColor(rate.level);
    doc.setFillColor(r, g, b);
    doc.roundedRect(x + cardWidth - 28, currentY + 3, 24, 6, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(rate.level, x + cardWidth - 16, currentY + 7.2, { align: 'center' });

    // Score & description
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const desc = `${rate.score}/100 — ${rate.description.substring(0, 65)}...`;
    doc.text(desc, x + 4, currentY + 14);

    // Progress bar
    doc.setFillColor(226, 232, 240);
    doc.rect(x + 4, currentY + 18, cardWidth - 8, 1.8, 'F');
    doc.setFillColor(r, g, b);
    doc.rect(x + 4, currentY + 18, (cardWidth - 8) * (rate.score / 100), 1.8, 'F');
  });

  currentY += cardHeight + 10;

  // === SEARCH TRENDS & MOTS CLÉS ===
  checkPageBreak(40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('3. Signaux de Recherche & Mots-Clés Porteurs sur le Web', margin, currentY);
  currentY += 6;

  report.searchTrends.slice(0, 4).forEach((kw) => {
    checkPageBreak(12);
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(margin, currentY, contentWidth, 9, 1.5, 1.5, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(`• ${kw.keyword}`, margin + 4, currentY + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Volume : ${kw.volume}  |  Croissance : ${kw.growthRate}  |  Intention : ${kw.intent}`, pageWidth - margin - 4, currentY + 6, { align: 'right' });

    currentY += 11;
  });

  currentY += 4;

  // === COMPETITOR BENCHMARK ===
  checkPageBreak(50);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('4. Benchmark Concurrentiel & Angles d\'Attaque Exploités', margin, currentY);
  currentY += 6;

  report.competitors.slice(0, 2).forEach((comp) => {
    checkPageBreak(30);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, currentY, contentWidth, 26, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`${comp.name} (${comp.priceRange})`, margin + 5, currentY + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Positionnement : ${comp.positioning}`, margin + 5, currentY + 11);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(220, 38, 38);
    doc.text('Faiblesses :', margin + 5, currentY + 17);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(comp.weaknesses.join(' • '), margin + 28, currentY + 17);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text('Angle gagnant :', margin + 5, currentY + 22);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(comp.exploitableGaps[0] || 'Offre simplifiée à plus forte valeur perçue', margin + 31, currentY + 22);

    currentY += 30;
  });

  // === DIGITAL PRODUCTS BLUEPRINT ===
  checkPageBreak(55);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('5. Produits Digitaux Clés en Main à Créer', margin, currentY);
  currentY += 6;

  report.digitalProducts.forEach((prod) => {
    checkPageBreak(40);
    doc.setFillColor(254, 252, 232); // Light yellow warm
    doc.setDrawColor(253, 224, 71);
    doc.roundedRect(margin, currentY, contentWidth, 34, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`${prod.title} [${prod.typeName}]`, margin + 5, currentY + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(180, 83, 9);
    doc.text(`Prix conseillé : ${prod.recommendedPrice}€  |  Marge brute : ${prod.estimatedMarginPercent}%  |  Délai création : ${prod.estimatedProductionDays}j`, margin + 5, currentY + 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const promiseLines = doc.splitTextToSize(`Promesse : ${prod.transformationPromise}`, contentWidth - 10);
    doc.text(promiseLines, margin + 5, currentY + 17);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('Lead Magnet Gratuit :', margin + 5, currentY + 25);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    doc.text(`${prod.leadMagnet.title} (${prod.leadMagnet.format})`, margin + 40, currentY + 25);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    const modulesText = prod.tableOfContents.map((m) => `M${m.moduleNumber}: ${m.title}`).join(' | ');
    doc.text(`Structure : ${modulesText.substring(0, 100)}...`, margin + 5, currentY + 30);

    currentY += 38;
  });

  // === META ADS VIDEO SCRIPTS & COMPLIANCE ===
  checkPageBreak(60);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('6. Campagnes Publicitaires Vidéo Meta Ads (AIDA / PAS)', margin, currentY);
  currentY += 6;

  report.adCampaigns.forEach((ad) => {
    checkPageBreak(50);
    doc.setFillColor(240, 249, 255); // Sky light
    doc.setDrawColor(186, 230, 253);
    doc.roundedRect(margin, currentY, contentWidth, 42, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(3, 105, 161);
    doc.text(`Méthode ${ad.framework} (${ad.frameworkFullName}) — Format ${ad.aspectRatio} (Durée : ${ad.durationSeconds}s)`, margin + 5, currentY + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`Hook 0-3s : "${ad.hookHeadline}"`, margin + 5, currentY + 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    const scenesText = ad.scenes.map((s) => `[${s.timing} ${s.phase}] Écran: "${s.onScreenText}" | Voix: "${s.spokenVoiceover}"`).join('\n');
    const scenesLines = doc.splitTextToSize(scenesText, contentWidth - 10);
    doc.text(scenesLines.slice(0, 4), margin + 5, currentY + 17);

    // La ligne « ✓ Conformité Meta Ads : 100% validé » qui figurait ici était
    // écrite en dur : elle s'affichait à l'identique quel que soit le contenu,
    // y compris sur une campagne que le vérificateur n'avait jamais examinée.
    // Le résultat réel du contrôle est désormais rendu une seule fois, en fin
    // de document, à partir du verdict qui a autorisé l'export.

    currentY += 46;
  });

  // === CONTRÔLE DE CONFORMITÉ (CdC §6.4.1 et §9.4) ===
  checkPageBreak(34);

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, currentY, contentWidth, 28, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('CONTRÔLE DE CONFORMITÉ', margin + 5, currentY + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  const checkedLabel = new Date(stamp.checkedAt).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (stamp.warningCount > 0) {
    doc.setTextColor(180, 83, 9); // Amber 700
    doc.text(
      `Aucune formulation bloquante. ${stamp.warningCount} point(s) de vigilance signalé(s).`,
      margin + 5,
      currentY + 14,
    );
  } else {
    doc.setTextColor(4, 120, 87); // Emerald 700
    doc.text('Aucune formulation bloquante ni point de vigilance relevé.', margin + 5, currentY + 14);
  }

  doc.setTextColor(100, 116, 139);
  doc.text(
    `Contrôle effectué le ${checkedLabel} — table de règles v${stamp.rulesVersion}.`,
    margin + 5,
    currentY + 20,
  );

  currentY += 34;

  // === PIED DE PAGE SUR TOUTES LES PAGES ===
  // La mention légale est répétée sur chaque page, pas seulement en couverture :
  // un rapport se diffuse souvent page par page, en capture ou en extrait, et
  // une mention qui ne survit pas au découpage ne protège personne (CdC §9.4).
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(120, 130, 145);
    const disclaimerLines = doc.splitTextToSize(stamp.disclaimer, contentWidth);
    doc.text(disclaimerLines.slice(0, 2), pageWidth / 2, pageHeight - 12, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Smart Creator Intelligence Platform • Confidentiel • Page ${i} sur ${totalPages}`,
      pageWidth / 2,
      pageHeight - 6,
      { align: 'center' },
    );
  }

  // Save file
  const cleanName = report.nicheName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
  doc.save(`SMART_LIFE_Rapport_${cleanName}.pdf`);
}
