import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';

import { closeTestApp, createTestApp } from './support/helpers';

const TEMPLATE = `<!doctype html><html><head>
<!--seo-->
<title>Défaut</title>
<!--/seo-->
</head><body><div id="root"></div></body></html>`;

const CLE = 'cle-de-declaration-de-test-0001';

/** Faux service de déclaration aux moteurs : garde ce qu'il reçoit. */
const declarations: { host: string; key: string; keyLocation: string; urlList: string[] }[] = [];
const fauxMoteur = createServer((req, res) => {
  const morceaux: Buffer[] = [];
  req.on('data', (morceau: Buffer) => morceaux.push(morceau));
  req.on('end', () => {
    declarations.push(JSON.parse(Buffer.concat(morceaux).toString('utf8')) as (typeof declarations)[number]);
    res.writeHead(202).end();
  });
});

describe('Référencement', () => {
  let app: Express;

  before(async () => {
    await new Promise<void>((resolve) => fauxMoteur.listen(0, '127.0.0.1', resolve));
    app = await createTestApp({
      APP_URL: 'https://smart-creator.example/',
      INDEXNOW_URL: `http://127.0.0.1:${(fauxMoteur.address() as AddressInfo).port}/indexnow`,
      INDEXNOW_KEY: CLE,
    });
  });

  after(async () => {
    await closeTestApp();
    await new Promise<void>((resolve) => fauxMoteur.close(() => resolve()));
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
    assert.match(contact.html, /"url":"https:\/\/smart-creator\.example\/contact"/, 'données structurées de la page');
    assert.match(contact.html, /<meta name="robots" content="index, follow/);
    assert.doesNotMatch(contact.html, /Défaut|__APP_URL__|noindex/);

    const account = renderIndexHtml(TEMPLATE, 'https://smart-creator.example', '/app/compte');
    assert.equal(account.status, 200);
    assert.equal(account.indexable, false);
    assert.match(account.html, /noindex, nofollow/);
    assert.doesNotMatch(account.html, /canonical|ld\+json/);
    assert.match(account.html, /<div id="root"><\/div>/, 'l’espace de travail ne reçoit aucun texte public');

    const unknown = renderIndexHtml(TEMPLATE, 'https://smart-creator.example', '/nimporte-quoi');
    assert.equal(unknown.status, 404);
    assert.match(unknown.html, /Page introuvable/);
  });

  /*
    Constaté le 04/10/2026 : le site était introuvable dans un moteur de recherche même en tapant
    son adresse. Le corps de la page était vide sans JavaScript, et le plan du site datait
    toutes les pages de 2018.
  */
  it('sert le texte de l’accueil sans JavaScript, avec ses données structurées', async () => {
    const { renderIndexHtml } = await import('@server/services/seo');
    const { LANDING_FAQ } = await import('@server/shared/landingContent');
    const accueil = renderIndexHtml(TEMPLATE, 'https://smart-creator.example', '/', { verification: { google: 'code-google-0123456789', bing: 'CODEBING0123456789' } }).html;

    // Le texte que lit un moteur qui n'exécute pas le JavaScript : titre, modules, engagements, questions.
    assert.match(accueil, /<div id="root"><main /);
    assert.match(accueil, /<h1 [^>]*>Sachez quoi vendre avant de le produire\.<\/h1>/);
    assert.match(accueil, /Radar : ventes, prix et nouveautés des boutiques concurrentes/);
    assert.match(accueil, /Chaque chiffre porte sa source/);
    assert.ok(accueil.includes(LANDING_FAQ[0]!.question.replace(/’/g, '&#8217;')) || accueil.includes(LANDING_FAQ[0]!.question), 'les questions fréquentes y sont');
    assert.match(accueil, /href="\/connexion"/);
    assert.match(accueil, /href="\/contact"/);
    assert.equal((accueil.match(/<h1/g) ?? []).length, 1, 'un seul titre principal');

    // Données structurées : site, organisation, logiciel, questions fréquentes.
    const blocs = [...accueil.matchAll(/<script type="application\/ld\+json">(.+?)<\/script>/g)].map((bloc) => JSON.parse(bloc[1]!) as Record<string, unknown>);
    assert.deepEqual(blocs.map((bloc) => bloc['@type']), ['WebSite', 'Organization', 'SoftwareApplication', 'FAQPage']);
    assert.equal((blocs[3]!.mainEntity as unknown[]).length, LANDING_FAQ.length);
    assert.equal((blocs[2]!.offers as { price: string }).price, '0');

    // Codes de validation du propriétaire : sur l'accueil seulement.
    assert.match(accueil, /<meta name="google-site-verification" content="code-google-0123456789" \/>/);
    assert.match(accueil, /<meta name="msvalidate\.01" content="CODEBING0123456789" \/>/);
    const contact = renderIndexHtml(TEMPLATE, 'https://smart-creator.example', '/contact', { verification: { google: 'code-google-0123456789' } }).html;
    assert.doesNotMatch(contact, /google-site-verification/);
    assert.match(contact, /<div id="root"><main [^>]*><h1 [^>]*>Contact<\/h1>/);

    // Un texte contenant « < » ne peut pas fermer la balise des données structurées.
    assert.doesNotMatch(accueil.replace(/<script type="application\/ld\+json">|<\/script>/g, ''), /<\/script/i);
  });

  it('date le plan du site de la mise en ligne, jamais d’un fichier vieux de plusieurs années', async () => {
    const { lastModifiedOf } = await import('@server/services/seo');
    const aujourdhui = new Date('2026-10-04T10:00:00Z');
    assert.equal(lastModifiedOf(new Date('2018-10-20T00:00:00Z'), aujourdhui), '2026-10-04', 'date de fichier figée chez l’hébergeur : écartée');
    assert.equal(lastModifiedOf(new Date('2026-09-28T12:00:00Z'), aujourdhui), '2026-09-28', 'date plausible : gardée');
    assert.equal(lastModifiedOf(null, aujourdhui), '2026-10-04');
    assert.equal(lastModifiedOf(new Date('2027-01-01T00:00:00Z'), aujourdhui), '2026-10-04', 'une date à venir n’est pas crue');
  });

  it('publie sa clé et déclare ses pages aux moteurs, une fois par mise en ligne', async () => {
    const { indexNowKey, submitToIndexNow } = await import('@server/services/seo/indexNow');
    assert.equal(indexNowKey(), CLE);

    // La clé est lisible à l'adresse annoncée : c'est là que le moteur vient la vérifier.
    const cle = await request(app).get(`/${CLE}.txt`).expect(200);
    assert.equal(cle.text, CLE);
    await request(app).get('/une-autre-cle.txt').expect(404);

    assert.deepEqual(await submitToIndexNow(), { submitted: 0, skipped: 'hors production' }, 'un poste de développement ne déclare rien');

    const premiere = await submitToIndexNow(new Date(), { force: true });
    assert.equal(premiere.submitted, 6);
    assert.equal(declarations.length, 1);
    const [envoi] = declarations;
    assert.equal(envoi!.host, 'smart-creator.example');
    assert.equal(envoi!.key, CLE);
    assert.equal(envoi!.keyLocation, `https://smart-creator.example/${CLE}.txt`);
    assert.ok(envoi!.urlList.includes('https://smart-creator.example/'));
    assert.ok(envoi!.urlList.every((url) => !/\/app|\/api/.test(url)), 'seules les pages publiques sont déclarées');

    // Même version, le lendemain : rien n'est renvoyé. Une semaine plus tard : la déclaration est refaite.
    assert.equal((await submitToIndexNow(new Date(Date.now() + 86_400_000), { force: true })).skipped, 'déjà déclarée pour cette version');
    assert.equal(declarations.length, 1);
    assert.equal((await submitToIndexNow(new Date(Date.now() + 8 * 86_400_000), { force: true })).submitted, 6);
    assert.equal(declarations.length, 2);
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
      assert.match(home.text, /Sachez quoi vendre avant de le produire/, 'le texte de l’accueil est dans la page servie');
      assert.equal(home.headers['x-robots-tag'], undefined);
      // Le navigateur revalide ; le réseau de l'hébergeur garde la page, identique pour tous.
      assert.equal(home.headers['cache-control'], 'no-cache');
      assert.match(String(home.headers['vercel-cdn-cache-control']), /^max-age=\d+/);
      assert.equal(home.headers['set-cookie'], undefined, 'aucun cookie dans une page gardée en cache');

      const plan = await request(site).get('/sitemap.xml').expect(200);
      assert.match(plan.text, new RegExp(`<lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>`), 'fichier tout juste écrit : daté d’aujourd’hui');

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
