import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { STRONG_PASSWORD, closeTestApp, createTestApp, signUp } from './support/helpers';

/**
 * « Continuer avec Google », contre un faux Google : aucun appel au vrai service.
 *
 * Le faux point de terminaison vérifie ce que le vrai vérifierait — secret client et
 * vérificateur PKCE — et rend un jeton d'identité dont chaque test choisit le contenu.
 */

const CLIENT_ID = 'client-test.apps.googleusercontent.com';
const CLIENT_SECRET = 'secret-client-de-test';

/** Contenu du jeton que le faux Google rendra pour le prochain code, et ce qu'il a reçu. */
let prochain: Record<string, unknown> = {};
const recus: { verifier: string | null; secret: string | null }[] = [];
let defiAttendu = '';

const faux = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/token') {
      const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const verifier = body.get('code_verifier');
      recus.push({ verifier, secret: body.get('client_secret') });
      const defi = verifier ? createHash('sha256').update(verifier).digest('base64url') : '';
      if (body.get('client_secret') !== CLIENT_SECRET || defi !== defiAttendu) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      const jeton = ['e30', Buffer.from(JSON.stringify(prochain)).toString('base64url'), 'signature'].join('.');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id_token: jeton, access_token: 'a' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(faux.address() as AddressInfo).port}`;
  app = await createTestApp({
    GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
    GOOGLE_OAUTH_AUTH_URL: `${base}/auth`,
    GOOGLE_OAUTH_TOKEN_URL: `${base}/token`,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => faux.close(() => r()));
});

/** Départ vers Google : renvoie l'agent (cookies compris) et ce que Google a reçu dans l'adresse. */
/** Visiteur anonyme : /api/auth/me répond 200 avec un compte nul. */
async function partir(agent = request.agent(app)) {
  const depart = await agent.get('/api/auth/google/start').query({ next: '/app/niches' }).expect(303);
  const vers = new URL(depart.headers.location as string);
  defiAttendu = vers.searchParams.get('code_challenge') ?? '';
  return { agent, state: vers.searchParams.get('state')!, nonce: vers.searchParams.get('nonce')!, vers, cookie: String(depart.headers['set-cookie']) };
}

const claims = (nonce: string, extra: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: 'google-sub-1',
  email: 'awa.google@exemple.com',
  email_verified: true,
  name: 'Awa Google',
  nonce,
  exp: Math.floor(Date.now() / 1000) + 600,
  ...extra,
});

describe('Connexion avec Google', () => {
  it('part chez Google avec state, nonce et PKCE, et un cookie SameSite=Lax', async () => {
    const { vers, cookie, state, nonce } = await partir();
    assert.equal(vers.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(vers.searchParams.get('code_challenge_method'), 'S256');
    assert.match(vers.searchParams.get('redirect_uri') ?? '', /\/api\/auth\/google\/callback$/);
    assert.ok(state.length >= 32 && nonce.length >= 32);
    assert.match(cookie, /SameSite=Lax/i, 'un cookie Strict ne reviendrait pas de chez Google');
    assert.match(cookie, /HttpOnly/i);
  });

  it('crée le compte, ouvre la session et revient sur la page demandée', async () => {
    const { agent, state, nonce } = await partir();
    prochain = claims(nonce);
    const retour = await agent.get('/api/auth/google/callback').query({ code: 'code-1', state }).expect(303);
    assert.equal(retour.headers.location, '/app/niches');
    const moi = await agent.get('/api/auth/me').expect(200);
    assert.equal(moi.body.account.email, 'awa.google@exemple.com');
    assert.equal(moi.body.account.googleLinked, true);
    assert.equal(moi.body.account.emailLogin, false, 'aucun mot de passe inventé');
    assert.equal(moi.body.account.emailVerification.verified, true, 'Google a vérifié l’adresse');
    assert.equal(recus.at(-1)?.secret, CLIENT_SECRET);
  });

  it('refuse une réponse que ce navigateur n’a pas demandée', async () => {
    const { agent, nonce } = await partir();
    prochain = claims(nonce);
    const retour = await agent.get('/api/auth/google/callback').query({ code: 'code-2', state: 'state-falsifie' }).expect(303);
    assert.equal(retour.headers.location, '/connexion?erreur=google_expire');
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account, null, 'aucune session ouverte');

    const inconnu = request.agent(app);
    const sansCookie = await inconnu.get('/api/auth/google/callback').query({ code: 'code-3', state: 'x' }).expect(303);
    assert.equal(sansCookie.headers.location, '/connexion?erreur=google_expire');
  });

  it('ne relie pas un compte sur une adresse non vérifiée chez Google', async () => {
    const { agent, state, nonce } = await partir();
    prochain = claims(nonce, { sub: 'google-sub-2', email: 'non.verifiee@exemple.com', email_verified: false });
    const retour = await agent.get('/api/auth/google/callback').query({ code: 'code-4', state }).expect(303);
    assert.equal(retour.headers.location, '/connexion?erreur=google_non_verifie');
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account, null, 'aucune session ouverte');
  });

  it('refuse un jeton destiné à une autre application, ou tiré d’une autre connexion', async () => {
    const autreApp = await partir();
    prochain = claims(autreApp.nonce, { aud: 'autre-client.apps.googleusercontent.com' });
    const refus = await autreApp.agent.get('/api/auth/google/callback').query({ code: 'code-5', state: autreApp.state }).expect(303);
    assert.equal(refus.headers.location, '/connexion?erreur=google_refuse');

    const rejoue = await partir();
    prochain = claims('nonce-d-une-autre-connexion');
    const refus2 = await rejoue.agent.get('/api/auth/google/callback').query({ code: 'code-6', state: rejoue.state }).expect(303);
    assert.equal(refus2.headers.location, '/connexion?erreur=google_refuse');
  });

  it('relie un compte existant par son adresse vérifiée, puis le retrouve par son identifiant Google', async () => {
    const existant = await signUp(app, { name: 'Kofi Mensah', email: 'kofi.existant@exemple.com' });
    const premier = await partir();
    prochain = claims(premier.nonce, { sub: 'google-sub-kofi', email: 'Kofi.Existant@exemple.com' });
    await premier.agent.get('/api/auth/google/callback').query({ code: 'code-7', state: premier.state }).expect(303);
    const moi = await premier.agent.get('/api/auth/me').expect(200);
    assert.equal(moi.body.account.id, existant.account.id, 'le même compte, pas un doublon');
    assert.equal(moi.body.account.emailLogin, true);

    // Adresse changée chez Google : l'identifiant retrouve quand même le compte.
    const second = await partir();
    prochain = claims(second.nonce, { sub: 'google-sub-kofi', email: 'kofi.nouvelle.adresse@exemple.com' });
    await second.agent.get('/api/auth/google/callback').query({ code: 'code-8', state: second.state }).expect(303);
    assert.equal((await second.agent.get('/api/auth/me').expect(200)).body.account.id, existant.account.id);
  });

  it('exige encore le second facteur d’un compte qui en a un', async () => {
    const protege = await signUp(app, { name: 'Binta Camara', email: 'binta.protegee@exemple.com' });
    await protege.agent.post('/api/account/two-factor/security-code').send({ password: STRONG_PASSWORD, newCode: 'Mangue-Plantain-2026' }).expect(200);

    const { agent, state, nonce } = await partir();
    prochain = claims(nonce, { sub: 'google-sub-binta', email: 'binta.protegee@exemple.com' });
    const retour = await agent.get('/api/auth/google/callback').query({ code: 'code-9', state }).expect(303);
    assert.match(retour.headers.location as string, /^\/connexion\?etape=code&methodes=/);
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account, null, 'aucune session ouverte');
    const fini = await agent.post('/api/auth/login/mfa').send({ code: 'Mangue-Plantain-2026' }).expect(200);
    assert.equal(fini.body.account.email, 'binta.protegee@exemple.com');
  });

  it('laisse un compte ouvert par Google définir un mot de passe, puis se supprimer', async () => {
    const { agent, state, nonce } = await partir();
    prochain = claims(nonce, { sub: 'google-sub-sans-mdp', email: 'sans.mdp@exemple.com', name: 'Ama Owusu' });
    await agent.get('/api/auth/google/callback').query({ code: 'code-10', state }).expect(303);

    await agent.post('/api/account/password').send({ currentPassword: '', newPassword: STRONG_PASSWORD }).expect(204);
    const moi = await agent.get('/api/auth/me').expect(200);
    assert.equal(moi.body.account.emailLogin, true);
    // Désormais il a un mot de passe : un « actuel » vide ne suffit plus.
    await agent.post('/api/account/password').send({ currentPassword: '', newPassword: `${STRONG_PASSWORD}x` }).expect(400);

    const autre = await partir();
    prochain = claims(autre.nonce, { sub: 'google-sub-a-supprimer', email: 'a.supprimer@exemple.com', name: 'Yao Kouame' });
    await autre.agent.get('/api/auth/google/callback').query({ code: 'code-11', state: autre.state }).expect(303);
    await autre.agent.delete('/api/account').send({ password: '', confirmation: 'SUPPRIMER' }).expect(204);
    assert.equal((await autre.agent.get('/api/auth/me').expect(200)).body.account, null, 'aucune session ouverte');
  });
});
