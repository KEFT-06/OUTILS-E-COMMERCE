import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseInline, parseMarkdown, plainInline } from '@/shared/lib/markdownBlocks';

/**
 * Le rapport rédigé arrive en Markdown : l'écran et le PDF le relisent en blocs, sans jamais
 * injecter de HTML. Les formes qu'un rédacteur produit réellement doivent toutes être lues.
 */
describe('Lecture du Markdown des rapports', () => {
  it('reconnaît titres, paragraphes, listes, citations, tableaux et séparateurs', () => {
    const blocks = parseMarkdown(
      [
        '# Rapport : apiculture',
        '',
        '## Le marché',
        'Une première ligne',
        'qui continue [1].',
        '',
        '- premier point',
        '- second point',
        '  qui déborde',
        '',
        '1. étape une',
        '2) étape deux',
        '',
        '> Une citation',
        '> sur deux lignes',
        '',
        '| Offre | Prix |',
        '|---|:---:|',
        '| Guide | 5 000 FCFA [2] |',
        '',
        '---',
        '### Suite ###',
      ].join('\n'),
    );
    assert.deepEqual(blocks, [
      { type: 'heading', level: 1, text: 'Rapport : apiculture' },
      { type: 'heading', level: 2, text: 'Le marché' },
      { type: 'paragraph', text: 'Une première ligne qui continue [1].' },
      { type: 'list', ordered: false, items: ['premier point', 'second point qui déborde'] },
      { type: 'list', ordered: true, items: ['étape une', 'étape deux'] },
      { type: 'quote', text: 'Une citation sur deux lignes' },
      { type: 'table', header: ['Offre', 'Prix'], rows: [['Guide', '5 000 FCFA [2]']] },
      { type: 'rule' },
      { type: 'heading', level: 3, text: 'Suite' },
    ]);
  });

  it('sépare gras, italique et renvois, et ne garde que le texte des liens', () => {
    assert.deepEqual(parseInline('Un **fait établi** [3], une *hypothèse* et [un site](https://piege.example).'), [
      { type: 'text', text: 'Un ' },
      { type: 'text', text: 'fait établi', bold: true },
      { type: 'text', text: ' ' },
      { type: 'citation', id: 3 },
      { type: 'text', text: ', une ' },
      { type: 'text', text: 'hypothèse', italic: true },
      { type: 'text', text: ' et ' },
      { type: 'text', text: 'un site' },
      { type: 'text', text: '.' },
    ]);
    assert.equal(plainInline('**Prix** : 5 000 FCFA [2]'), 'Prix : 5 000 FCFA [2]');
  });

  it('laisse intacts les tirets bas au milieu des mots et le HTML reste du texte', () => {
    assert.equal(plainInline('mon_fichier_final'), 'mon_fichier_final');
    assert.deepEqual(parseMarkdown('<script>alert(1)</script>'), [{ type: 'paragraph', text: '<script>alert(1)</script>' }]);
  });
});
