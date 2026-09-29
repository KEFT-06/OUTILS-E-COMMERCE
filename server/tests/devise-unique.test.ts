import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Une seule devise à l'écran : celle du pays de l'utilisateur (décision du 29/09/2026).
 * Les fourchettes du simulateur, écrites en euros, s'affichaient telles quelles à tout le monde.
 */

let app: Express;
before(async () => {
  app = await createTestApp();
});
after(closeTestApp);

describe('Devise unique', () => {
  it('rend les fourchettes de prix dans la devise demandée, bornes arrondies et repères relibellés', async () => {
    const euros = (await request(app).get('/api/pricing/ranges').expect(200)).body;
    assert.equal(euros.currency, 'EUR');

    const fcfa = (await request(app).get('/api/pricing/ranges?currency=XAF').expect(200)).body;
    assert.equal(fcfa.currency, 'XAF');
    assert.equal(fcfa.currencySymbol, 'FCFA');
    // 9 € ≈ 5 904 FCFA, arrondi à un prix « propre ».
    assert.equal(fcfa.sellingPrice.min, 5_900);
    assert.ok(fcfa.sellingPrice.max > 100_000);
    assert.ok(fcfa.sellingPrice.default >= fcfa.sellingPrice.min && fcfa.sellingPrice.default <= fcfa.sellingPrice.max);
    assert.ok(fcfa.sellingPrice.step >= 100, 'un pas utilisable sur un curseur en francs');
    for (const mark of [...fcfa.sellingPrice.marks, ...fcfa.adCostPerAcquisition.marks]) {
      assert.doesNotMatch(mark.label, /€|\$/, `repère sans devise étrangère : ${mark.label}`);
      assert.match(mark.label, /FCFA/);
    }
    assert.match(fcfa.adCostPerAcquisition.marks[0].label, /\(Viral\)/, 'la précision du repère est gardée');
    assert.ok(fcfa.productTypeRanges.every((range: { min: number; max: number }) => range.min > 1_000 && range.max > range.min));

    // Devise inconnue : la table d'origine, plutôt qu'une conversion inventée.
    assert.equal((await request(app).get('/api/pricing/ranges?currency=ZZZ').expect(200)).body.currency, 'EUR');
  });

  it('sert les taux de change à tous, en cache public', async () => {
    const response = await request(app).get('/api/currency/rates').expect(200);
    assert.equal(response.body.base, 'EUR');
    assert.equal(response.body.rates.XAF, 655.957);
    assert.match(String(response.headers['cache-control']), /^public, /);
    assert.equal(response.headers['set-cookie'], undefined);
  });

  it('donne au rédacteur les taux vers la devise de l’utilisateur', async () => {
    const { conversionHints, getRates } = await import('@server/services/currency');
    const hints = conversionHints('XAF', await getRates());
    assert.match(hints, /1 EUR = 656 XAF/);
    assert.doesNotMatch(hints, /1 XAF =/, 'pas de taux de la devise vers elle-même');
  });
});
