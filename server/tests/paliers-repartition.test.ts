import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Répartition des fonctions entre les paliers.
 *
 * Ce test lit la grille réelle (`server/config/plans.json`) plutôt que des valeurs recopiées :
 * une modification commerciale doit se voir ici, pas se découvrir en production.
 *
 * Deux règles, dont une que j'ai d'abord prise pour un défaut :
 *
 *  1. Le palier Gratuit ne finance PAS une analyse — 3 points quand elle en coûte 5. C'est
 *     délibéré et de longue date : le refus est explicite (« il vous en reste 3 »), et chaque
 *     analyse consomme une étude web et une rédaction facturées au propriétaire. Ce test
 *     verrouille l'écart pour que personne ne l'efface par mégarde en ajustant un quota.
 *
 *  2. Ce qui coûte de l'argent CHEZ UN FOURNISSEUR est gardé par un palier. La lecture d'un
 *     cache mutualisé, non : la cacher n'économise rien et n'apprend rien à personne.
 */

let app: Express;

before(async () => {
  app = await createTestApp();
});

after(async () => {
  await closeTestApp();
});

describe('Paliers — répartition des fonctions', () => {
  it('garde le palier Gratuit en dessous du prix d’une analyse, comme voulu', async () => {
    const { getPlanConfig } = await import('@server/services/plans');
    const { getActionCost } = await import('@server/services/credits');
    const config = await getPlanConfig();

    const gratuit = config.plans.find((plan) => plan.id === 'free')!;
    const analyse = await getActionCost('niche_analysis');

    /*
      L'écart est le choix du propriétaire, pas un oubli : une analyse consomme une étude web et
      une rédaction, toutes deux facturées. Le Gratuit sert à visiter le produit, pas à le
      consommer. Si ce rapport devait s'inverser un jour, ce serait une décision commerciale —
      et elle doit passer par ici, pas par un ajustement discret d'un quota.
    */
    assert.ok(
      (gratuit.monthlyCredits ?? 0) < analyse,
      `le palier Gratuit donne ${gratuit.monthlyCredits} points et l’analyse en coûte ${analyse} : l’écart est voulu`,
    );
    // Mais il permet les actions à l'unité : sans cela, le palier ne servirait à rien du tout.
    assert.ok((gratuit.monthlyCredits ?? 0) >= await getActionCost('image_generation'), 'le Gratuit peut au moins produire un visuel');
  });

  it('ferme au Gratuit ce qui engage de l’argent, et ouvre le reste au fil des paliers', async () => {
    const { getPlanConfig } = await import('@server/services/plans');
    const plans = Object.fromEntries((await getPlanConfig()).plans.map((plan) => [plan.id, plan]));

    const ferme = (id: string, fonction: string) => plans[id]!.features[fonction] === false;

    // Gratuit : ni vidéo (rendu payé chez fal.ai), ni conte (crédits Gamma), ni relecture
    // humaine, ni collecte de marché (relevé payé chez le fournisseur).
    for (const fonction of ['video_generation', 'storybook_generation', 'native_review', 'market_benchmark']) {
      assert.ok(ferme('free', fonction), `le palier Gratuit devrait fermer ${fonction}`);
    }

    // Plus ouvre la production ; seule la relecture humaine reste réservée.
    assert.ok(!ferme('plus', 'video_generation'));
    assert.ok(!ferme('plus', 'market_benchmark'));
    assert.ok(ferme('plus', 'native_review'), 'la relecture par un humain s’ouvre au palier Pro');

    // À partir de Pro, plus rien n'est fermé.
    for (const id of ['pro', 'max', 'elite']) {
      assert.deepEqual(Object.keys(plans[id]!.features), [], `le palier ${id} ne devrait rien fermer`);
    }
  });

  it('fait croître chaque limite d’un palier au suivant, sans plateau ni recul', async () => {
    const { getPlanConfig } = await import('@server/services/plans');
    const config = await getPlanConfig();
    const ordre = ['free', 'plus', 'pro', 'max', 'elite'];
    const plans = ordre.map((id) => config.plans.find((plan) => plan.id === id)!);

    // null vaut « illimité » : on le compare comme l'infini.
    const valeur = (v: number | null) => (v === null ? Number.POSITIVE_INFINITY : v);

    for (const limite of ['savedNiches', 'watchedStores', 'spiedAdsVisible', 'adFrameworks', 'guideLanguages', 'ebookPages'] as const) {
      for (let i = 1; i < plans.length; i += 1) {
        const avant = valeur(plans[i - 1]!.limits[limite]);
        const apres = valeur(plans[i]!.limits[limite]);
        assert.ok(
          apres > avant || (apres === avant && limite === 'ebookPages' && apres === 250),
          `${limite} : ${ordre[i - 1]} = ${avant} puis ${ordre[i]} = ${apres} — un palier payant doit apporter plus`,
        );
      }
    }

    // Le quota de points suit le même escalier.
    for (let i = 1; i < plans.length; i += 1) {
      assert.ok(
        valeur(plans[i]!.monthlyCredits) > valeur(plans[i - 1]!.monthlyCredits),
        `points : ${ordre[i]} devrait en donner plus que ${ordre[i - 1]}`,
      );
    }
  });

  it('applique la fermeture pour de vrai : le Gratuit lit le cache, il ne déclenche pas de relevé', async () => {
    // Sans jeton de collecte, un palier autorisé obtient « unavailable » ; le Gratuit, lui,
    // doit obtenir « plan » — le motif est différent, et l'écran doit pouvoir le dire.
    const { agent: gratuit } = await signInWithPlan(app, 'palier-gratuit@exemple.test', 'free');
    const refus = await gratuit.post('/api/market/benchmark').send({ niche: 'business plan' }).expect(200);
    assert.equal(refus.body.origin, 'plan');
    assert.equal(refus.body.benchmark, null);

    const { agent: pro } = await signInWithPlan(app, 'palier-pro@exemple.test', 'pro');
    const autorise = await pro.post('/api/market/benchmark').send({ niche: 'business plan' }).expect(200);
    assert.notEqual(autorise.body.origin, 'plan', 'un palier payant n’est pas bloqué par son abonnement');
  });
});

describe('Administration — grille tarifaire et droits', () => {
  it('donne à l’administrateur toutes les fonctions, quel que soit son palier', async () => {
    const { createUserRecord } = await import('@server/services/accounts');
    const { hashPassword } = await import('@server/services/auth/password');
    const { STRONG_PASSWORD } = await import('./support/helpers');
    const { loadAccount } = await import('@server/services/accounts');

    /*
      Le cas qui manquait : un propriétaire resté au palier Gratuit. Il n'a aucune limite
      (effectiveLimits le dit depuis longtemps) mais il se voyait refuser ses propres modules —
      ni vidéo, ni conte, ni mesure de marché. Il ne pouvait donc ni éprouver ce qu'il vend, ni
      reproduire la panne d'un client.
    */
    const patron = await createUserRecord({
      name: 'Propriétaire au palier Gratuit',
      email: 'patron-gratuit@exemple.test',
      passwordHash: await hashPassword(STRONG_PASSWORD),
      role: 'admin',
      plan: 'free',
    });
    const compte = await loadAccount(patron.id);

    for (const fonction of ['video_generation', 'storybook_generation', 'native_review', 'market_benchmark'] as const) {
      assert.equal(compte!.features[fonction], true, `un administrateur devrait avoir ${fonction}`);
    }
  });

  it('sert la grille complète à qui détient le privilège, et la refuse aux autres', async () => {
    const { createAdmin } = await import('./support/helpers');
    const { agent: admin } = await createAdmin(app, 'patron-tarifs@exemple.test');

    const grille = await admin.get('/api/admin/pricing').expect(200);
    assert.equal(grille.body.plans.length, 5, 'les cinq paliers');
    assert.ok(grille.body.actions.length > 0, 'et le coût de chaque action');
    assert.ok(grille.body.point.value > 0, 'la valeur du point, qui rend la grille lisible en argent');

    // Les limites des nouveaux modules doivent y figurer : une grille incomplète ne sert à rien.
    const gratuit = (grille.body.plans as { id: string; limits: Record<string, number | null> }[]).find((p) => p.id === 'free')!;
    assert.equal(gratuit.limits.watchedStores, 0);
    assert.equal(gratuit.limits.spiedAdsVisible, 6);
    // Et ce que le palier ferme, avec un libellé lisible plutôt qu'un identifiant.
    const fermees = (grille.body.plans as { id: string; closedFeatures: { id: string; label: string }[] }[]).find((p) => p.id === 'free')!.closedFeatures;
    assert.ok(fermees.some((f) => f.id === 'market_benchmark' && f.label.length > 0));

    // Un compte ordinaire n'a rien à faire dans la grille interne.
    const { agent } = await signInWithPlan(app, 'curieux-tarifs@exemple.test', 'pro');
    await agent.get('/api/admin/pricing').expect(403);
  });
});
