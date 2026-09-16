import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { STRONG_PASSWORD, closeTestApp, createTestApp } from './support/helpers';

/**
 * Premier administrateur d'une installation neuve (ADMIN_BOOTSTRAP_EMAIL) : créé une seule fois,
 * sans mot de passe transmis, avec un lien à usage unique ; sans effet dès qu'un administrateur existe.
 */

let app: Express;

before(async () => {
  app = await createTestApp({ APP_URL: 'https://smart-creator.example' });
});

after(closeTestApp);

async function withCapturedLogs<T>(run: () => Promise<T>): Promise<{ result: T; output: string }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => {
    lines.push(parts.map(String).join(' '));
  };
  try {
    return { result: await run(), output: lines.join('\n') };
  } finally {
    console.log = original;
  }
}

describe('Premier administrateur au démarrage', () => {
  it('crée le compte une seule fois et donne un lien à usage unique, jamais un mot de passe', async () => {
    const { bootstrapFirstAdmin } = await import('@server/services/admin/bootstrap');

    const first = await withCapturedLogs(() => bootstrapFirstAdmin('Proprietaire@Exemple.com'));
    assert.equal(first.result, 'created');
    const token = /https:\/\/smart-creator\.example\/mot-de-passe#([A-Za-z0-9_-]+)/.exec(first.output)?.[1];
    assert.ok(token, 'lien à usage unique sur l’adresse publique');

    const inspected = await request(app).post('/api/auth/password-token/inspect').send({ token }).expect(200);
    assert.equal(inspected.body.purpose, 'setup');
    await request(app).post('/api/auth/password-token/consume').send({ token, password: STRONG_PASSWORD }).expect(204);

    const login = await request(app).post('/api/auth/login').send({ email: 'proprietaire@exemple.com', password: STRONG_PASSWORD }).expect(200);
    assert.equal(login.body.account.role, 'admin');

    const again = await withCapturedLogs(() => bootstrapFirstAdmin('autre-personne@exemple.com'));
    assert.equal(again.result, 'skipped', 'un administrateur existe déjà : rien ne change');
    assert.doesNotMatch(again.output, /mot-de-passe#/);
    await request(app).post('/api/auth/login').send({ email: 'autre-personne@exemple.com', password: STRONG_PASSWORD }).expect(401);
  });
});
