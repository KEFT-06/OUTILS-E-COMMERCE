import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@server/env';
import { AppError } from '@server/middleware';

/** Jeton aléatoire de 256 bits en base64url : cookies de session, liens à usage unique. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Empreinte SHA-256 : seule forme sous laquelle un jeton est stocké. Un jeton de
 * 256 bits tiré au hasard n'a pas besoin d'un hachage lent ; une fuite de la base
 * ne livre donc aucune session utilisable.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Comparaison en temps constant : la durée ne révèle pas combien de caractères concordent. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function encryptionKey(): Buffer {
  if (!env.DATA_ENCRYPTION_KEY) {
    throw new AppError(
      503,
      'La clé de chiffrement des données (DATA_ENCRYPTION_KEY) n’est pas configurée sur le serveur.',
      'ENCRYPTION_KEY_MISSING',
    );
  }
  return Buffer.from(env.DATA_ENCRYPTION_KEY, 'hex');
}

const FORMAT_VERSION = 'v1';

/**
 * Chiffre un secret en AES-256-GCM, chiffrement authentifié : une valeur modifiée
 * en base est détectée au déchiffrement au lieu de produire un secret corrompu.
 * Format stocké : `v1.iv.tag.données`, en base64url.
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [FORMAT_VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== FORMAT_VERSION || !iv || !tag || !data) {
    throw new AppError(500, 'Secret chiffré illisible.', 'SECRET_UNREADABLE');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(500, 'Secret chiffré illisible : clé de chiffrement différente ou donnée altérée.', 'SECRET_UNREADABLE');
  }
}
