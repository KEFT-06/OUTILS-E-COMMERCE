/** « à l’instant », « il y a 5 min », « il y a 3 h », puis la date. */
export function formatRelativeFr(iso: string, now = Date.now()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return formatDateFr(iso, true);
}

/** Date lisible en français ; renvoie l'entrée telle quelle si elle n'est pas une date. */
export function formatDateFr(iso: string, withTime = false): string {
  // « 2026-09-23 » seul est lu par JavaScript comme minuit UTC : à l'ouest de Greenwich
  // (Canada, États-Unis), la date affichée reculait d'un jour. Une date sans heure est
  // un jour du calendrier, lu tel quel dans le fuseau de l'appareil.
  const jour = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const date = jour ? new Date(Number(jour[1]), Number(jour[2]) - 1, Number(jour[3])) : new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  return withTime
    ? date.toLocaleString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
