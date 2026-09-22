import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Référence marché d'une niche, contre un faux fournisseur de collecte.
 *
 * Ce que ces tests verrouillent vient d'une sonde réelle du 22/09/2026 sur 25 produits Gumroad,
 * pas de la documentation :
 *
 *  - le nombre de ventes n'est renseigné qu'environ une fois sur quatre : la mesure doit dire
 *    combien de produits le publient, et ne jamais l'extrapoler aux autres ;
 *  - les devises se mélangent (USD et EUR dans un même relevé) : une médiane de prix toutes
 *    devises confondues serait un nombre sans signification, donc on ne garde que la dominante ;
 *  - un relevé se paie à l'unité, donc le cache est mutualisé et un plafond quotidien global
 *    empêche que la curiosité de quelques comptes vide la réserve du mois ;
 *  - les options d'extraction d'e-mails de créateurs ne doivent JAMAIS partir.
 */

interface Appel {
  corps: Record<string, unknown>;
  requete: string;
}

const appels: Appel[] = [];

/** Réponse du faux Gumroad : deux devises, et seulement deux produits sur cinq qui publient leurs ventes. */
const CATALOGUE = [
  { price: 30, currency: 'USD', ratingCount: 8, salesCount: 117, createdAt: '2024-01-10T00:00:00.000Z' },
  { price: 199, currency: 'USD', ratingCount: 51, salesCount: 1053, createdAt: '2022-03-01T00:00:00.000Z' },
  { price: 49, currency: 'USD', ratingCount: 3, salesCount: null, createdAt: '2025-06-01T00:00:00.000Z' },
  { price: 90, currency: 'USD', ratingCount: 0, salesCount: null, createdAt: '2025-08-01T00:00:00.000Z' },
  // Devise minoritaire : son prix ne doit pas entrer dans la médiane.
  { price: 5_000, currency: 'EUR', ratingCount: 2, salesCount: null, createdAt: '2025-01-01T00:00:00.000Z' },
];

const fauxApify = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://faux.test');
    if (req.method === 'POST' && url.pathname.includes('/run-sync-get-dataset-items')) {
      appels.push({
        corps: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        requete: url.search,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(CATALOGUE));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Not Found' }));
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((r) => fauxApify.listen(0, '127.0.0.1', r));
  app = await createTestApp({
    APIFY_TOKEN: 'jeton-apify-de-test',
    APIFY_API_URL: `http://127.0.0.1:${(fauxApify.address() as AddressInfo).port}`,
    APIFY_GUMROAD_ACTOR: 'scrapesage~gumroad-scraper',
    MARKET_BENCHMARK_PRODUCTS: '40',
    MARKET_BENCHMARK_TTL_DAYS: '30',
    MARKET_BENCHMARK_DAILY_CAP: '2',
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => fauxApify.close(() => r()));
});

describe('Référence marché d’une niche', () => {
  it('compte les offres, garde la devise dominante et avoue combien de ventes sont masquées', async () => {
    const { agent } = await signInWithPlan(app, 'marche-mesure@exemple.test', 'pro');
    const reponse = await agent.post('/api/market/benchmark').send({ niche: 'Business Plan Template' }).expect(200);

    assert.equal(reponse.body.origin, 'collected');
    const m = reponse.body.benchmark;
    assert.equal(m.productCount, 5);
    // Médiane des quatre prix en USD (30, 49, 90, 199) : la ligne en EUR est écartée, sinon
    // 5 000 EUR tirerait la médiane vers un chiffre qui ne veut rien dire.
    assert.equal(m.currency, 'USD');
    assert.equal(m.medianPrice, 90);
    assert.equal(m.totalRatings, 64, '8 + 51 + 3 + 0 + 2');
    // Le point le plus important : la mesure dit combien de produits publient leurs ventes.
    assert.equal(m.salesKnownCount, 2);
    assert.equal(m.medianSales, 1053, 'médiane des seules ventes connues, jamais extrapolée');
    assert.ok(m.medianAgeDays > 0, 'l’âge médian vient de createdAt, renseigné à 100 %');
    assert.equal(m.freshForDays, 30);

    const appel = appels.at(-1)!;
    // Le plafond facturé voyage dans l'adresse ET dans le corps : c'est la borne de la dépense.
    assert.match(appel.requete, /maxItems=40/);
    assert.equal(appel.corps.maxResults, 40);
    assert.deepEqual(appel.corps.searchQueries, ['Business Plan Template']);
    // Mesuré : ce champ double le coût pour une donnée absente trois fois sur quatre.
    assert.equal(appel.corps.includeProductDetails, false);
    // Données personnelles de tiers : ces options ne doivent jamais partir.
    assert.equal(appel.corps.includeCreatorLeads, false);
    assert.equal(appel.corps.enrichCreatorEmails, false);
  });

  it('sert le cache à tout le monde : la même niche ne se paie qu’une fois', async () => {
    const { agent: premier } = await signInWithPlan(app, 'marche-cache-1@exemple.test', 'pro');
    const { agent: second } = await signInWithPlan(app, 'marche-cache-2@exemple.test', 'pro');

    const avant = appels.length;
    await premier.post('/api/market/benchmark').send({ niche: 'Notion Dashboard' }).expect(200);
    const apresPremier = appels.length;
    assert.equal(apresPremier, avant + 1, 'le premier relevé est payé');

    // Casse différente et espaces en trop : c'est la même niche, donc aucun second appel.
    const reprise = await second.post('/api/market/benchmark').send({ niche: '  notion   DASHBOARD ' }).expect(200);
    assert.equal(appels.length, apresPremier, 'aucun appel payant supplémentaire');
    assert.equal(reprise.body.origin, 'cache');
    assert.equal(reprise.body.benchmark.query, 'notion dashboard', 'la clé du cache est normalisée');
  });

  it('s’arrête au plafond quotidien du serveur au lieu de vider la réserve du mois', async () => {
    const { agent } = await signInWithPlan(app, 'marche-plafond@exemple.test', 'pro');
    // Le plafond de ce test est 2, et deux relevés ont déjà été faits par les tests précédents.
    const avant = appels.length;
    const refus = await agent.post('/api/market/benchmark').send({ niche: 'Fitness Coaching Program' }).expect(200);

    assert.equal(appels.length, avant, 'aucun relevé neuf au-delà du plafond');
    assert.equal(refus.body.origin, 'capped');
    // Niche jamais mesurée : on rend franchement « rien », plutôt qu'un chiffre inventé.
    assert.equal(refus.body.benchmark, null);

    // La lecture du cache, elle, continue de fonctionner : le plafond ne borne que la dépense.
    const cache = await agent.post('/api/market/benchmark').send({ niche: 'notion dashboard' }).expect(200);
    assert.equal(cache.body.origin, 'cache');
    assert.equal(cache.body.benchmark.productCount, 5);
  });
});
