import { findCountry } from '@server/shared/countries';

/**
 * Pays probable du visiteur, pour préremplir un choix qu'il peut toujours changer.
 *
 * Aucune géolocalisation par adresse IP, aucun service tiers : le fuseau horaire
 * du système d'abord (un ordinateur réglé en français au Cameroun a le fuseau
 * Africa/Douala), puis la région de la langue du navigateur (fr-CM, en-US).
 */
const TIMEZONE_COUNTRY: Record<string, string> = {
  'Africa/Abidjan': 'CI', 'Africa/Accra': 'GH', 'Africa/Addis_Ababa': 'ET', 'Africa/Algiers': 'DZ', 'Africa/Asmara': 'ER',
  'Africa/Bamako': 'ML', 'Africa/Bangui': 'CF', 'Africa/Banjul': 'GM', 'Africa/Bissau': 'GW', 'Africa/Blantyre': 'MW',
  'Africa/Brazzaville': 'CG', 'Africa/Bujumbura': 'BI', 'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA', 'Africa/Conakry': 'GN',
  'Africa/Dakar': 'SN', 'Africa/Dar_es_Salaam': 'TZ', 'Africa/Djibouti': 'DJ', 'Africa/Douala': 'CM', 'Africa/El_Aaiun': 'EH',
  'Africa/Freetown': 'SL', 'Africa/Gaborone': 'BW', 'Africa/Harare': 'ZW', 'Africa/Johannesburg': 'ZA', 'Africa/Juba': 'SS',
  'Africa/Kampala': 'UG', 'Africa/Khartoum': 'SD', 'Africa/Kigali': 'RW', 'Africa/Kinshasa': 'CD', 'Africa/Lagos': 'NG',
  'Africa/Libreville': 'GA', 'Africa/Lome': 'TG', 'Africa/Luanda': 'AO', 'Africa/Lubumbashi': 'CD', 'Africa/Lusaka': 'ZM',
  'Africa/Malabo': 'GQ', 'Africa/Maputo': 'MZ', 'Africa/Maseru': 'LS', 'Africa/Mbabane': 'SZ', 'Africa/Mogadishu': 'SO',
  'Africa/Monrovia': 'LR', 'Africa/Nairobi': 'KE', 'Africa/Ndjamena': 'TD', 'Africa/Niamey': 'NE', 'Africa/Nouakchott': 'MR',
  'Africa/Ouagadougou': 'BF', 'Africa/Porto-Novo': 'BJ', 'Africa/Sao_Tome': 'ST', 'Africa/Tripoli': 'LY', 'Africa/Tunis': 'TN',
  'Africa/Windhoek': 'NA', 'Indian/Antananarivo': 'MG', 'Indian/Comoro': 'KM', 'Indian/Mauritius': 'MU', 'Indian/Reunion': 'RE',
  'Indian/Mayotte': 'YT', 'Indian/Mahe': 'SC', 'Atlantic/Cape_Verde': 'CV',
  'Europe/Paris': 'FR', 'Europe/Brussels': 'BE', 'Europe/Zurich': 'CH', 'Europe/Luxembourg': 'LU', 'Europe/Monaco': 'MC',
  'Europe/London': 'GB', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Lisbon': 'PT',
  'Europe/Amsterdam': 'NL', 'Europe/Dublin': 'IE',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Phoenix': 'US',
  'America/Anchorage': 'US', 'America/Toronto': 'CA', 'America/Montreal': 'CA', 'America/Vancouver': 'CA', 'America/Sao_Paulo': 'BR',
  'America/Mexico_City': 'MX', 'America/Port-au-Prince': 'HT', 'America/Martinique': 'MQ', 'America/Guadeloupe': 'GP',
  'America/Cayenne': 'GF', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Kolkata': 'IN', 'Asia/Shanghai': 'CN', 'Asia/Tokyo': 'JP',
  'Asia/Beirut': 'LB', 'Pacific/Noumea': 'NC', 'Pacific/Tahiti': 'PF',
};

export function guessCountryCode(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fromZone = zone ? TIMEZONE_COUNTRY[zone] : undefined;
    if (fromZone) return fromZone;
  } catch {
    // Fuseau illisible : on passe à la langue.
  }

  const languages = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language];
  for (const language of languages) {
    const region = language?.split('-')[1];
    if (region && findCountry(region)) return region.toUpperCase();
  }
  return null;
}
