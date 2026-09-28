import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isProd } from '@server/env';
import { AppError } from '@server/middleware';

/**
 * Adresse fournie par un utilisateur, que le SERVEUR va appeler (le site WooCommerce d'un
 * vendeur, par exemple). Sans garde, un compte pourrait faire interroger par le serveur une
 * adresse interne — base de données, métadonnées de l'hébergeur — et en lire la réponse.
 *
 * Refusé : tout ce qui n'est pas https, et tout nom qui se résout vers une adresse privée,
 * locale ou réservée. Seule exception : la boucle locale en clair, HORS production, pour que
 * les tests servent un faux site sans certificat.
 */

const PRIVATE_V4 = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10
  [0x7f000000, 8], // 127/8
  [0xa9fe0000, 16], // 169.254/16 (métadonnées des hébergeurs)
  [0xac100000, 12], // 172.16/12
  [0xc0000000, 24], // 192.0.0/24
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // 198.18/15
  [0xe0000000, 3], // 224/3 (multidiffusion et réservé)
] as const;

function privateV4(address: string): boolean {
  const n = address.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
  return PRIVATE_V4.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
}

function privateAddress(address: string): boolean {
  if (isIP(address) === 4) return privateV4(address);
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return privateV4(mapped[1]!);
  return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/;

/** Rend l'URL normalisée si elle est publique ; lève sinon. */
export async function assertPublicUrl(raw: string, label = 'L’adresse'): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AppError(400, `${label} est invalide.`, 'URL_INVALID');
  }
  if (!isProd && url.protocol === 'http:' && LOOPBACK.test(url.hostname)) return url;
  if (url.protocol !== 'https:') throw new AppError(400, `${label} doit commencer par https://.`, 'URL_NOT_HTTPS');
  if (url.username || url.password) throw new AppError(400, `${label} ne doit pas contenir d’identifiants.`, 'URL_INVALID');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  } catch {
    throw new AppError(400, `${label} ne correspond à aucun site joignable.`, 'URL_UNREACHABLE');
  }
  if (addresses.length === 0 || addresses.some(privateAddress)) {
    throw new AppError(400, `${label} pointe vers un réseau privé : elle est refusée.`, 'URL_PRIVATE');
  }
  return url;
}
