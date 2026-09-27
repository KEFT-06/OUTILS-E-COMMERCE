import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAmount } from '@/shared/lib/parseAmount';

/**
 * Lecture des montants tapés par les utilisateurs.
 *
 * Les deux premiers cas justifient à eux seuls ce fichier : « 50 000 » et « 50.000 » sont les
 * façons ordinaires d'écrire cinquante mille francs CFA, et les trois lectures précédentes du
 * site y lisaient 50. Un paiement enregistré, ou le budget d'une campagne, partait mille fois
 * trop petit sans que rien ne le signale.
 */
describe('Lecture d’un montant', () => {
  it('lit « 50 000 » et « 50.000 » comme cinquante mille, et non cinquante', () => {
    assert.equal(parseAmount('50 000'), 50_000);
    assert.equal(parseAmount('50.000'), 50_000);
    assert.equal(parseAmount('50 000'), 50_000, 'espace insécable, celle que produisent les tableurs');
    assert.equal(parseAmount('50 000'), 50_000, 'espace fine insécable, celle du formatage français');
  });

  it('retire la devise en tête ou en fin', () => {
    assert.equal(parseAmount('50 000 FCFA'), 50_000);
    assert.equal(parseAmount('25 000 XAF'), 25_000);
    assert.equal(parseAmount('€ 12,50'), 12.5);
    assert.equal(parseAmount('$1,500.50'), 1500.5);
  });

  it('prend la dernière marque comme décimale quand point et virgule se côtoient', () => {
    assert.equal(parseAmount('1.500,50'), 1500.5, 'écriture française');
    assert.equal(parseAmount('1,500.50'), 1500.5, 'écriture anglaise');
    assert.equal(parseAmount('1.500.000,25'), 1_500_000.25);
  });

  it('lit les décimales ordinaires', () => {
    assert.equal(parseAmount('1,5'), 1.5);
    assert.equal(parseAmount('12.50'), 12.5);
    assert.equal(parseAmount('0,75'), 0.75);
    assert.equal(parseAmount('7'), 7);
  });

  it('garde le signe, pour un taux de croissance', () => {
    assert.equal(parseAmount('-12,5 %'), -12.5);
    assert.equal(parseAmount('+35 %'), 35);
    assert.equal(parseAmount('1.200 %'), 1200, 'un taux à quatre chiffres, et non 1,2');
  });

  it('refuse plutôt que de deviner ce qui ne se lit pas proprement', () => {
    for (const illisible of ['', '   ', 'abc', '1.2.3', '12a34', '1e9', '0x10', '5-3', '1.500,50,2']) {
      assert.equal(parseAmount(illisible), null, `« ${illisible} » doit être refusé`);
    }
    assert.equal(parseAmount(null), null);
    assert.equal(parseAmount(undefined), null);
  });
});
