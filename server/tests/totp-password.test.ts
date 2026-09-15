import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.NODE_ENV = 'test';

const { base32Decode, base32Encode, generateRecoveryCodes, hashRecoveryCode, totpCode, verifyTotp } = await import(
  '@server/services/auth/totp'
);
const { hashPassword, passwordProblems, verifyPassword } = await import('@server/services/auth/password');

describe('TOTP (RFC 6238)', () => {
  // Vecteurs officiels de l'annexe B de la RFC 6238, HMAC-SHA1, 8 chiffres.
  const secret = Buffer.from('12345678901234567890', 'ascii');
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ];

  for (const [time, expected] of vectors) {
    it(`produit ${expected} à T=${time}`, () => {
      assert.equal(totpCode(secret, Math.floor(time / 30), 8), expected);
    });
  }

  it('encode et décode le base32 sans perte', () => {
    const bytes = Buffer.from('Smart Creator — 2FA');
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  });

  it('accepte ±30 s et refuse un code rejoué ou plus ancien que le dernier accepté', () => {
    const encoded = base32Encode(secret);
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);

    assert.equal(verifyTotp(encoded, totpCode(encoded, step), null, now), step);
    assert.equal(verifyTotp(encoded, totpCode(encoded, step - 1), null, now), step - 1);
    assert.equal(verifyTotp(encoded, totpCode(encoded, step + 1), null, now), step + 1);
    assert.equal(verifyTotp(encoded, totpCode(encoded, step + 2), null, now), null, 'hors fenêtre');
    assert.equal(verifyTotp(encoded, totpCode(encoded, step), step, now), null, 'rejeu du même pas');
    assert.equal(verifyTotp(encoded, 'abcdef', null, now), null);
  });

  it('génère dix codes de secours distincts, hachés indépendamment de la casse et du tiret', () => {
    const codes = generateRecoveryCodes();
    assert.equal(new Set(codes).size, 10);
    for (const code of codes) assert.match(code, /^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    const first = codes[0]!;
    assert.equal(hashRecoveryCode(first.toLowerCase().replace('-', '')), hashRecoveryCode(first));
  });
});

describe('Politique de mot de passe', () => {
  it('refuse les mots de passe courts, répétitifs, connus ou personnels', () => {
    assert.ok(passwordProblems('court').length > 0);
    assert.ok(passwordProblems('aaaaaaaaaaaaaaaa').length > 0);
    assert.ok(passwordProblems('motdepasse123').length > 0);
    assert.ok(passwordProblems('awa.traore-2026!', { email: 'awa.traore@exemple.com' }).length > 0);
    assert.ok(passwordProblems('Moussa-Baobab-7788', { name: 'Moussa Diallo' }).length > 0);
  });

  it('accepte une phrase de passe longue sans exiger de symboles', () => {
    assert.deepEqual(passwordProblems('le marche de dantokpa ouvre tot', { email: 'kofi@exemple.com' }), []);
  });

  it('hache en Argon2id et vérifie sans révéler l’absence de compte', async () => {
    const hash = await hashPassword('Baobab-Soleil-Marche-42');
    assert.match(hash, /^\$argon2id\$/);
    assert.equal(await verifyPassword(hash, 'Baobab-Soleil-Marche-42'), true);
    assert.equal(await verifyPassword(hash, 'Baobab-Soleil-Marche-43'), false);
    assert.equal(await verifyPassword(null, 'nimporte quoi'), false);
  });
});
