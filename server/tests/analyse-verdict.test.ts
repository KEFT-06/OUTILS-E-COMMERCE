import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MarketRate, TauxLevel } from '@server/shared/analysis';
import { fakeAnalysis } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Un rapport rend toujours un verdict.
 *
 * Vu par un client le 04/10/2026 : « Non établi — trop peu de taux ont pu être évalués à partir
 * des sources », sur une niche documentée par une quinzaine de pages. Deux réponses :
 *  - le verdict ne dépend plus du nombre de taux évalués ; à défaut de celui du rédacteur, il
 *    se déduit des niveaux relevés ;
 *  - nos propres relevés (ventes affichées par les boutiques, prix, publicités en cours)
 *    rejoignent les sources, pour que la demande puisse être mesurée.
 */

const taux = (key: MarketRate['key'], level: TauxLevel | null): MarketRate => ({
  key,
  label: key,
  level,
  score: null,
  trend: null,
  description: '',
  basis: level ? 'assessment' : 'unavailable',
});
const niveaux = (levels: Partial<Record<MarketRate['key'], TauxLevel>>) => ({
  demand: taux('demand', levels.demand ?? null),
  saturation: taux('saturation', levels.saturation ?? null),
  profitability: taux('profitability', levels.profitability ?? null),
  opportunity: taux('opportunity', levels.opportunity ?? null),
  virality: taux('virality', levels.virality ?? null),
});

before(async () => {
  await createTestApp();
});
after(async () => {
  await closeTestApp();
});

describe('Verdict d’une analyse', () => {
  it('se déduit des niveaux relevés, et dit ce qui le fonde', async () => {
    const { deriveVerdict, settledVerdict } = await import('@server/shared/verdict');

    assert.equal(deriveVerdict(niveaux({ demand: 'Élevé', saturation: 'Moyen' })).verdict, 'Opportunité Forte');
    assert.equal(deriveVerdict(niveaux({ demand: 'Très élevé', saturation: 'Faible' })).verdict, 'Opportunité Exceptionnelle');
    assert.equal(deriveVerdict(niveaux({ opportunity: 'Élevé', saturation: 'Moyen', demand: 'Moyen' })).verdict, 'Opportunité Forte');
    assert.equal(deriveVerdict(niveaux({ demand: 'Élevé', saturation: 'Très élevé' })).verdict, 'Marché Compétitif');
    assert.equal(deriveVerdict(niveaux({ demand: 'Faible', saturation: 'Élevé' })).verdict, 'Niche Risquée');
    assert.equal(deriveVerdict(niveaux({ demand: 'Moyen', saturation: 'Moyen' })).verdict, 'Marché Compétitif');

    // Le cas du client : la concurrence se voit, la demande n'est mesurée par aucune source.
    const sansDemande = deriveVerdict(niveaux({ saturation: 'Élevé' }));
    assert.equal(sansDemande.verdict, 'Marché Compétitif');
    assert.match(sansDemande.rationale, /concurrence élevée/);
    assert.match(sansDemande.rationale, /demande n’est pas encore mesurée.*test à petit budget/);

    // Rien du tout : c'est un pari, et le rapport le dit au lieu de se taire.
    const rien = deriveVerdict(niveaux({}));
    assert.equal(rien.verdict, 'Niche Risquée');
    assert.match(rien.rationale, /pari/);
    for (const cas of [sansDemande, rien]) assert.doesNotMatch(cas.rationale, /non établi|trop peu de taux/i);

    // Un rapport enregistré avant ce changement, verdict vide : l'écran en déduit un.
    const ancien = settledVerdict({ overallVerdict: null, verdictRationale: 'Verdict non établi : trop peu de taux ont pu être évalués à partir des sources.', rates: niveaux({ saturation: 'Moyen', demand: 'Élevé' }) });
    assert.equal(ancien.verdict, 'Opportunité Forte');
    assert.doesNotMatch(ancien.rationale, /non établi/i);
    // Un rapport qui porte son verdict le garde, avec ses raisons.
    assert.deepEqual(settledVerdict({ overallVerdict: 'Niche Risquée', verdictRationale: 'Marché étroit.', rates: niveaux({ demand: 'Très élevé' }) }), {
      verdict: 'Niche Risquée',
      rationale: 'Marché étroit.',
    });
  });

  it('ne rend plus « Non établi » quand le rédacteur n’a évalué qu’un seul taux', async () => {
    const { assembleReport } = await import('@server/services/analysis');
    const { buildAnalysisPrompt, parseAnalysisResponse } = await import('@server/services/analysis/prompt');
    const sources = [
      { id: 1, title: 'Guide du diabète au quotidien', url: 'https://sante.example/guide', snippet: 'Ebook vendu 5 000 FCFA.', publishedAt: null },
      { id: 2, title: 'Vivre avec le diabète', url: 'https://blog.example/diabete', snippet: 'Conseils pratiques.', publishedAt: null },
    ];
    const prompt = buildAnalysisPrompt({ query: 'gestion du diabète au quotidien', marketName: 'Cameroun', today: '4 octobre 2026', sources, webSearchConfigured: true });
    assert.match(prompt, /TRANCHE : choisis un niveau/);
    assert.match(prompt, /Un indice indirect vaut mieux qu’une absence de réponse/);
    assert.match(prompt, /Le verdict est OBLIGATOIRE dès qu’il existe au moins une source/);

    const reponse = parseAnalysisResponse({
      ...(fakeAnalysis(prompt) as Record<string, unknown>),
      verdict: 'Non établi',
      verdictRationale: '',
      demand: { level: 'Non évaluable', rationale: '', sourceIds: [] },
      saturation: { level: 'Élevé', rationale: 'Plusieurs guides et ebooks déjà en vente.', sourceIds: [1, 2] },
      profitability: { level: 'Non évaluable', rationale: '', sourceIds: [] },
      opportunity: { level: 'Non évaluable', rationale: '', sourceIds: [] },
      virality: { level: 'Non évaluable', rationale: '', sourceIds: [] },
    });
    const rapport = assembleReport({
      id: '00000000-0000-4000-8000-000000000002',
      query: 'gestion du diabète au quotidien',
      market: 'CM',
      now: new Date('2026-10-04T08:00:00Z'),
      timeZone: 'UTC',
      sources,
      webSearchConfigured: true,
      research: null,
      response: reponse,
      model: 'modele-de-test',
      currency: 'XAF',
    });
    assert.equal(rapport.overallVerdict, 'Marché Compétitif', 'un seul taux évalué suffit à trancher');
    assert.match(rapport.verdictRationale ?? '', /concurrence élevée/);
    assert.doesNotMatch(rapport.verdictRationale ?? '', /non établi|trop peu de taux/i);
  });

  it('mesure une niche sur nos propres relevés : ventes affichées, prix, publicités en cours', async () => {
    const { getDb } = await import('@server/db/client');
    const { marketProducts, spiedAds } = await import('@server/db/schema');
    const { describeSignals, measureNiche, nicheSignalsSource } = await import('@server/services/analysis/signals');
    const maintenant = new Date('2026-10-04T08:00:00Z');
    const ilYA = (jours: number) => new Date(maintenant.getTime() - jours * 86_400_000);

    assert.equal(await measureNiche('gestion du diabète au quotidien', maintenant), null, 'rien de relevé : aucune source de ce genre');

    await getDb()
      .insert(marketProducts)
      .values([
        { storeExternalId: 'store_a', storeHost: 'sante-plus.mychariow.com', storeLabel: 'Santé Plus', externalId: 'prd_1', name: 'Diabète : 30 menus pour stabiliser sa glycémie', nameKey: 'diabete : 30 menus pour stabiliser sa glycemie', priceValue: 5000, currency: 'XAF', salesCount: 412 },
        { storeExternalId: 'store_a', storeHost: 'sante-plus.mychariow.com', storeLabel: 'Santé Plus', externalId: 'prd_2', name: 'Carnet de suivi du diabète', nameKey: 'carnet de suivi du diabete', priceValue: 2500, currency: 'XAF', salesCount: 88 },
        { storeExternalId: 'store_b', storeHost: 'mieux-vivre.mychariow.com', storeLabel: 'Mieux Vivre', externalId: 'prd_3', name: 'Guide du diabète de type 2', nameKey: 'guide du diabete de type 2', priceValue: 7500, currency: 'XAF', salesCount: null },
        { storeExternalId: 'store_c', storeHost: 'cuisine.mychariow.com', storeLabel: 'Cuisine', externalId: 'prd_4', name: 'Recettes de beignets', nameKey: 'recettes de beignets', priceValue: 1000, currency: 'XAF', salesCount: 900 },
      ]);
    const annonce = (externalId: string, title: string, jours: number, active = true) => ({
      externalId,
      storeHost: 'sante-plus.mychariow.com',
      landingUrl: 'https://sante-plus.mychariow.com/prd_1',
      title,
      bodyText: 'Reprenez la main sur votre glycémie.',
      advertiser: 'Santé Plus',
      pageId: externalId.slice(0, 6),
      startedAt: ilYA(jours),
      active,
      firstSeenAt: maintenant,
      lastSeenAt: maintenant,
    });
    await getDb()
      .insert(spiedAds)
      .values([
        annonce('111111000001', 'Diabète : le guide des menus', 95),
        annonce('222222000002', 'Vivre avec le diabete sans se priver', 12),
        annonce('333333000003', 'Diabète : ancienne campagne', 200, false),
        { ...annonce('444444000004', 'Beignets faciles', 300), bodyText: 'Recettes de beignets.' },
      ]);

    const mesure = await measureNiche('gestion du diabète au quotidien', maintenant);
    assert.ok(mesure);
    assert.equal(mesure.products, 3, 'les beignets ne sont pas de la niche');
    assert.equal(mesure.stores, 2);
    assert.equal(mesure.productsWithSales, 2);
    assert.equal(mesure.totalSales, 500);
    assert.equal(mesure.bestSeller?.sales, 412);
    assert.deepEqual(mesure.prices, { min: 2500, median: 5000, max: 7500, currency: 'XAF' });
    assert.equal(mesure.activeAds, 2, 'seules les annonces en cours comptent, sans tenir compte des accents');
    assert.equal(mesure.advertisers, 2);
    assert.equal(mesure.longestAdDays, 95);
    assert.equal(mesure.adsOverSixtyDays, 1);

    const texte = describeSignals(mesure, '4 octobre 2026');
    assert.match(texte, /3 produits en vente sur ce sujet, dans 2 boutiques/);
    assert.match(texte, /500 ventes au total sur 2 produits/);
    assert.match(texte, /« Diabète : 30 menus pour stabiliser sa glycémie » \(412 ventes, 5[\s  ]000 XAF\)/);
    assert.match(texte, /2 annonces en cours sur ce sujet, chez 2 annonceurs ; la plus ancienne tourne depuis 95 jours, et 1 tourne depuis plus de 60 jours/);

    // La source prend le numéro qui suit ceux de l'étude, et mène au Radar de cette niche.
    const source = await nicheSignalsSource('gestion du diabète au quotidien', 16, maintenant);
    assert.equal(source?.id, 16);
    assert.match(source?.title ?? '', /Relevés Smart Creator/);
    assert.match(source?.url ?? '', /\/app\/radar\?niche=gestion/);
    assert.equal(source?.snippet, texte);

    const { buildAnalysisPrompt } = await import('@server/services/analysis/prompt');
    const prompt = buildAnalysisPrompt({ query: 'gestion du diabète au quotidien', marketName: 'Cameroun', today: '4 octobre 2026', sources: [source!], webSearchConfigured: true });
    assert.match(prompt, /\[16\] Relevés Smart Creator/);
    assert.match(prompt, /ce sont des MESURES/);
  });
});
