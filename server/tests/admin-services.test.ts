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
  app = await createTestApp({
    SEBPAY_PUBLIC_KEY: 'pk_test_sebpay_0000',
    SEBPAY_SECRET_KEY: 'sk_test_sebpay_secret_0000',
    // Fixés ici : sans eux, le contrôle des images dépendrait du .env du poste qui lance les tests.
    CLOUDFLARE_ACCOUNT_ID: '0'.repeat(32),
    CLOUDFLARE_AI_TOKEN: 'jeton-cloudflare-de-test',
  });
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
    assert.deepEqual(Object.keys(byId).sort(), ['ad-collection', 'chariow', 'database', 'email', 'gemini', 'groq', 'market-reading', 'perplexity', 'radar', 'sebpay', 'settings', 'storefronts', 'stripe', 'video-archive', 'voice']);
    // Sans clé Firecrawl, la ligne dit que la plateforme refuse le serveur, et quelle variable ajouter.
    assert.equal(byId.storefronts!.state, 'warning');
    assert.match(byId.storefronts!.action ?? '', /FIRECRAWL_API_KEY/);
    // Cloudflare configuré mais injoignable ici (adresse locale fermée) : la voix le dit, sans montrer le jeton.
    assert.equal(byId.voice!.state, 'warning');
    assert.ok(!JSON.stringify(byId.voice).includes('jeton-cloudflare-de-test'));

    assert.equal(byId.database!.state, 'warning', 'base embarquée : pas en ligne');
    // Le mode de connexion se lit dans l'adresse, sans rien afficher du mot de passe.
    const { poolerModeOf } = await import('@server/services/admin/services');
    assert.equal(poolerModeOf('postgresql://postgres.abc:secret@aws-0-eu-west-3.pooler.supabase.com:6543/postgres'), 'transaction');
    assert.equal(poolerModeOf('postgresql://postgres.abc:secret@aws-0-eu-west-3.pooler.supabase.com:5432/postgres'), 'session');
    assert.equal(poolerModeOf('postgresql://postgres:secret@db.abc.supabase.co:5432/postgres'), 'direct');
    assert.equal(poolerModeOf('memory://'), null);
    // Le mur vide se voit, avec le geste à faire : c'est le RÉSULTAT de la collecte qui est regardé, pas sa configuration.
    assert.equal(byId['ad-collection']!.state, 'warning');
    assert.match(byId['ad-collection']!.action ?? '', /secret CRON_SECRET du dépôt GitHub/);
    assert.match(byId.database!.action ?? '', /Transaction pooler/);
    assert.equal(byId.perplexity!.state, 'error', 'sans Perplexity, l’analyse est refusée');
    assert.equal(byId.groq!.state, 'warning', 'sans clé Groq, la rédaction ne tient plus qu’à Gemini');
    assert.match(byId.groq!.detail, /Gemini seul/);
    assert.equal(byId.stripe!.state, 'off');
    assert.equal(byId.email!.state, 'off');
    assert.match(byId.email!.action ?? '', /Brevo/);
    assert.equal(byId.gemini!.state, 'warning', 'fournisseur injoignable : à surveiller, pas en panne');
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
