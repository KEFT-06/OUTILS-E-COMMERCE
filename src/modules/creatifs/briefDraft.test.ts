import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assainirBrouillon } from '@/modules/creatifs/briefDraft';

/**
 * Brouillon du brief des créatifs, relu sans lui faire confiance.
 *
 * Le cas qui justifie ces tests n'est pas imaginaire : un auteur qui a commencé un brief vidéo
 * avant la bascule vers Veo a, dans son navigateur, une durée de cinq secondes et peut-être le
 * format carré. Le modèle refuse les deux. Restaurés tels quels, ils feraient échouer son
 * premier envoi — sur un formulaire qu'il croit valide, puisque c'est le sien.
 */
describe('Brouillon du brief des créatifs', () => {
  it('ramène un brouillon vidéo d’avant la bascule à ce que le modèle accepte', () => {
    const ancien = { kind: 'video', format: '1:1', duration: 5, productName: 'Formation couture' };
    const repris = assainirBrouillon(ancien);

    assert.equal(repris.kind, 'video');
    assert.equal(repris.format, '9:16', 'le carré n’existe pas en vidéo : on retombe sur le vertical');
    assert.equal(repris.duration, 6, 'cinq secondes sont refusées : on retombe sur une durée acceptée');
    assert.equal(repris.productName, 'Formation couture', 'le travail de l’auteur, lui, est gardé');
  });

  it('garde le carré pour un visuel, dont le modèle sait le faire', () => {
    assert.equal(assainirBrouillon({ kind: 'visual', format: '1:1' }).format, '1:1');
  });

  it('borne les longueurs aux limites du serveur', () => {
    const repris = assainirBrouillon({ sceneDescription: 'x'.repeat(5_000), productName: 'y'.repeat(500) });
    assert.equal(repris.sceneDescription?.length, 1500);
    assert.equal(repris.productName?.length, 120);
  });

  it('rend un formulaire vide plutôt que d’échouer sur un contenu illisible', () => {
    for (const brut of [null, 'texte', 42, [], undefined]) {
      assert.doesNotThrow(() => assainirBrouillon(brut));
    }
    assert.deepEqual(assainirBrouillon(null), {});
  });

  it('écarte un code pays mal formé plutôt que de l’envoyer au serveur', () => {
    assert.equal('market' in assainirBrouillon({ market: 'france' }), false);
    assert.equal(assainirBrouillon({ market: 'CM' }).market, 'CM');
  });
});
