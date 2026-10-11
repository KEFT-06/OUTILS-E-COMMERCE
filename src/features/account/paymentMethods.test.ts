import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { operatorTone, readablePhone } from '@/features/account/paymentMethods';

/**
 * Ce que le client relit avant de payer par Mobile Money : son numéro, tel que la demande partira.
 * Une demande envoyée au mauvais numéro fait sonner le téléphone de quelqu'un d'autre.
 */
describe('Paiement par Mobile Money, côté écran', () => {
  it('redonne le numéro avec l’indicatif du pays, par groupes lisibles', () => {
    assert.equal(readablePhone('677123456', '237'), '+237 677 12 34 56');
    assert.equal(readablePhone('6 77 12-34.56', '237'), '+237 677 12 34 56');
    assert.equal(readablePhone('237677123456', '237'), '+237 677 12 34 56', 'indicatif déjà saisi : pas répété');
    assert.equal(readablePhone('0708091011', '225'), '+225 07 08 09 10 11', 'le zéro ivoirien reste');
    assert.equal(readablePhone('677123456', null), '677 12 34 56');
    assert.equal(readablePhone('', '237'), '');
  });

  it('donne à chaque opérateur une pastille reconnaissable, et une neutre aux inconnus', () => {
    assert.match(operatorTone('mtn'), /FFCB05/);
    assert.match(operatorTone('ORANGE'), /FF7900/);
    assert.match(operatorTone('wave'), /1DC8FF/);
    assert.equal(operatorTone('operateur-inconnu'), 'bg-muted text-foreground');
  });
});
