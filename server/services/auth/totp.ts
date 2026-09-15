import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual, sha256 } from '@server/lib/crypto';

/**
 * Double authentification par code à 6 chiffres (TOTP, RFC 6238), compatible avec
 * Google Authenticator, Microsoft Authenticator, 2FAS ou Aegis.
 *
 * Écrit sans dépendance : l'algorithme tient en quelques lignes, et chaque
 * bibliothèque ajoutée sur le chemin de l'authentification est une surface
 * d'attaque de plus. Vérifié contre les vecteurs de test de la RFC.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
export const TOTP_ISSUER = 'Smart Creator';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Secret base32 invalide.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secret de 160 bits, la taille recommandée par la RFC 4226 pour HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCode(secret: string | Buffer, step: number, digits = TOTP_DIGITS): string {
  const key = typeof secret === 'string' ? base32Decode(secret) : secret;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Vérifie un code dans une fenêtre de ±1 pas (±30 s), pour tolérer une horloge de
 * téléphone légèrement décalée. Renvoie le pas reconnu, ou null.
 *
 * Un pas inférieur ou égal au dernier accepté est refusé : un code intercepté ne
 * peut pas resservir, même dans sa fenêtre de validité.
 */
export function verifyTotp(secret: string, code: string, lastUsedStep: number | null, now = Date.now()): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;

  const step = totpStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if (lastUsedStep !== null && candidate <= lastUsedStep) continue;
    if (safeEqual(totpCode(secret, candidate), clean)) return candidate;
  }
  return null;
}

export function otpauthUri(secret: string, accountName: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer: TOTP_ISSUER,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Dix codes de secours de 40 bits chacun, au format XXXX-XXXX. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const code = base32Encode(randomBytes(5)).slice(0, 8);
    return `${code.slice(0, 4)}-${code.slice(4)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return sha256(code.toUpperCase().replace(/[^A-Z2-7]/g, ''));
}
