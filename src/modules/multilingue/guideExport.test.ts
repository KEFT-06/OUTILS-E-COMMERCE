import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type GuideExportDocument, guideComplianceSections } from '@/modules/multilingue/guideExport';

const guide = (sections: GuideExportDocument['sections']): GuideExportDocument => ({
  guideId: 'g1',
  title: 'Vendre son savoir-faire en ligne',
  language: 'fr',
  direction: 'ltr',
  sections,
  level: null,
  coverId: null,
});

describe('Conformité d’un guide avant export', () => {
  it('soumet le titre et chaque partie, étiquetée par son intitulé', () => {
    const sections = guideComplianceSections(
      guide([
        { id: 's1', heading: 'Trouver ses clients', body: 'Commencez par votre entourage.' },
        { id: 's2', heading: '', body: 'Gagnez 500 000 FCFA par mois.' },
      ]),
    );
    assert.deepEqual(
      sections.map((section) => section.label),
      ['Titre du guide', 'Trouver ses clients', 'Partie 2'],
    );
    assert.match(sections[2]!.text, /500 000 FCFA/, 'le corps est bien vérifié');
  });

  it('découpe une partie trop longue au lieu d’en tronquer la fin', () => {
    const long = `${'a'.repeat(30_000)} Gagnez 1 000 000 FCFA`;
    const sections = guideComplianceSections(guide([{ id: 's1', heading: 'Longue', body: long }]));
    const parties = sections.filter((section) => section.label === 'Longue');
    assert.equal(parties.length, 2);
    assert.ok(parties.every((section) => section.text.length <= 18_000));
    assert.match(parties.at(-1)!.text, /1 000 000 FCFA/, 'la fin du texte est vérifiée');
  });
});
