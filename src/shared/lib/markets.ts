/**
 * Marchés acceptés par l'API (`marketSchema`, server/middleware).
 *
 * Libellés d'affichage uniquement : le serveur reste l'autorité, et un code
 * retiré de son côté sera refusé avec un message explicite.
 */
export const MARKETS: readonly { code: string; label: string }[] = [
  { code: 'CI', label: "Côte d'Ivoire" },
  { code: 'SN', label: 'Sénégal' },
  { code: 'CM', label: 'Cameroun' },
  { code: 'BJ', label: 'Bénin' },
  { code: 'TG', label: 'Togo' },
  { code: 'BF', label: 'Burkina Faso' },
  { code: 'ML', label: 'Mali' },
  { code: 'NE', label: 'Niger' },
  { code: 'GN', label: 'Guinée' },
  { code: 'CD', label: 'RD Congo' },
  { code: 'CG', label: 'Congo' },
  { code: 'GA', label: 'Gabon' },
  { code: 'TD', label: 'Tchad' },
  { code: 'MG', label: 'Madagascar' },
  { code: 'MA', label: 'Maroc' },
  { code: 'TN', label: 'Tunisie' },
  { code: 'DZ', label: 'Algérie' },
];

export function marketLabel(code: string): string {
  return MARKETS.find((market) => market.code === code)?.label ?? code;
}
