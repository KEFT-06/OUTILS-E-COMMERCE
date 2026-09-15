/**
 * Présentation des sessions : un libellé d'appareil lisible et une adresse IP
 * tronquée. L'adresse complète est une donnée personnelle ; la ville ou
 * l'opérateur suffisent rarement à identifier une personne, les deux premiers
 * octets jamais.
 */

export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Appareil inconnu';

  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\/|Opera/.test(userAgent)
      ? 'Opera'
      : /SamsungBrowser/.test(userAgent)
        ? 'Samsung Internet'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : /Chrome\//.test(userAgent)
            ? 'Chrome'
            : /Safari\//.test(userAgent)
              ? 'Safari'
              : null;

  const system = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;

  if (!browser && !system) return 'Autre appareil';
  return [browser, system].filter(Boolean).join(' · ');
}

export function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const [first, second] = v4.split('.');
    return `${first}.${second}.x.x`;
  }
  const groups = ip.split(':').filter(Boolean);
  return groups.length > 0 ? `${groups.slice(0, 2).join(':')}:…` : null;
}
