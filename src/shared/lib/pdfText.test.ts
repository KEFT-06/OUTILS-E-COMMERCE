import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jsPDF } from 'jspdf';
import { toPdfSafe } from '@/shared/lib/pdfText';

/** Ce que jsPDF écrit réellement dans le flux de la page pour une ligne de texte. */
function emitted(text: string): string {
  const doc = new jsPDF({ compress: false });
  doc.setFont('helvetica', 'normal');
  doc.text(text, 10, 10);
  return doc.output().split('\n').find((line) => line.endsWith(' Tj')) ?? '';
}

describe('Texte d’un export PDF', () => {
  it('ne laisse aucun caractère qui ferait passer la ligne entière sur deux octets', () => {
    for (const texte of ['Ŋgaoundéré — cœur', 'Bāmako ğ ok', 'Prix : 50\u202f000 FCFA', 'Emoji 🚀 fin']) {
      const ligne = emitted(toPdfSafe(texte));
      assert.ok(!ligne.includes('\u0000'), `« ${texte} » sort illisible : ${JSON.stringify(ligne)}`);
    }
  });

  it('garde le français et la typographie de Windows-1252', () => {
    assert.equal(toPdfSafe('L’été — 5 € « cœur » …'), 'L’été — 5 € « cœur » …');
  });

  it('remplace les espaces fines par des espaces au lieu de coller les chiffres', () => {
    assert.equal(toPdfSafe('50\u202f000\u2009FCFA'), '50 000 FCFA');
  });

  it('garde les retours à la ligne mais retire les caractères de contrôle', () => {
    assert.equal(toPdfSafe('a\nb\u0007c\u0092d'), 'a\nbcd');
  });
});
