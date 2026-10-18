import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pointValueOf } from '@/shared/lib/plans';
import type { PlanCatalog, PlanDefinition } from '@/shared/types/auth';

const palier = (id: string, label: string, monthly: number, monthlyCredits: number | null) =>
  ({ id, label, monthlyCredits, price: { currency: 'XAF', monthly, yearly: monthly * 10, converted: false } }) as unknown as PlanDefinition;

const catalogue = {
  plans: [palier('free', 'Gratuit', 0, 3), palier('plus', 'Plus', 4_900, 20), palier('pro', 'Pro', 9_900, 60), palier('elite', 'Elite Enterprise', 49_900, null)],
} as unknown as PlanCatalog;

/*
  Relevé le 18/10/2026 : « 60 points · équivalent 15 000 FCFA » au palier Pro, qui coûte 9 900 FCFA
  pour ces 60 points. La valeur d'un point est celle que le client paie.
*/
describe('Valeur d’un point', () => {
  it('se lit sur le prix du palier du compte', () => {
    const pro = pointValueOf(catalogue, 'pro')!;
    assert.equal(pro.value * 60, 9_900, '60 points valent ce que coûte le palier Pro');
    assert.equal(pro.ownPlan, true);
  });

  it('au palier gratuit ou illimité, se lit sur le premier palier payant', () => {
    for (const plan of ['free', 'elite']) {
      const valeur = pointValueOf(catalogue, plan)!;
      assert.equal(valeur.planLabel, 'Plus');
      assert.equal(valeur.value, 245);
      assert.equal(valeur.ownPlan, false);
    }
  });

  it('sans catalogue, ne donne aucun montant', () => {
    assert.equal(pointValueOf(null, 'pro'), null);
  });
});
