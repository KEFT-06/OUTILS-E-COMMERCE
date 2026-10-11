import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DigitalProductIdea, MarketAnalysisReport } from '@/shared/types/analysis';
import type { StorybookEntry } from '@/shared/types/storybook';
import { productSections, reportSections, storybookSections, textOf } from './sources';

/**
 * Ce qui part à la traduction pour chaque sorte d'œuvre : un ebook, un rapport d'analyse, un conte.
 */

describe('le texte d’une œuvre à traduire', () => {
  it('un ebook : sa promesse, son public, puis chaque module', () => {
    const ebook = {
      transformationPromise: 'Vendre vos premiers œufs en trois mois.',
      targetAudience: 'Citadins qui débutent.',
      tableOfContents: [
        { moduleNumber: 1, title: 'Le poulailler', details: 'Un mètre carré pour quatre poules.' },
        { moduleNumber: 2, title: 'L’alimentation', details: '' },
      ],
    } as unknown as DigitalProductIdea;
    const sections = productSections(ebook);
    assert.deepEqual(sections.map((section) => section.heading), ['Promesse', 'Pour qui', 'Module 1 — Le poulailler', 'Module 2 — L’alimentation']);
    assert.equal(sections[2]!.body, 'Un mètre carré pour quatre poules.');
    assert.equal(new Set(sections.map((section) => section.id)).size, 4, 'chaque section a son identifiant');
  });

  const rapport = {
    executiveSummary: 'La demande existe et reste peu servie.',
    verdictRationale: 'Peu d’offres en français.',
    keyFindings: [{ title: 'Les débutants cherchent un budget', detail: 'Trois questions sur quatre portent sur le coût.', sourceIds: [] }],
    audience: { profile: 'Citadins de 25 à 40 ans.', pains: ['Le bruit'], motivations: ['Des œufs frais'], objections: [], sourceIds: [] },
    pricing: { observed: 'De 3 000 à 7 000 FCFA.', recommendation: 'Commencer à 5 000 FCFA.', paymentMethods: [], sourceIds: [] },
    channels: [{ channel: 'WhatsApp', why: 'les groupes de quartier' }],
    competitors: [{ id: 'c1', name: 'Ferme Urbaine', urlOrHandle: '', priceRange: '', positioning: 'Vend des poussins.', strengths: ['Livraison'], weaknesses: [], exploitableGaps: ['Aucun guide'] }],
    risks: [{ risk: 'Plaintes du voisinage', mitigation: 'limiter à dix poules', sourceIds: [] }],
    strategicActionPlan: [{ phase: 'Semaine 1', title: 'Tester l’offre', steps: ['Écrire la page', 'Prévenir dix contacts'] }],
  } as unknown as MarketAnalysisReport;

  it('un rapport : son rapport rédigé quand il existe', () => {
    const sections = reportSections(rapport, { status: 'ready', markdown: '# Le marché\nLa demande est réelle.\n\n# Les prix\nDe 3 000 à 7 000 FCFA.' });
    assert.deepEqual(sections.map((section) => section.heading), ['Le marché', 'Les prix']);
    assert.equal(sections[1]!.body, 'De 3 000 à 7 000 FCFA.');
  });

  it('un rapport sans rapport rédigé (ou encore en cours d’écriture) : l’étude, rubrique par rubrique', () => {
    for (const enCours of [null, { status: 'writing' as const, markdown: null }, { status: 'ready' as const, markdown: '   ' }]) {
      const sections = reportSections(rapport, enCours);
      assert.deepEqual(
        sections.map((section) => section.heading),
        ['Synthèse', 'Les débutants cherchent un budget', 'Public visé', 'Prix', 'Canaux', 'Concurrent — Ferme Urbaine', 'Risques', 'Semaine 1 — Tester l’offre'],
      );
      const texte = textOf(sections);
      for (const attendu of ['La demande existe', 'Peu d’offres en français', 'Ce qui lui pèse :\n- Le bruit', 'Commencer à 5 000 FCFA', '- WhatsApp : les groupes de quartier', 'Ouvertures :\n- Aucun guide', 'limiter à dix poules', '- Prévenir dix contacts']) {
        assert.ok(texte.includes(attendu), `le texte porte « ${attendu} »`);
      }
      assert.ok(!texte.includes('Ce qui le retient'), 'une rubrique vide n’est pas annoncée');
    }
  });

  it('un conte : le texte de chaque page, dans l’ordre, sans les consignes d’illustration', () => {
    const conte = {
      story: {
        title: 'Le petit manguier d’Awa',
        characterSheet: 'Awa, huit ans, robe jaune.',
        coverIllustration: 'Une fillette sous un manguier.',
        pages: [
          { heading: 'La graine', text: 'Awa trouva une graine au marché.', illustration: 'Une main tenant une graine.' },
          { heading: '', text: 'Elle la planta derrière la maison.', illustration: 'Un trou dans la terre.' },
        ],
      },
    } as unknown as StorybookEntry;
    const sections = storybookSections(conte);
    assert.deepEqual(sections.map((section) => [section.heading, section.body]), [['La graine', 'Awa trouva une graine au marché.'], ['Page 2', 'Elle la planta derrière la maison.']]);
    assert.ok(!textOf(sections).includes('Une main tenant'), 'les consignes d’illustration ne partent pas à la traduction');
  });
});
