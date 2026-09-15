import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';

/**
 * Environnement de test : base PostgreSQL embarquée en mémoire, clé de chiffrement
 * éphémère, et fournisseurs pointés vers des serveurs factices ou injoignables.
 *
 * Les vraies clés du fichier .env sont écrasées AVANT le chargement de la
 * configuration : aucun test ne peut déclencher une génération payante ni lire
 * une vraie boutique.
 */
export async function createTestApp(overrides: Record<string, string> = {}): Promise<Express> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: 'memory://',
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    REPORTING_TIMEZONE: 'UTC',
    HIGGSFIELD_API_KEY_ID: 'cle-de-test',
    HIGGSFIELD_API_KEY_SECRET: 'secret-de-test',
    HIGGSFIELD_API_URL: 'http://127.0.0.1:9',
    CHARIOW_API_KEY: 'sk_test_cle_du_proprietaire_0000',
    CHARIOW_API_URL: 'http://127.0.0.1:9',
    GEMINI_API_KEY: 'cle-gemini-de-test',
    GEMINI_API_URL: 'http://127.0.0.1:9',
    BRAVE_SEARCH_API_KEY: '',
    BRAVE_SEARCH_API_URL: 'http://127.0.0.1:9',
    META_ACCESS_TOKEN: '',
    EXCHANGE_RATES_URL: 'off',
    ...overrides,
  });

  const { initDatabase } = await import('@server/db/client');
  await initDatabase();
  const { createApp } = await import('@server/app');
  return createApp();
}

export async function closeTestApp(): Promise<void> {
  const { closeDatabase } = await import('@server/db/client');
  await closeDatabase();
}

export const STRONG_PASSWORD = 'Baobab-Soleil-Marche-42';

/**
 * Téléphone d'authentification simulé. Chaque code utilise un pas TOTP strictement
 * croissant, comme l'exige la protection contre le rejeu, sans attendre 30 s.
 */
export class TotpDevice {
  private lastStep = Number.NEGATIVE_INFINITY;
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret.replace(/\s/g, '');
  }

  async next(): Promise<string> {
    const { totpCode, totpStep } = await import('@server/services/auth/totp');
    const step = Math.max(this.lastStep + 1, totpStep() - 1);
    this.lastStep = step;
    return totpCode(this.secret, step);
  }
}

export async function signUp(app: Express, input: { name: string; email: string; password?: string }) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/signup')
    .send({ name: input.name, email: input.email, password: input.password ?? STRONG_PASSWORD });
  if (response.status !== 201) throw new Error(`Inscription refusée : ${response.status} ${JSON.stringify(response.body)}`);
  return { agent, account: response.body.account as { id: string; credits: { total: number } } };
}

/** Administrateur connecté, double authentification activée. */
export async function createAdmin(app: Express, email = 'admin@smartcreator.test') {
  const { createUserRecord } = await import('@server/services/accounts');
  const { hashPassword } = await import('@server/services/auth/password');
  const user = await createUserRecord({
    name: 'Administratrice Test',
    email,
    passwordHash: await hashPassword(STRONG_PASSWORD),
    role: 'admin',
    plan: 'elite',
  });

  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD }).expect(200);
  const setup = await agent.post('/api/account/two-factor/setup').expect(200);
  const device = new TotpDevice(setup.body.secret);
  const enabled = await agent.post('/api/account/two-factor/enable').send({ code: await device.next() }).expect(200);

  return { agent, device, user, recoveryCodes: enabled.body.recoveryCodes as string[] };
}
