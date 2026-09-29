import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Règle « promesses de gains chiffrées » : elle bloque tout montant de gain annoncé, mais un
 * prix payé par période n'est pas un gain. Le rapport rédigé d'une analyse citait « une
 * scolarité de 150 000 FCFA par an » et se voyait refuser l'export (essai réel du 29/09/2026).
 */

let checkText: typeof import('@server/services/compliance').checkText;

before(async () => {
  await createTestApp();
  ({ checkText } = await import('@server/services/compliance'));
});

after(closeTestApp);

const blocked = async (text: string) => (await checkText(text)).findings.some((finding) => finding.ruleId === 'earnings-claim' && finding.severity === 'block');

describe('Promesses de gains chiffrées', () => {
  it('bloque toujours un gain annoncé, avec ou sans verbe', async () => {
    for (const text of [
      'Avec cette méthode, gagnez 500 000 FCFA par mois.',
      'Encaissez jusqu’à 2 000 € dès la première semaine.',
      '500 000 FCFA/mois garantis dès le premier mois.',
      'Au prix d’un café, générez 300 000 FCFA par mois.',
      'Un revenu de 400 000 FCFA sans effort.',
    ]) {
      assert.ok(await blocked(text), text);
    }
  });

  it('lit l’apostrophe typographique comme l’apostrophe droite', async () => {
    // Les textes rédigés emploient « ’ » : écrits ainsi, ces passages échappaient aux règles.
    const rules = async (text: string) => (await checkText(text)).findings.map((finding) => finding.ruleId);
    assert.ok((await rules('Un chiffre d’affaires de 3 000 000 FCFA dès le lancement.')).includes('earnings-claim'));
    assert.ok((await rules('J’ai gagné 300 000 FCFA le mois dernier.')).includes('unsubstantiated-testimonial'));
    assert.ok((await rules('J’étais sans emploi ; aujourd’hui je gagne ma vie.')).includes('before-after'));
  });

  it('laisse passer un prix, un abonnement ou des frais par période', async () => {
    for (const text of [
      'Trois ans ; scolarité de 150 000 FCFA par an [1].',
      'Abonnement : 5 000 FCFA/mois, sans engagement.',
      'Le tarif affiché est de 15 000 FCFA par mois pour l’accès aux cours.',
      'Frais d’inscription de 25 000 FCFA par an, matériel non compris.',
      'Une formation qui coûte 10 000 FCFA par mois selon la page de vente [3].',
    ]) {
      assert.equal(await blocked(text), false, text);
    }
  });
});
