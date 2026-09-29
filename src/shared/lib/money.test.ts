import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { convertMoney, normalizeCurrency } from '@/shared/lib/money';

/** Conversion des montants vers la devise de l'utilisateur, sans jamais inventer de taux. */
describe('Montants dans la devise de l’utilisateur', () => {
  const rates = { base: 'EUR', updatedAt: '2026-09-29', rates: { EUR: 1, XAF: 655.957, XOF: 655.957, USD: 1.08 } };

  it('reconnaît les libellés usuels', () => {
    assert.equal(normalizeCurrency('FCFA'), 'XAF');
    assert.equal(normalizeCurrency('€'), 'EUR');
    assert.equal(normalizeCurrency(' usd '), 'USD');
    assert.equal(normalizeCurrency(''), null);
  });

  it('convertit par l’euro, et refuse un taux inconnu', () => {
    assert.equal(convertMoney(10, 'EUR', 'XAF', rates), 6559.57);
    assert.equal(convertMoney(5_000, 'XOF', 'XAF', rates), 5_000, 'franc CFA de l’Ouest et du Centre : même parité');
    assert.equal(Math.round(convertMoney(199.99, 'USD', 'XAF', rates)!), 121_467);
    assert.equal(convertMoney(10, 'NGN', 'XAF', rates), null, 'aucun taux : pas de montant inventé');
    assert.equal(convertMoney(10, 'XAF', 'XAF', null), 10);
  });
});
