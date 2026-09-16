import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';

import { closeTestApp, createTestApp } from './helpers';

const TEMPLATE = `<!doctype html><html><head>
<!--seo-->
<title>Défaut</title>
<!--/seo-->
<script type="application/ld+json">{"url":"__APP_URL__/"}</script>
</head><body><div id="root"></div></body></html>`;

describe('Référencement', () => {
  let app: Express;

  before(async () => {
    app = await createTestApp({ APP_URL: 'https://smart-creator.example/' });
  });

  after(async () => {
    await closeTestApp();
  });

  it('propose les pages publiques et écarte l’espace de travail', async () => {
    const robots = await request(app).get('/robots.txt').expect(200);
    assert.match(robots.headers['content-type'] ?? '', /text\/plain/);
    assert.match(robots.text, /Disallow: \/app\//);
    assert.match(robots.text, /Disallow: \/api\//);
    assert.match(robots.text, /Sitemap: https:\/\/smart-creator\.example\/sitemap\.xml/);

    const sitemap = await request(app).get('/sitemap.xml').expect(200);
    assert.match(sitemap.text, /<loc>https:\/\/smart-creator\.example\/contact<\/loc>/);
    assert.doesNotMatch(sitemap.text, /\/app|\/api|\/mot-de-passe|\/imprimer/);
  });

  it('écrit les balises de chaque adresse et n’indexe que les pages publiques', async () => {
    const { renderIndexHtml, classifyPath } = await import('@server/services/seo');

    assert.equal(classifyPath('/conditions/'), 'public');
    assert.equal(classifyPath('/app/compte'), 'private');
    assert.equal(classifyPath('/mot-de-passe-oublie'), 'private');
    assert.equal(classifyPath('/application'), 'unknown');

    const contact = renderIndexHtml(TEMPLATE, 'https://smart-creator.example', '/contact');
    assert.equal(contact.status, 200);
    assert.equal(contact.indexable, true);
    assert.match(contact.html, /<title>Contact · Smart Creator<\/title>/);
    assert.match(contact.html, /<link rel="canonical" href="https:\/\/smart-creator\.example\/contact" \/>/);
    assert.match(contact.html, /"url":"https:\/\/smart-creator\.example\/"/);
    assert.doesNotMatch(contact.html, /Défaut|__APP_URL__|noindex/);

    const account = renderIndexHtml(TEMPLATE, 'https://smart-creator.example', '/app/compte');
    assert.equal(account.status, 200);
    assert.equal(account.indexable, false);
    assert.match(account.html, /noindex, nofollow/);
    assert.doesNotMatch(account.html, /canonical/);

    const unknown = renderIndexHtml(TEMPLATE, 'https://smart-creator.example', '/nimporte-quoi');
    assert.equal(unknown.status, 404);
    assert.match(unknown.html, /Page introuvable/);
  });

  it('sert le client construit : 404 réelle pour une adresse ou un fichier inconnu, jamais le modèle brut', async () => {
    const { mountClient } = await import('@server/services/seo');
    const clientDir = mkdtempSync(join(tmpdir(), 'smart-creator-client-'));
    try {
      writeFileSync(join(clientDir, 'index.html'), TEMPLATE);
      const site = express();
      mountClient(site, clientDir, 'https://smart-creator.example');

      const home = await request(site).get('/').expect(200);
      assert.match(home.text, /Veille stratégique/);
      assert.equal(home.headers['x-robots-tag'], undefined);

      const workspace = await request(site).get('/app/cockpit').expect(200);
      assert.equal(workspace.headers['x-robots-tag'], 'noindex, nofollow');

      await request(site).get('/lien-casse').expect(404);
      await request(site).get('/assets/ancien-bundle-1234.js').expect(404);
      await request(site).get('/index.html').expect(301).expect('Location', '/');
    } finally {
      rmSync(clientDir, { recursive: true, force: true });
    }
  });
});
