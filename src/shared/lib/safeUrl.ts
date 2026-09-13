/**
 * N'accepte que les liens http(s).
 *
 * Les URL de la galerie viennent de sources externes. Injectée telle quelle
 * dans un `href`, une valeur « javascript:… » s'exécuterait au clic dans la
 * session de l'utilisateur.
 */
export function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
