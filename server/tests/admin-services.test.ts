import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createAdmin, createTestApp } from './support/helpers';

/**
 * État des services : réservé à l'administration, sans aucune clé dans la réponse, et un conseil
 * concret pour chaque service absent ou injoignable. Les fournisseurs sont injoignables ici.
 */

let app: Express;

before(async () => {
  app = await createTestApp({ SEBPAY_PUBLIC_KEY: 'pk_test_sebpay_0000', SEBPAY_SECRET_KEY: 'sk_test_sebpay_secret_0000' });
});

after(closeTestApp);

describe('État des services', () => {
  it('liste chaque service avec son état et ce qu’il faut faire, sans révéler de clé', async () => {
    const { agent } = await createAdmin(app, 'admin-services@smartcreator.test');
    const response = await agent.get('/api/admin/services').expect(200);
    const report = response.body as {
      serverIp: string | null;
      services: { id: string; state: string; detail: string; action: string | null }[];
    };

    const byId = Object.fromEntries(report.services.map((service) => [service.id, service]));
    assert.deepEqual(Object.keys(byId).sort(), ['chariow', 'database', 'email', 'gamma', 'gemini', 'gemini-images', 'higgsfield', 'perplexity', 'sebpay', 'stripe']);

    assert.equal(byId.database!.state, 'warning', 'base embarquée : pas en ligne');
    assert.match(byId.database!.action ?? '', /Session pooler/);
    assert.equal(byId.perplexity!.state, 'error', 'sans Perplexity, l’analyse est refusée');
    assert.equal(byId.gamma!.state, 'off');
    assert.equal(byId.stripe!.state, 'off');
    assert.equal(byId.email!.state, 'off');
    assert.match(byId.email!.action ?? '', /Brevo/);
    assert.equal(byId.gemini!.state, 'warning', 'fournisseur injoignable : à surveiller, pas en panne');
    assert.equal(byId['gemini-images']!.state, 'warning');
    assert.equal(byId.sebpay!.state, 'warning');
    assert.equal(report.serverIp, null);

    const body = JSON.stringify(response.body);
    for (const secret of ['cle-gemini-de-test', 'secret-de-test', 'sk_test_cle_du_proprietaire_0000', 'sk_test_sebpay_secret_0000', 'pk_test_sebpay_0000']) {
      assert.ok(!body.includes(secret), `aucune clé dans la réponse (${secret})`);
    }
  });

  it('est refusé aux comptes sans privilège', async () => {
    const { agent } = await signInWithPlan(app, 'membre-services@exemple.com', 'pro');
    await agent.get('/api/admin/services').expect(403);
  });
});
