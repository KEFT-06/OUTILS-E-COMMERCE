import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOOK_FORMAT_RULE, normalizeBookText, parseBookText, sectionTitles } from '@server/shared/bookText';

/**
 * Structure d'un texte d'ouvrage. Les textes ci-dessous sont repris du premier ebook sorti du
 * site (04/10/2026), dont les titres étaient perdus au milieu du texte et dont deux modules
 * tenaient en un seul paragraphe.
 */
describe('Texte d’ouvrage', () => {
  it('lit les titres, sous-titres, paragraphes et listes écrits selon la règle', () => {
    const blocs = parseBookText(
      [
        '## Gestion du temps et régulation de la parole',
        '',
        'Une gestion rigoureuse du temps garantit la régularité des membres.',
        '',
        '### Fixer une structure horaire claire',
        '',
        'Pour une séance de 90 minutes, établissez un découpage strict :',
        '',
        '1. Accueil et prière d’ouverture.',
        '2. Lecture du passage biblique.',
        '',
        'Pour canaliser un participant bavard :',
        '- Interrompez poliment lors d’une respiration.',
        '- Orientez la question vers un autre secteur de la pièce.',
      ].join('\n'),
    );
    assert.deepEqual(
      blocs.map((bloc) => bloc.type),
      ['h2', 'p', 'h3', 'p', 'ol', 'p', 'ul'],
    );
    assert.deepEqual(sectionTitles(blocs), ['Gestion du temps et régulation de la parole']);
    assert.deepEqual(blocs[4], { type: 'ol', items: ['Accueil et prière d’ouverture.', 'Lecture du passage biblique.'] });
    assert.deepEqual(blocs[6], { type: 'ul', items: ['Interrompez poliment lors d’une respiration.', 'Orientez la question vers un autre secteur de la pièce.'] });
  });

  it('reconnaît un sous-titre resté en clair, sans prendre pour un titre une phrase ou une annonce de liste', () => {
    const blocs = parseBookText(
      [
        'Gestion du temps et régulation de la parole',
        '',
        'Une gestion rigoureuse du temps garantit la régularité.',
        '',
        'Appliquer la règle de l’écoute active sans interruption',
        '',
        'Pour mettre en œuvre l’écoute active, appliquez ces règles :',
        '- Reformulez les propos de l’intervenant.',
      ].join('\n'),
    );
    assert.deepEqual(
      blocs.map((bloc) => bloc.type),
      ['h3', 'p', 'h3', 'p', 'ul'],
    );
    assert.equal(blocs[3]!.type === 'p' && blocs[3]!.text, 'Pour mettre en œuvre l’écoute active, appliquez ces règles :');
  });

  it('redécoupe une liste écrasée dans un seul paragraphe', () => {
    const pave =
      'Un déroulé d’étude biblique réussi repose sur une progression naturelle entre l’observation du texte, son interprétation et son application pratique dans la vie quotidienne, sans coupure brutale pour l’assemblée. ' +
      '1. Passer du contexte à l’observation : orientez l’attention des participants sur le texte. ' +
      '2. Passer de l’observation à l’interprétation : basculez vers la recherche du sens. ' +
      '3. Passer de l’interprétation à l’application : amenez le groupe vers les réalités du quotidien. ' +
      'Pour conserver une posture de facilitateur : - Gardez la fiche de réponses posée à plat devant vous. - Considérez les réponses rédigées comme des limites de sécurité. - Ne corrigez pas brutalement une intervention maladroite.';
    const blocs = parseBookText(pave);
    assert.deepEqual(
      blocs.map((bloc) => bloc.type),
      ['p', 'ol', 'p', 'ul'],
    );
    assert.equal(blocs[1]!.type === 'ol' && blocs[1]!.items.length, 3);
    // La phrase qui annonce la liste ouvre sa propre ligne, au lieu de rester collée à la dernière étape.
    assert.equal(blocs[2]!.type === 'p' && blocs[2]!.text, 'Pour conserver une posture de facilitateur :');
    assert.equal(blocs[3]!.type === 'ul' && blocs[3]!.items.length, 3);
    // Un paragraphe ordinaire, même long, n'est pas touché ; ni une année suivie d'un chiffre.
    const ordinaire = `${'Le groupe se réunit chaque semaine. '.repeat(14)}En 2024. 3 personnes ont rejoint la cellule.`;
    assert.deepEqual(
      parseBookText(ordinaire).map((bloc) => bloc.type),
      ['p'],
    );
  });

  it('remet au propre un texte tout juste rédigé', () => {
    const propre = normalizeBookText('**Fixer une structure horaire**\n\n\n\nLe **temps** est compté.   \n# Titre trop gros\n#### Détail');
    assert.equal(propre, '### Fixer une structure horaire\n\nLe temps est compté.\n## Titre trop gros\n### Détail');
    assert.match(BOOK_FORMAT_RULE, /jamais de titre au milieu d’un paragraphe/);
    // Vu sur une vraie rédaction (06/10/2026) : « aucun autre signe de mise en forme » faisait
    // disparaître les apostrophes (« l animateur ») et écrire les nombres en lettres.
    assert.match(BOOK_FORMAT_RULE, /apostrophes \(l’animateur/);
    assert.match(BOOK_FORMAT_RULE, /nombres en chiffres/);
    assert.doesNotMatch(BOOK_FORMAT_RULE, /aucun autre signe/i);
    assert.equal(normalizeBookText("L'animateur n'a qu'une heure : 'plan B' reste tel quel."), "L’animateur n’a qu’une heure : 'plan B' reste tel quel.");
  });
});
