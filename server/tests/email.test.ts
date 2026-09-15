import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { STRONG_PASSWORD, closeTestApp, createTestApp, signUp } from './helpers';

/**
 * E-mails transactionnels contre un faux Brevo : confirmation d'adresse, mot de passe
 * oublié et alerte de changement de mot de passe. Aucun vrai e-mail ne part.
 */

interface SentEmail {
  apiKey: string | undefined;
  to: string;
  subject: string;
  text: string;
  html: string;
}

const sent: SentEmail[] = [];

const fakeBrevo = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    if (req.url === '/brevo/v3/smtp/email' && req.method === 'POST') {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        to: { email: string }[];
        subject: string;
        textContent: string;
        htmlContent: string;
      };
      sent.push({ apiKey: req.headers['api-key'] as string | undefined, to: body.to[0]!.email, subject: body.subject, text: body.textContent, html: body.htmlContent });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messageId: 'test' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((resolve) => fakeBrevo.listen(0, '127.0.0.1', resolve));
  app = await createTestApp({
    EMAIL_PROVIDER: 'brevo',
    EMAIL_API_KEY: 'cle-email-de-test',
    EMAIL_FROM: 'Smart Creator <no-reply@smartcreator.test>',
    EMAIL_API_URL: `http://127.0.0.1:${(fakeBrevo.address() as AddressInfo).port}/brevo`,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => fakeBrevo.close(() => resolve()));
});

async function nextEmail(to: string, subject: RegExp): Promise<SentEmail> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = sent.find((email) => email.to === to && subject.test(email.subject));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Aucun e-mail « ${subject} » pour ${to}`);
}

const tokenIn = (email: SentEmail, path: string) => {
  const match = new RegExp(`${path}#([A-Za-z0-9_-]+)`).exec(email.text);
  assert.ok(match, `lien ${path} absent de l’e-mail`);
  return match[1]!;
};

describe('E-mails transactionnels', () => {
  it('envoie la confirmation d’adresse à l’inscription et la valide une seule fois', async () => {
    const { agent } = await signUp(app, { name: 'Mariam Confirme', email: 'mariam@exemple.com' });
    const before = (await agent.get('/api/auth/me').expect(200)).body.account;
    assert.deepEqual(before.emailVerification, { verified: false, available: true });

    const email = await nextEmail('mariam@exemple.com', /Confirmez votre adresse/);
    assert.equal(email.apiKey, 'cle-email-de-test', 'clé en en-tête');
    assert.ok(!email.html.includes('<script'), 'contenu échappé');
    const token = tokenIn(email, '/verifier-email');

    await request(app).post('/api/auth/verify-email').send({ token }).expect(204);
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account.emailVerification.verified, true);
    await request(app).post('/api/auth/verify-email').send({ token }).expect(404);

    await agent.post('/api/account/verify-email/send').expect(409);
  });

  it('envoie un lien de mot de passe sans révéler si l’adresse est inscrite', async () => {
    await signUp(app, { name: 'Oumar Oublie', email: 'oumar@exemple.com' });

    const known = await request(app).post('/api/auth/password-reset').send({ email: 'Oumar@Exemple.com' }).expect(202);
    const unknown = await request(app).post('/api/auth/password-reset').send({ email: 'personne@exemple.com' }).expect(202);
    assert.deepEqual(known.body, unknown.body, 'même réponse pour une adresse inconnue');

    const email = await nextEmail('oumar@exemple.com', /Réinitialiser votre mot de passe/);
    const token = tokenIn(email, '/mot-de-passe');

    const inspected = await request(app).post('/api/auth/password-token/inspect').send({ token }).expect(200);
    assert.equal(inspected.body.purpose, 'reset');
    await request(app).post('/api/auth/password-token/consume').send({ token, password: 'Nouveau-Mot-De-Passe-2026' }).expect(204);
    await request(app).post('/api/auth/login').send({ email: 'oumar@exemple.com', password: 'Nouveau-Mot-De-Passe-2026' }).expect(200);

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(sent.filter((message) => message.to === 'personne@exemple.com').length, 0, 'aucun e-mail pour une adresse inconnue');

    // Au-delà de 3 demandes par heure, la réponse ne change pas mais aucun e-mail ne part.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await request(app).post('/api/auth/password-reset').send({ email: 'oumar@exemple.com' }).expect(202);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(sent.filter((message) => message.to === 'oumar@exemple.com' && /Réinitialiser/.test(message.subject)).length, 3);
  });

  it('prévient par e-mail quand le mot de passe change', async () => {
    const { agent } = await signUp(app, { name: 'Kofi Change', email: 'kofi@exemple.com' });
    await agent.post('/api/account/password').send({ currentPassword: STRONG_PASSWORD, newPassword: 'Autre-Mot-De-Passe-2026' }).expect(204);
    const email = await nextEmail('kofi@exemple.com', /mot de passe .* a été modifié/);
    assert.match(email.text, /mot-de-passe-oublie/);
  });
});
