import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REPORT_WORDS_PER_PAGE } from '@server/shared/reportLength';
import { buildDocumentPDF } from '@/shared/lib/documentPdf';
import type { ReportDocument } from '@/shared/types/analysis';

/**
 * La longueur commandée est la longueur livrée.
 *
 * L'auteur choisit un nombre de pages ; le rédacteur reçoit un nombre de mots, calculé avec
 * `REPORT_WORDS_PER_PAGE`. Ce test refait la mesure sur la vraie mise en page du PDF : un rapport
 * structuré comme un rédacteur l'écrit — sous-titres, paragraphes, une liste par sous-partie — doit
 * sortir au nombre de pages demandé, à dix pour cent près. Le serveur comptait 380 mots par page
 * quand le PDF en contient 460 : un rapport commandé à 250 pages sortait à 207.
 */

const SENTENCE = 'Les éleveurs débutants cherchent surtout des gestes concrets pour préparer le poulailler, choisir les poussins et vendre la production sans intermédiaire [1].';
const paragraph = (sentences: number) => Array.from({ length: sentences }, () => SENTENCE).join(' ');
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Une sous-partie telle qu'un rédacteur l'écrit : un sous-titre, deux paragraphes, une liste. */
const BLOCK = [
  '#### Ce que les sources établissent',
  paragraph(4),
  paragraph(3),
  ['- Valider la demande avec une page de précommande pendant deux semaines.', '- Lancer un premier module court, puis l’enrichir.', '- Fixer le prix d’entrée sous celui de la formation concurrente relevée.', '- Réunir dix avis avant d’élargir la diffusion.'].join('\n'),
].join('\n\n');

/** Un rapport d'environ `pages` pages, au nombre de mots que le serveur demanderait. */
function reportOf(pages: number): string {
  const target = pages * REPORT_WORDS_PER_PAGE;
  const blocks = ['# Rapport de mesure'];
  let written = 0;
  for (let index = 0; written < target; index += 1) {
    if (index % 24 === 0) blocks.push(`## Chapitre ${index / 24 + 1}`);
    if (index % 4 === 0) blocks.push(`### Partie ${index / 4 + 1}`);
    blocks.push(BLOCK);
    written += words(BLOCK);
  }
  return blocks.join('\n\n');
}

const pagesOf = (markdown: string) =>
  buildDocumentPDF(
    { reportId: 'mesure', status: 'ready', title: 'Rapport de mesure', markdown, bibliography: [], compliance: null, error: null, startedAt: '2026-10-12T08:00:00.000Z', completedAt: '2026-10-12T08:20:00.000Z', targetPages: null, progress: null } as ReportDocument,
    { nicheName: 'mesure', dateLabel: '12 octobre 2026' },
    { rulesVersion: 'mesure', checkedAt: '2026-10-12T08:20:00.000Z', warningCount: 0, disclaimer: 'Document d’information, sans garantie de résultat.' },
  ).getNumberOfPages();

describe('Longueur du rapport rédigé', () => {
  it('un rapport commandé à N pages sort à N pages, à dix pour cent près', () => {
    for (const requested of [10, 40, 100]) {
      const delivered = pagesOf(reportOf(requested));
      assert.ok(Math.abs(delivered - requested) <= requested * 0.1, `commandé ${requested} pages, livré ${delivered}`);
    }
  });

  it('tient pour 250 pages : le plus long rapport proposé', () => {
    const delivered = pagesOf(reportOf(250));
    assert.ok(delivered >= 230 && delivered <= 270, `commandé 250 pages, livré ${delivered}`);
  });
});
