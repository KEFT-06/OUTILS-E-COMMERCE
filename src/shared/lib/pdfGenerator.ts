import { jsPDF } from 'jspdf';
import { toPdfSafe } from '@/shared/lib/pdfText';
import { blockProvenance, researchLine, writerLine } from '@/shared/lib/reportProvenance';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { usageBySource } from '@/shared/lib/sourceUsage';
import type { MarketAnalysisReport, MarketRate } from '@/shared/types/analysis';

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

const INTENT_LABEL = { transactional: 'transactionnelle', commercial: 'commerciale', informational: 'informationnelle' } as const;

function rateLine(rate: MarketRate): string {
  const value = rate.score !== null ? `${rate.score}/100` : rate.basis === 'assessment' ? 'Appréciation sourcée' : 'Non évalué';
  return toPdfSafe(`${value} — ${rate.description}`);
}


export async function generateAnalysisPDF(report: MarketAnalysisReport, stamp: PDFComplianceStamp): Promise<void> {
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
    doc.setTextColor(0, 200, 83); // Vert Smart Creator
    doc.text('Smart Creator', margin, 10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(140, 140, 140);
    doc.text(" — Rapport stratégique d'intelligence e-commerce", margin + 20, 10);
    doc.text(toPdfSafe(report.nicheName).substring(0, 40), pageWidth - margin, 10, { align: 'right' });
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.3);
    doc.line(margin, 12, pageWidth - margin, 12);
  };

  const sectionHeading = (title: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(title, margin, currentY);
    currentY += 6;
  };

  const getRateColor = (level: string | null): [number, number, number] => {
    switch (level) {
      case 'Très élevé':
        return [16, 185, 129];
      case 'Élevé':
        return [59, 130, 246];
      case 'Moyen':
        return [245, 158, 11];
      case 'Faible':
        return [239, 68, 68];
      default:
        return [100, 116, 139];
    }
  };

  // === EN-TÊTE ===
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(margin, currentY, contentWidth, 38, 3, 3, 'F');

  doc.setTextColor(248, 250, 252);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text("RAPPORT D'ANALYSE STRATÉGIQUE & VEILLE CONCURRENTIELLE", margin + 8, currentY + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(148, 163, 184);
  doc.text(toPdfSafe(`Thématique analysée : ${report.nicheName}`), margin + 8, currentY + 20);

  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text(
    toPdfSafe(`Date : ${report.dateCreated}  |  Verdict : ${report.overallVerdict ?? 'non établi'}  |  ID : #${report.id.substring(0, 12)}`),
    margin + 8,
    currentY + 30,
  );

  currentY += 44;

  // === 1. SYNTHÈSE ===
  sectionHeading('1. Synthèse et opportunité de marché');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(51, 65, 85);
  const summaryLines = doc.splitTextToSize(
    toPdfSafe(`${report.executiveSummary}${report.verdictRationale ? `\n${report.verdictRationale}` : ''}`),
    contentWidth,
  );
  checkPageBreak(summaryLines.length * 4.8);
  doc.text(summaryLines, margin, currentY);
  currentY += summaryLines.length * 4.8 + 6;

  // === 2. TAUX ===
  checkPageBreak(50);
  sectionHeading('2. Les cinq taux (demande, saturation, rentabilité, opportunité, viralité)');

  const rateItems = [report.rates.demand, report.rates.saturation, report.rates.profitability, report.rates.opportunity, report.rates.virality].filter(Boolean);
  const cardWidth = (contentWidth - 6) / 2;
  const cardHeight = 22;

  rateItems.forEach((rate, index) => {
    const col = index % 2;
    const x = margin + col * (cardWidth + 6);

    if (col === 0 && index > 0) {
      currentY += cardHeight + 4;
      checkPageBreak(cardHeight + 6);
    }

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, currentY, cardWidth, cardHeight, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text(toPdfSafe(rate.label), x + 4, currentY + 6);

    const [r, g, b] = getRateColor(rate.level);
    doc.setFillColor(r, g, b);
    doc.roundedRect(x + cardWidth - 28, currentY + 3, 24, 6, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(rate.level ?? 'Non évalué', x + cardWidth - 16, currentY + 7.2, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(doc.splitTextToSize(rateLine(rate), cardWidth - 8).slice(0, 1), x + 4, currentY + 14);

    if (rate.score !== null) {
      doc.setFillColor(226, 232, 240);
      doc.rect(x + 4, currentY + 18, cardWidth - 8, 1.8, 'F');
      doc.setFillColor(r, g, b);
      doc.rect(x + 4, currentY + 18, (cardWidth - 8) * (rate.score / 100), 1.8, 'F');
    }
  });

  currentY += cardHeight + 10;

  // === 3. MOTS-CLÉS ===
  const hasVolumes = report.searchTrends.some((keyword) => Boolean(keyword.volume));
  checkPageBreak(40);
  sectionHeading(hasVolumes ? '3. Signaux de recherche et mots-clés porteurs' : '3. Pistes de mots-clés (volumes non mesurés)');

  report.searchTrends.slice(0, 6).forEach((keyword) => {
    checkPageBreak(12);
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(margin, currentY, contentWidth, 9, 1.5, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(toPdfSafe(`• ${keyword.keyword}`), margin + 4, currentY + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    const detail = keyword.volume
      ? `Volume : ${keyword.volume}  |  Croissance : ${keyword.growthRate ?? '—'}  |  Intention : ${INTENT_LABEL[keyword.intent]}`
      : `Intention : ${INTENT_LABEL[keyword.intent]}`;
    doc.text(toPdfSafe(detail), pageWidth - margin - 4, currentY + 6, { align: 'right' });

    currentY += 11;
  });

  currentY += 4;

  // === 4. CONCURRENCE ===
  checkPageBreak(50);
  sectionHeading('4. Concurrents repérés dans les sources');

  if (report.competitors.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('Aucun concurrent établi par une source.', margin, currentY);
    currentY += 8;
  }

  report.competitors.slice(0, 4).forEach((competitor) => {
    checkPageBreak(36);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, currentY, contentWidth, 31, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(doc.splitTextToSize(toPdfSafe(`${competitor.name} (${competitor.priceRange})`), contentWidth - 10).slice(0, 1), margin + 5, currentY + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(doc.splitTextToSize(toPdfSafe(`Positionnement : ${competitor.positioning}`), contentWidth - 10).slice(0, 1), margin + 5, currentY + 11);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(220, 38, 38);
    doc.text('Faiblesses :', margin + 5, currentY + 17);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(
      doc.splitTextToSize(toPdfSafe(competitor.weaknesses.join(' • ') || 'non documentées dans les sources'), contentWidth - 38).slice(0, 1),
      margin + 28,
      currentY + 17,
    );

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text('Angle à exploiter :', margin + 5, currentY + 22);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(doc.splitTextToSize(toPdfSafe(competitor.exploitableGaps[0] || '—'), contentWidth - 45).slice(0, 1), margin + 36, currentY + 22);

    currentY += 35;
  });

  // === 5. PRODUITS ===
  checkPageBreak(55);
  sectionHeading('5. Idées de produits digitaux');

  report.digitalProducts.forEach((product) => {
    checkPageBreak(40);
    doc.setFillColor(254, 252, 232);
    doc.setDrawColor(253, 224, 71);
    doc.roundedRect(margin, currentY, contentWidth, 34, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(doc.splitTextToSize(toPdfSafe(`${product.title} [${product.typeName}]`), contentWidth - 10).slice(0, 1), margin + 5, currentY + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(180, 83, 9);
    const priceLine =
      product.recommendedPrice !== null
        ? [
            `Prix conseillé : ${product.recommendedPrice} ${product.currency}`,
            product.estimatedMarginPercent !== null ? `Marge brute : ${product.estimatedMarginPercent} %` : null,
            product.estimatedProductionDays !== null ? `Délai de création : ${product.estimatedProductionDays} j` : null,
          ]
            .filter(Boolean)
            .join('  |  ')
        : `Prix : ${product.pricingNote ?? 'à fixer par l’auteur'}`;
    doc.text(doc.splitTextToSize(toPdfSafe(priceLine), contentWidth - 10).slice(0, 1), margin + 5, currentY + 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const promiseLines = doc.splitTextToSize(toPdfSafe(`Promesse : ${product.transformationPromise}`), contentWidth - 10);
    doc.text(promiseLines.slice(0, 2), margin + 5, currentY + 17);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('Aimant à prospects :', margin + 5, currentY + 25);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    doc.text(
      doc.splitTextToSize(toPdfSafe(`${product.leadMagnet.title} (${product.leadMagnet.format})`), contentWidth - 45).slice(0, 1),
      margin + 38,
      currentY + 25,
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    const modulesText = product.tableOfContents.map((module) => `M${module.moduleNumber}: ${module.title}`).join(' | ');
    doc.text(doc.splitTextToSize(toPdfSafe(`Structure : ${modulesText}`), contentWidth - 10).slice(0, 1), margin + 5, currentY + 30);

    currentY += 38;
  });

  // === 6. SCRIPTS ===
  checkPageBreak(60);
  sectionHeading('6. Scripts vidéo publicitaires (Meta Ads)');

  report.adCampaigns.forEach((ad) => {
    checkPageBreak(50);
    doc.setFillColor(240, 249, 255);
    doc.setDrawColor(186, 230, 253);
    doc.roundedRect(margin, currentY, contentWidth, 42, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(3, 105, 161);
    doc.text(
      toPdfSafe(`Méthode ${ad.framework} (${ad.frameworkFullName}) — Format ${ad.aspectRatio} (Durée : ${ad.durationSeconds} s)`),
      margin + 5,
      currentY + 6,
    );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(doc.splitTextToSize(toPdfSafe(`Accroche 0-3 s : "${ad.hookHeadline}"`), contentWidth - 10).slice(0, 1), margin + 5, currentY + 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    const scenesText = ad.scenes.map((scene) => `[${scene.timing} ${scene.phase}] Écran : "${scene.onScreenText}" | Voix : "${scene.spokenVoiceover}"`).join('\n');
    const scenesLines = doc.splitTextToSize(toPdfSafe(scenesText), contentWidth - 10);
    doc.text(scenesLines.slice(0, 4), margin + 5, currentY + 17);

    // Pas de ligne « conformité validée » écrite en dur : le résultat réel du
    // contrôle est rendu une seule fois, en fin de document.
    currentY += 46;
  });

  // === 7. SOURCES ET LIMITES ===
  const sources = report.groundingSources ?? [];
  const sourceUsage = usageBySource(report);
  const decisions = report.decisions ?? [];
  // Ancienne forme, sur les rapports antérieurs à septembre 2026.
  const limitations = report.limitations ?? [];

  // Provenance : qui a cherché, qui a rédigé, d'où vient chaque bloc.
  checkPageBreak(30);
  sectionHeading('7. Provenance du rapport');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  for (const line of [researchLine(report), writerLine(report), ...blockProvenance(report).map((entry) => `${entry.label} : ${entry.source}`)]) {
    if (!line) continue;
    const lines = doc.splitTextToSize(toPdfSafe(line), contentWidth);
    checkPageBreak(lines.length * 4 + 2);
    doc.text(lines, margin, currentY);
    currentY += lines.length * 4 + 1.5;
  }
  currentY += 4;

  if (sources.length > 0) {
    checkPageBreak(24);
    sectionHeading('8. Sources citées');
    sources.forEach((source, index) => {
      const number = source.id ?? index + 1;
      const title = doc.splitTextToSize(toPdfSafe(`${number}. ${source.title}`), contentWidth);
      checkPageBreak(title.length * 4 + 10);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(30, 41, 59);
      doc.text(title.slice(0, 2), margin, currentY);
      currentY += Math.min(title.length, 2) * 4;
      const url = safeHttpUrl(source.url);
      if (url) {
        doc.setFontSize(7.5);
        doc.setTextColor(3, 105, 161);
        doc.textWithLink(url.length > 110 ? `${url.slice(0, 107)}...` : url, margin + 4, currentY, { url });
        currentY += 4;
      }
      // Les numéros ne figurent plus dans le corps du rapport : le lien se lit ici.
      const supports = sourceUsage.get(number) ?? [];
      if (supports.length > 0) {
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        const fonde = doc.splitTextToSize(toPdfSafe(`Fonde : ${supports.join(', ')}`), contentWidth - 4);
        doc.text(fonde.slice(0, 2), margin + 4, currentY);
        currentY += Math.min(fonde.length, 2) * 4;
      }
      currentY += 3;
    });
    currentY += 2;
  }

  if (decisions.length > 0 || limitations.length > 0) {
    checkPageBreak(24);
    const numero = sources.length > 0 ? '9' : '8';
    sectionHeading(
      decisions.length > 0
        ? `${numero}. Ce que les sources ne disent pas, et ce qui est proposé`
        : `${numero}. Points à vérifier avant de lancer`,
    );
    doc.setFontSize(8.5);

    // Une décision se lit en trois temps : le manque, la proposition en gras, puis son appui.
    // Le dossier téléchargé doit dire exactement ce que dit l'écran.
    decisions.forEach((decision) => {
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 116, 139);
      const manque = doc.splitTextToSize(toPdfSafe(decision.gap), contentWidth);
      checkPageBreak(manque.length * 4 + 14);
      doc.text(manque, margin, currentY);
      currentY += manque.length * 4 + 1;

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      const proposition = doc.splitTextToSize(toPdfSafe(decision.proposal), contentWidth);
      doc.text(proposition, margin, currentY);
      currentY += proposition.length * 4 + 1;

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      const appui = doc.splitTextToSize(toPdfSafe(`Sur quoi : ${decision.basis}`), contentWidth);
      doc.text(appui, margin, currentY);
      currentY += appui.length * 4 + 3;
    });

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    limitations.forEach((limitation) => {
      const lines = doc.splitTextToSize(toPdfSafe(`• ${limitation}`), contentWidth);
      checkPageBreak(lines.length * 4 + 2);
      doc.text(lines, margin, currentY);
      currentY += lines.length * 4 + 1.5;
    });
    currentY += 4;
  }

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
    doc.setTextColor(180, 83, 9);
    doc.text(`Aucune formulation bloquante. ${stamp.warningCount} point(s) de vigilance signalé(s).`, margin + 5, currentY + 14);
  } else {
    doc.setTextColor(4, 120, 87);
    doc.text('Aucune formulation bloquante ni point de vigilance relevé.', margin + 5, currentY + 14);
  }

  doc.setTextColor(100, 116, 139);
  doc.text(`Contrôle effectué le ${checkedLabel} — table de règles v${stamp.rulesVersion}.`, margin + 5, currentY + 20);

  currentY += 34;

  // === PIED DE PAGE SUR TOUTES LES PAGES ===
  // La mention légale est répétée sur chaque page : un rapport se diffuse souvent
  // page par page, et une mention qui ne survit pas au découpage ne protège personne.
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
    doc.text(`Smart Creator • Confidentiel • Page ${i} sur ${totalPages}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
  }

  const cleanName = report.nicheName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
  doc.save(`SmartCreator_Rapport_${cleanName}.pdf`);
}
