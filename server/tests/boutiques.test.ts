import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { closeTestApp, createTestApp, signUp } from './support/helpers';

/**
 * Boutiques Shopify et WooCommerce reliées avec les clés du vendeur, contre de faux services.
 * Aucune vraie boutique n'est appelée.
 */

const JETON = 'shpat_' + 'a'.repeat(32);
const CK = 'ck_' + '1'.repeat(40);
const CS = 'cs_' + '2'.repeat(40);
const echanges: string[] = [];

const faux = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://faux.test');
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };

    // ——— Faux Shopify ———
    if (req.method === 'POST' && url.pathname === '/admin/oauth/access_token') {
      const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      echanges.push(body.get('grant_type') ?? '');
      if (body.get('client_secret') !== 'secret-application-shopify') return json(400, { error: 'invalid_client' });
      return json(200, { access_token: JETON, scope: 'read_products,read_orders', expires_in: 86399 });
    }
    if (req.method === 'POST' && url.pathname === '/admin/api/2026-07/graphql.json') {
      if (req.headers['x-shopify-access-token'] !== JETON) return json(401, { errors: 'Invalid API key or access token' });
      const { query } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query: string };
      if (query.includes('shop {')) return json(200, { data: { shop: { name: 'Boutique test' } } });
      if (query.includes('products(')) {
        return json(200, {
          data: {
            products: {
              edges: [{ node: { id: 'gid://shopify/Product/1', title: 'Guide Excel', productType: 'Ebook', priceRangeV2: { minVariantPrice: { amount: '5000.0', currencyCode: 'XOF' } } } }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
      if (query.includes('orders(')) {
        return json(200, {
          data: {
            orders: {
              edges: [
                { node: { currentTotalPriceSet: { shopMoney: { amount: '5000.0', currencyCode: 'XOF' } } } },
                { node: { currentTotalPriceSet: { shopMoney: { amount: '2500.0', currencyCode: 'XOF' } } } },
                { node: { currentTotalPriceSet: { shopMoney: { amount: '19.99', currencyCode: 'EUR' } } } },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
    }

    // ——— Faux WooCommerce ———
    if (url.pathname.startsWith('/wp-json/wc/v3/')) {
      const attendu = `Basic ${Buffer.from(`${CK}:${CS}`).toString('base64')}`;
      if (req.headers.authorization !== attendu) return json(401, { code: 'woocommerce_rest_cannot_view' });
      if (url.pathname === '/wp-json/wc/v3/products') {
        return json(200, [{ id: 7, name: 'Formation vidéo', type: 'simple', price: '10000', downloadable: true, virtual: true }], { 'x-wp-totalpages': '1' });
      }
      if (url.pathname === '/wp-json/wc/v3/settings/general/woocommerce_currency') return json(200, { id: 'woocommerce_currency', value: 'XAF' });
      if (url.pathname === '/wp-json/wc/v3/orders') {
        return json(
          200,
          [
            { id: 1, status: 'completed', total: '10000.00', currency: 'XAF' },
            { id: 2, status: 'processing', total: '10000.00', currency: 'XAF' },
            { id: 3, status: 'cancelled', total: '10000.00', currency: 'XAF' },
          ],
          { 'x-wp-totalpages': '1' },
        );
      }
    }
    json(404, {});
  });
});

let app: Express;
let base = '';

before(async () => {
  await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(faux.address() as AddressInfo).port}`;
  app = await createTestApp({ SHOPIFY_TEST_BASE_URL: base });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => faux.close(() => r()));
});

describe('Boutiques reliées avec les clés du vendeur', () => {
  it('relie Shopify par son jeton, puis lit catalogue et ventes payées par devise', async () => {
    const { agent } = await signUp(app, { name: 'Aminata Diallo', email: 'aminata.shop@exemple.com' });
    const relie = await agent.put('/api/account/integrations/shopify').send({ shop: 'https://Ma-Boutique.myshopify.com/admin', accessToken: JETON }).expect(200);
    assert.equal(relie.body.integrations.shopify.connected, true);
    assert.equal(relie.body.integrations.shopify.label, 'ma-boutique.myshopify.com', 'domaine normalisé');
    assert.equal(relie.body.integrations.shopify.hint, JETON.slice(-4));
    assert.equal(JSON.stringify(relie.body).includes(JETON), false, 'le jeton ne repart jamais vers le navigateur');

    const catalogue = await agent.get('/api/marketplaces/shopify/products').expect(200);
    assert.equal(catalogue.body.products[0].name, 'Guide Excel');
    assert.match(catalogue.body.products[0].price.formatted, /5\s?000/);

    const ventes = await agent.get('/api/marketplaces/sales-summary').expect(200);
    const shopify = ventes.body.summaries.find((summary: { source: string }) => summary.source === 'Shopify');
    const xof = shopify.totalsByCurrency.find((total: { currency: string }) => total.currency === 'XOF');
    assert.equal(xof.amountMinor, 7500, 'francs CFA sommés sans décimales');
    assert.equal(shopify.completedSales, 3);
    assert.ok(shopify.totalsByCurrency.some((total: { currency: string; amountMinor: number }) => total.currency === 'EUR' && total.amountMinor === 1999));
  });

  it('relie Shopify par l’identifiant et le secret d’une application du Dev Dashboard', async () => {
    const { agent } = await signUp(app, { name: 'Moussa Traoré', email: 'moussa.devdash@exemple.com' });
    await agent
      .put('/api/account/integrations/shopify')
      .send({ shop: 'devdash.myshopify.com', clientId: 'client-id-application', clientSecret: 'mauvais-secret-application' })
      .expect(400);
    await agent
      .put('/api/account/integrations/shopify')
      .send({ shop: 'devdash.myshopify.com', clientId: 'client-id-application', clientSecret: 'secret-application-shopify' })
      .expect(200);
    assert.ok(echanges.includes('client_credentials'));
    await agent.get('/api/marketplaces/shopify/products').expect(200);
  });

  it('relie WooCommerce, ne compte que les commandes payées, et ne montre rien aux autres comptes', async () => {
    const vendeur = await signUp(app, { name: 'Kossi Mensah', email: 'kossi.woo@exemple.com' });
    await vendeur.agent.put('/api/account/integrations/woocommerce').send({ siteUrl: base, consumerKey: CK, consumerSecret: 'cs_' + '9'.repeat(40) }).expect(400);
    await vendeur.agent.put('/api/account/integrations/woocommerce').send({ siteUrl: base, consumerKey: CK, consumerSecret: CS }).expect(200);

    const catalogue = await vendeur.agent.get('/api/marketplaces/woocommerce/products').expect(200);
    assert.equal(catalogue.body.products[0].type, 'numérique');
    assert.match(catalogue.body.products[0].price.formatted, /10\s?000/);

    const ventes = await vendeur.agent.get('/api/marketplaces/sales-summary').expect(200);
    const woo = ventes.body.summaries.find((summary: { source: string }) => summary.source === 'WooCommerce');
    assert.equal(woo.completedSales, 2, 'la commande annulée n’est pas une vente');
    assert.equal(woo.totalsByCurrency[0].amountMinor, 20000);

    const autre = await signUp(app, { name: 'Efua Asante', email: 'efua.autre@exemple.com' });
    await autre.agent.get('/api/marketplaces/woocommerce/products').expect(503);

    await vendeur.agent.delete('/api/account/integrations/woocommerce').expect(200);
    await vendeur.agent.get('/api/marketplaces/woocommerce/products').expect(503);
  });

  it('refuse un site qui n’est pas en https ou qui pointe vers un réseau privé', async () => {
    const { agent } = await signUp(app, { name: 'Yaw Boateng', email: 'yaw.ssrf@exemple.com' });
    for (const siteUrl of ['http://boutique.exemple.com', 'https://10.0.0.5', 'https://169.254.169.254', 'https://[::1]']) {
      const refus = await agent.put('/api/account/integrations/woocommerce').send({ siteUrl, consumerKey: CK, consumerSecret: CS }).expect(400);
      assert.match(refus.body.error.code, /URL_(NOT_HTTPS|PRIVATE|INVALID|UNREACHABLE)/, siteUrl);
    }
    const domaine = await agent.put('/api/account/integrations/shopify').send({ shop: 'boutique.exemple.com', accessToken: JETON }).expect(400);
    assert.match(domaine.body.error.message, /myshopify\.com/);
  });
});
