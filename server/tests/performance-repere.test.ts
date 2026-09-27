import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Repère partagé de performance : où un vendeur se situe parmi ceux de sa niche.
 *
 * La règle d'agrégation existait, écrite et commentée, sans un seul test — une règle de
 * confidentialité sans filet. C'est elle que ces tests protègent en premier : le seuil de
 * cinq vendeurs n'est pas un réglage d'affichage, c'est ce qui empêche une médiane calculée
 * sur deux vendeurs de les désigner dans une niche étroite.
 */

let app: Express;

before(async () => {
  app = await createTestApp();
});

after(async () => {
  await closeTestApp();
});

/** Verse un relevé au nom d'un vendeur, comme le ferait le planificateur. */
async function contribuer(userId: string, niche: string, market: string, metrics: Record<string, number>, jour: string) {
  const { getDb } = await import('@server/db/client');
  const { performanceContributions } = await import('@server/db/schema');
  await getDb().insert(performanceContributions).values({ userId, niche, market, metrics, day: jour });
}

async function accepter(userId: string) {
  const { setPerformanceOptIn } = await import('@server/services/performanceLoop/collect');
  await setPerformanceOptIn(userId, true);
}

/** Crée un compte, lui donne une analyse — donc une niche — et accepte la participation. */
async function vendeur(email: string, niche: string, market: string) {
  const { userId, agent } = await signInWithPlan(app, email, 'pro');
  const { getDb } = await import('@server/db/client');
  const { reports } = await import('@server/db/schema');
  await getDb().insert(reports).values({ userId, query: niche, nicheName: niche, market, report: {} });
  await accepter(userId);
  return { userId, agent };
}

describe('Repère de performance — le seuil de cinq vendeurs', () => {
  it('ne publie rien tant que cinq vendeurs ne se sont pas réunis, et dit combien il en manque', async () => {
    const NICHE = 'Formations bureautique';
    const comptes = [];
    for (let rang = 0; rang < 4; rang += 1) {
      const compte = await vendeur(`repere-${rang}@exemple.test`, NICHE, 'CM');
      await contribuer(compte.userId, NICHE, 'CM', { salesPerMonth: 10 + rang, products: 2, salesPerProduct: 5 }, `2026-09-2${rang}`);
      comptes.push(compte);
    }

    const quatre = await comptes[0]!.agent.get('/api/market/performance').expect(200);
    assert.equal(quatre.body.sellers, 4);
    assert.equal(quatre.body.medians, null, 'quatre vendeurs ne suffisent pas : une médiane les désignerait');
    assert.equal(quatre.body.sellersNeeded, 1, 'et l’écran peut dire qu’il en manque un');
    // Ses propres chiffres restent visibles : l'attente ne doit pas être une page vide.
    assert.equal(quatre.body.own.salesPerMonth, 10);

    // Le cinquième arrive : le repère devient publiable.
    const cinquieme = await vendeur('repere-4@exemple.test', NICHE, 'CM');
    await contribuer(cinquieme.userId, NICHE, 'CM', { salesPerMonth: 50, products: 2, salesPerProduct: 25 }, '2026-09-24');

    const cinq = await comptes[0]!.agent.get('/api/market/performance').expect(200);
    assert.equal(cinq.body.sellers, 5);
    assert.equal(cinq.body.sellersNeeded, 0);
    // Médiane de 10, 11, 12, 13, 50 : douze. Une valeur extrême ne déplace pas le repère,
    // là où une moyenne l'aurait portée à dix-neuf.
    assert.equal(cinq.body.medians.salesPerMonth, 12);
  });

  /*
    Un retrait doit valoir immédiatement, et pas « à la prochaine collecte ».

    Le consentement est relu sur la table des comptes à CHAQUE lecture, et il s'applique à
    toutes les lignes du vendeur. Ses relevés sont par ailleurs effacés : on ne garde pas des
    chiffres d'affaires que leur propriétaire a repris.
  */
  it('retire un vendeur du calcul dès qu’il se retire, et efface ses relevés', async () => {
    const NICHE = 'Modèles Canva';
    const comptes = [];
    for (let rang = 0; rang < 5; rang += 1) {
      const compte = await vendeur(`retrait-${rang}@exemple.test`, NICHE, 'CI');
      await contribuer(compte.userId, NICHE, 'CI', { salesPerMonth: 20, products: 1, salesPerProduct: 20 }, `2026-09-2${rang}`);
      comptes.push(compte);
    }

    const avant = await comptes[0]!.agent.get('/api/market/performance').expect(200);
    assert.equal(avant.body.sellers, 5);
    assert.equal(avant.body.medians.salesPerMonth, 20);

    // Un seul se retire : le groupe retombe à quatre, et le repère se referme.
    const retrait = await comptes[4]!.agent.post('/api/market/performance/opt-in').send({ enabled: false }).expect(200);
    assert.equal(retrait.body.optedIn, false);
    assert.equal(retrait.body.own, null, 'ses relevés sont effacés, pas seulement ignorés');

    const apres = await comptes[0]!.agent.get('/api/market/performance').expect(200);
    assert.equal(apres.body.sellers, 4);
    assert.equal(apres.body.medians, null, 'un départ referme le repère : le seuil ne se contourne pas');
  });

  it('n’attache aucun vendeur à un groupe qu’il n’a pas choisi', async () => {
    // Un compte sans analyse n'a pas de niche : le comparer à une niche qu'il n'a pas
    // retenue ne dirait rien de juste, et le placerait dans le calcul d'autrui.
    const { userId, agent } = await signInWithPlan(app, 'repere-sans-niche@exemple.test', 'pro');
    await accepter(userId);

    const vue = await agent.get('/api/market/performance').expect(200);
    assert.equal(vue.body.group, null);
    assert.equal(vue.body.medians, null);
    assert.equal(vue.body.sellers, 0);
  });

  /*
    L'écran de comparaison lit sept champs, et les affiche sans les recalculer. S'il en manque
    un, la carte ne plante pas : elle se tait, et le vendeur perd l'information sans jamais
    savoir qu'elle existait. Une réponse silencieusement incomplète est pire qu'une erreur.
  */
  it('rend tout ce que l’écran de comparaison consomme, même sans repère publiable', async () => {
    const { agent } = await signInWithPlan(app, 'repere-contrat@exemple.test', 'pro');
    const vue = (await agent.get('/api/market/performance').expect(200)).body as Record<string, unknown>;

    for (const champ of ['optedIn', 'group', 'own', 'medians', 'sellers', 'sellersNeeded', 'minSellers']) {
      assert.ok(champ in vue, `le champ « ${champ} » manque : l’écran l’affiche`);
    }
    assert.equal(typeof vue.minSellers, 'number', 'le seuil est annoncé au client, jamais recopié dans son code');
    assert.equal(typeof vue.sellersNeeded, 'number');
  });

  it('ne verse rien sans consentement, et le consentement est fermé par défaut', async () => {
    const { agent } = await signInWithPlan(app, 'repere-silencieux@exemple.test', 'pro');
    const vue = await agent.get('/api/market/performance').expect(200);
    assert.equal(vue.body.optedIn, false, 'verser ses chiffres de vente se demande, cela ne se suppose pas');
  });
});
