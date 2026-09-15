/**
 * Pays et devises, partagés par le serveur et le navigateur (fichier sans dépendance).
 *
 * Codes ISO 3166-1 alpha-2, plus le Kosovo (XK). Devise : celle d'usage courant
 * (ISO 4217). Noms tirés des données Unicode CLDR à la génération, figés ici pour
 * ne pas dépendre des données de langue du navigateur.
 *
 * Généré le 2026-09-15 : 249 pays.
 */

export interface Country {
  code: string;
  fr: string;
  en: string;
  currency: string;
}

const ROWS: readonly (readonly [string, string, string, string])[] = [
  ['AF', "Afghanistan", "Afghanistan", 'AFN'],
  ['ZA', "Afrique du Sud", "South Africa", 'ZAR'],
  ['AL', "Albanie", "Albania", 'ALL'],
  ['DZ', "Algérie", "Algeria", 'DZD'],
  ['DE', "Allemagne", "Germany", 'EUR'],
  ['AD', "Andorre", "Andorra", 'EUR'],
  ['AO', "Angola", "Angola", 'AOA'],
  ['AI', "Anguilla", "Anguilla", 'XCD'],
  ['AG', "Antigua-et-Barbuda", "Antigua & Barbuda", 'XCD'],
  ['SA', "Arabie saoudite", "Saudi Arabia", 'SAR'],
  ['AR', "Argentine", "Argentina", 'ARS'],
  ['AM', "Arménie", "Armenia", 'AMD'],
  ['AW', "Aruba", "Aruba", 'AWG'],
  ['AU', "Australie", "Australia", 'AUD'],
  ['AT', "Autriche", "Austria", 'EUR'],
  ['AZ', "Azerbaïdjan", "Azerbaijan", 'AZN'],
  ['BS', "Bahamas", "Bahamas", 'BSD'],
  ['BH', "Bahreïn", "Bahrain", 'BHD'],
  ['BD', "Bangladesh", "Bangladesh", 'BDT'],
  ['BB', "Barbade", "Barbados", 'BBD'],
  ['BE', "Belgique", "Belgium", 'EUR'],
  ['BZ', "Belize", "Belize", 'BZD'],
  ['BJ', "Bénin", "Benin", 'XOF'],
  ['BM', "Bermudes", "Bermuda", 'BMD'],
  ['BT', "Bhoutan", "Bhutan", 'BTN'],
  ['BY', "Biélorussie", "Belarus", 'BYN'],
  ['BO', "Bolivie", "Bolivia", 'BOB'],
  ['BA', "Bosnie-Herzégovine", "Bosnia & Herzegovina", 'BAM'],
  ['BW', "Botswana", "Botswana", 'BWP'],
  ['BR', "Brésil", "Brazil", 'BRL'],
  ['BN', "Brunei", "Brunei", 'BND'],
  ['BG', "Bulgarie", "Bulgaria", 'EUR'],
  ['BF', "Burkina Faso", "Burkina Faso", 'XOF'],
  ['BI', "Burundi", "Burundi", 'BIF'],
  ['KH', "Cambodge", "Cambodia", 'KHR'],
  ['CM', "Cameroun", "Cameroon", 'XAF'],
  ['CA', "Canada", "Canada", 'CAD'],
  ['CV', "Cap-Vert", "Cape Verde", 'CVE'],
  ['CL', "Chili", "Chile", 'CLP'],
  ['CN', "Chine", "China", 'CNY'],
  ['CY', "Chypre", "Cyprus", 'EUR'],
  ['CO', "Colombie", "Colombia", 'COP'],
  ['KM', "Comores", "Comoros", 'KMF'],
  ['CG', "République du Congo", "Congo - Brazzaville", 'XAF'],
  ['CD', "République démocratique du Congo", "Congo - Kinshasa", 'CDF'],
  ['KP', "Corée du Nord", "North Korea", 'KPW'],
  ['KR', "Corée du Sud", "South Korea", 'KRW'],
  ['CR', "Costa Rica", "Costa Rica", 'CRC'],
  ['CI', "Côte d’Ivoire", "Côte d’Ivoire", 'XOF'],
  ['HR', "Croatie", "Croatia", 'EUR'],
  ['CU', "Cuba", "Cuba", 'CUP'],
  ['CW', "Curaçao", "Curaçao", 'XCG'],
  ['DK', "Danemark", "Denmark", 'DKK'],
  ['DJ', "Djibouti", "Djibouti", 'DJF'],
  ['DM', "Dominique", "Dominica", 'XCD'],
  ['EG', "Égypte", "Egypt", 'EGP'],
  ['AE', "Émirats arabes unis", "United Arab Emirates", 'AED'],
  ['EC', "Équateur", "Ecuador", 'USD'],
  ['ER', "Érythrée", "Eritrea", 'ERN'],
  ['ES', "Espagne", "Spain", 'EUR'],
  ['EE', "Estonie", "Estonia", 'EUR'],
  ['SZ', "Eswatini", "Eswatini", 'SZL'],
  ['VA', "État de la Cité du Vatican", "Vatican City", 'EUR'],
  ['US', "États-Unis", "United States", 'USD'],
  ['ET', "Éthiopie", "Ethiopia", 'ETB'],
  ['FJ', "Fidji", "Fiji", 'FJD'],
  ['FI', "Finlande", "Finland", 'EUR'],
  ['FR', "France", "France", 'EUR'],
  ['GA', "Gabon", "Gabon", 'XAF'],
  ['GM', "Gambie", "Gambia", 'GMD'],
  ['GE', "Géorgie", "Georgia", 'GEL'],
  ['GS', "Géorgie du Sud-et-les Îles Sandwich du Sud", "South Georgia & South Sandwich Islands", 'GBP'],
  ['GH', "Ghana", "Ghana", 'GHS'],
  ['GI', "Gibraltar", "Gibraltar", 'GIP'],
  ['GR', "Grèce", "Greece", 'EUR'],
  ['GD', "Grenade", "Grenada", 'XCD'],
  ['GL', "Groenland", "Greenland", 'DKK'],
  ['GP', "Guadeloupe", "Guadeloupe", 'EUR'],
  ['GU', "Guam", "Guam", 'USD'],
  ['GT', "Guatemala", "Guatemala", 'GTQ'],
  ['GG', "Guernesey", "Guernsey", 'GBP'],
  ['GN', "Guinée", "Guinea", 'GNF'],
  ['GQ', "Guinée équatoriale", "Equatorial Guinea", 'XAF'],
  ['GW', "Guinée-Bissau", "Guinea-Bissau", 'XOF'],
  ['GY', "Guyana", "Guyana", 'GYD'],
  ['GF', "Guyane française", "French Guiana", 'EUR'],
  ['HT', "Haïti", "Haiti", 'HTG'],
  ['HN', "Honduras", "Honduras", 'HNL'],
  ['HU', "Hongrie", "Hungary", 'HUF'],
  ['BV', "Île Bouvet", "Bouvet Island", 'NOK'],
  ['CX', "Île Christmas", "Christmas Island", 'AUD'],
  ['IM', "Île de Man", "Isle of Man", 'GBP'],
  ['NF', "Île Norfolk", "Norfolk Island", 'AUD'],
  ['AX', "Îles Åland", "Åland Islands", 'EUR'],
  ['KY', "Îles Caïmans", "Cayman Islands", 'KYD'],
  ['CC', "Îles Cocos", "Cocos (Keeling) Islands", 'AUD'],
  ['CK', "Îles Cook", "Cook Islands", 'NZD'],
  ['FO', "Îles Féroé", "Faroe Islands", 'DKK'],
  ['HM', "Îles Heard-et-MacDonald", "Heard & McDonald Islands", 'AUD'],
  ['FK', "Îles Malouines", "Falkland Islands", 'FKP'],
  ['MP', "Îles Mariannes du Nord", "Northern Mariana Islands", 'USD'],
  ['MH', "Îles Marshall", "Marshall Islands", 'USD'],
  ['UM', "Îles mineures éloignées des États-Unis", "U.S. Outlying Islands", 'USD'],
  ['PN', "Îles Pitcairn", "Pitcairn Islands", 'NZD'],
  ['SB', "Îles Salomon", "Solomon Islands", 'SBD'],
  ['TC', "Îles Turques-et-Caïques", "Turks & Caicos Islands", 'USD'],
  ['VG', "Îles Vierges britanniques", "British Virgin Islands", 'USD'],
  ['VI', "Îles Vierges des États-Unis", "U.S. Virgin Islands", 'USD'],
  ['IN', "Inde", "India", 'INR'],
  ['ID', "Indonésie", "Indonesia", 'IDR'],
  ['IQ', "Irak", "Iraq", 'IQD'],
  ['IR', "Iran", "Iran", 'IRR'],
  ['IE', "Irlande", "Ireland", 'EUR'],
  ['IS', "Islande", "Iceland", 'ISK'],
  ['IL', "Israël", "Israel", 'ILS'],
  ['IT', "Italie", "Italy", 'EUR'],
  ['JM', "Jamaïque", "Jamaica", 'JMD'],
  ['JP', "Japon", "Japan", 'JPY'],
  ['JE', "Jersey", "Jersey", 'GBP'],
  ['JO', "Jordanie", "Jordan", 'JOD'],
  ['KZ', "Kazakhstan", "Kazakhstan", 'KZT'],
  ['KE', "Kenya", "Kenya", 'KES'],
  ['KG', "Kirghizstan", "Kyrgyzstan", 'KGS'],
  ['KI', "Kiribati", "Kiribati", 'AUD'],
  ['XK', "Kosovo", "Kosovo", 'EUR'],
  ['KW', "Koweït", "Kuwait", 'KWD'],
  ['RE', "La Réunion", "Réunion", 'EUR'],
  ['LA', "Laos", "Laos", 'LAK'],
  ['LS', "Lesotho", "Lesotho", 'LSL'],
  ['LV', "Lettonie", "Latvia", 'EUR'],
  ['LB', "Liban", "Lebanon", 'LBP'],
  ['LR', "Liberia", "Liberia", 'LRD'],
  ['LY', "Libye", "Libya", 'LYD'],
  ['LI', "Liechtenstein", "Liechtenstein", 'CHF'],
  ['LT', "Lituanie", "Lithuania", 'EUR'],
  ['LU', "Luxembourg", "Luxembourg", 'EUR'],
  ['MK', "Macédoine du Nord", "North Macedonia", 'MKD'],
  ['MG', "Madagascar", "Madagascar", 'MGA'],
  ['MY', "Malaisie", "Malaysia", 'MYR'],
  ['MW', "Malawi", "Malawi", 'MWK'],
  ['MV', "Maldives", "Maldives", 'MVR'],
  ['ML', "Mali", "Mali", 'XOF'],
  ['MT', "Malte", "Malta", 'EUR'],
  ['MA', "Maroc", "Morocco", 'MAD'],
  ['MQ', "Martinique", "Martinique", 'EUR'],
  ['MU', "Maurice", "Mauritius", 'MUR'],
  ['MR', "Mauritanie", "Mauritania", 'MRU'],
  ['YT', "Mayotte", "Mayotte", 'EUR'],
  ['MX', "Mexique", "Mexico", 'MXN'],
  ['FM', "Micronésie", "Micronesia", 'USD'],
  ['MD', "Moldavie", "Moldova", 'MDL'],
  ['MC', "Monaco", "Monaco", 'EUR'],
  ['MN', "Mongolie", "Mongolia", 'MNT'],
  ['ME', "Monténégro", "Montenegro", 'EUR'],
  ['MS', "Montserrat", "Montserrat", 'XCD'],
  ['MZ', "Mozambique", "Mozambique", 'MZN'],
  ['MM', "Myanmar (Birmanie)", "Myanmar (Burma)", 'MMK'],
  ['NA', "Namibie", "Namibia", 'NAD'],
  ['NR', "Nauru", "Nauru", 'AUD'],
  ['NP', "Népal", "Nepal", 'NPR'],
  ['NI', "Nicaragua", "Nicaragua", 'NIO'],
  ['NE', "Niger", "Niger", 'XOF'],
  ['NG', "Nigeria", "Nigeria", 'NGN'],
  ['NU', "Niue", "Niue", 'NZD'],
  ['NO', "Norvège", "Norway", 'NOK'],
  ['NC', "Nouvelle-Calédonie", "New Caledonia", 'XPF'],
  ['NZ', "Nouvelle-Zélande", "New Zealand", 'NZD'],
  ['OM', "Oman", "Oman", 'OMR'],
  ['UG', "Ouganda", "Uganda", 'UGX'],
  ['UZ', "Ouzbékistan", "Uzbekistan", 'UZS'],
  ['PK', "Pakistan", "Pakistan", 'PKR'],
  ['PW', "Palaos", "Palau", 'USD'],
  ['PA', "Panama", "Panama", 'PAB'],
  ['PG', "Papouasie-Nouvelle-Guinée", "Papua New Guinea", 'PGK'],
  ['PY', "Paraguay", "Paraguay", 'PYG'],
  ['NL', "Pays-Bas", "Netherlands", 'EUR'],
  ['BQ', "Pays-Bas caribéens", "Caribbean Netherlands", 'USD'],
  ['PE', "Pérou", "Peru", 'PEN'],
  ['PH', "Philippines", "Philippines", 'PHP'],
  ['PL', "Pologne", "Poland", 'PLN'],
  ['PF', "Polynésie française", "French Polynesia", 'XPF'],
  ['PR', "Porto Rico", "Puerto Rico", 'USD'],
  ['PT', "Portugal", "Portugal", 'EUR'],
  ['QA', "Qatar", "Qatar", 'QAR'],
  ['HK', "R.A.S. chinoise de Hong Kong", "Hong Kong SAR China", 'HKD'],
  ['MO', "R.A.S. chinoise de Macao", "Macao SAR China", 'MOP'],
  ['CF', "République centrafricaine", "Central African Republic", 'XAF'],
  ['DO', "République dominicaine", "Dominican Republic", 'DOP'],
  ['RO', "Roumanie", "Romania", 'RON'],
  ['GB', "Royaume-Uni", "United Kingdom", 'GBP'],
  ['RU', "Russie", "Russia", 'RUB'],
  ['RW', "Rwanda", "Rwanda", 'RWF'],
  ['EH', "Sahara occidental", "Western Sahara", 'MAD'],
  ['BL', "Saint-Barthélemy", "St. Barthélemy", 'EUR'],
  ['KN', "Saint-Christophe-et-Niévès", "St. Kitts & Nevis", 'XCD'],
  ['SM', "Saint-Marin", "San Marino", 'EUR'],
  ['MF', "Saint-Martin", "St. Martin", 'EUR'],
  ['SX', "Saint-Martin (partie néerlandaise)", "Sint Maarten", 'XCG'],
  ['PM', "Saint-Pierre-et-Miquelon", "St. Pierre & Miquelon", 'EUR'],
  ['VC', "Saint-Vincent-et-les Grenadines", "St. Vincent & Grenadines", 'XCD'],
  ['SH', "Sainte-Hélène", "St. Helena", 'SHP'],
  ['LC', "Sainte-Lucie", "St. Lucia", 'XCD'],
  ['SV', "Salvador", "El Salvador", 'USD'],
  ['WS', "Samoa", "Samoa", 'WST'],
  ['AS', "Samoa américaines", "American Samoa", 'USD'],
  ['ST', "Sao Tomé-et-Principe", "São Tomé & Príncipe", 'STN'],
  ['SN', "Sénégal", "Senegal", 'XOF'],
  ['RS', "Serbie", "Serbia", 'RSD'],
  ['SC', "Seychelles", "Seychelles", 'SCR'],
  ['SL', "Sierra Leone", "Sierra Leone", 'SLE'],
  ['SG', "Singapour", "Singapore", 'SGD'],
  ['SK', "Slovaquie", "Slovakia", 'EUR'],
  ['SI', "Slovénie", "Slovenia", 'EUR'],
  ['SO', "Somalie", "Somalia", 'SOS'],
  ['SD', "Soudan", "Sudan", 'SDG'],
  ['SS', "Soudan du Sud", "South Sudan", 'SSP'],
  ['LK', "Sri Lanka", "Sri Lanka", 'LKR'],
  ['SE', "Suède", "Sweden", 'SEK'],
  ['CH', "Suisse", "Switzerland", 'CHF'],
  ['SR', "Suriname", "Suriname", 'SRD'],
  ['SJ', "Svalbard et Jan Mayen", "Svalbard & Jan Mayen", 'NOK'],
  ['SY', "Syrie", "Syria", 'SYP'],
  ['TJ', "Tadjikistan", "Tajikistan", 'TJS'],
  ['TW', "Taïwan", "Taiwan", 'TWD'],
  ['TZ', "Tanzanie", "Tanzania", 'TZS'],
  ['TD', "Tchad", "Chad", 'XAF'],
  ['CZ', "Tchéquie", "Czechia", 'CZK'],
  ['TF', "Terres australes françaises", "French Southern Territories", 'EUR'],
  ['IO', "Territoire britannique de l’océan Indien", "British Indian Ocean Territory", 'USD'],
  ['PS', "Territoires palestiniens", "Palestinian Territories", 'ILS'],
  ['TH', "Thaïlande", "Thailand", 'THB'],
  ['TL', "Timor oriental", "Timor-Leste", 'USD'],
  ['TG', "Togo", "Togo", 'XOF'],
  ['TK', "Tokelau", "Tokelau", 'NZD'],
  ['TO', "Tonga", "Tonga", 'TOP'],
  ['TT', "Trinité-et-Tobago", "Trinidad & Tobago", 'TTD'],
  ['TN', "Tunisie", "Tunisia", 'TND'],
  ['TM', "Turkménistan", "Turkmenistan", 'TMT'],
  ['TR', "Turquie", "Türkiye", 'TRY'],
  ['TV', "Tuvalu", "Tuvalu", 'AUD'],
  ['UA', "Ukraine", "Ukraine", 'UAH'],
  ['UY', "Uruguay", "Uruguay", 'UYU'],
  ['VU', "Vanuatu", "Vanuatu", 'VUV'],
  ['VE', "Venezuela", "Venezuela", 'VES'],
  ['VN', "Viêt Nam", "Vietnam", 'VND'],
  ['WF', "Wallis-et-Futuna", "Wallis & Futuna", 'XPF'],
  ['YE', "Yémen", "Yemen", 'YER'],
  ['ZM', "Zambie", "Zambia", 'ZMW'],
  ['ZW', "Zimbabwe", "Zimbabwe", 'ZWG'],
];

export const COUNTRIES: readonly Country[] = ROWS.map(([code, fr, en, currency]) => ({ code, fr, en, currency }));

export const COUNTRY_CODES = COUNTRIES.map((country) => country.code) as [string, ...string[]];

const BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]));

export function findCountry(code: string | null | undefined): Country | undefined {
  return code ? BY_CODE.get(code.toUpperCase()) : undefined;
}

export function isCountryCode(value: unknown): value is string {
  return typeof value === 'string' && BY_CODE.has(value);
}

export function countryName(code: string | null | undefined, language: 'fr' | 'en' = 'fr'): string {
  const country = findCountry(code);
  return country ? country[language] : (code ?? '');
}

/** Forme de recherche : minuscules, sans accents ni ponctuation (« Côte d’Ivoire » → « cote divoire »). */
export function searchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`\-.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Noms courants que la liste officielle n'emploie pas : « RDC », « USA », « Angleterre »… */
const ALIASES: Record<string, string[]> = {
  CD: ['RDC', 'RD Congo', 'Congo Kinshasa', 'Zaire'],
  CG: ['Congo Brazzaville', 'Congo'],
  CI: ['Ivory Coast', 'RCI'],
  US: ['USA', 'Etats Unis d Amerique', 'Amerique', 'America'],
  GB: ['Royaume Uni', 'UK', 'Angleterre', 'England', 'Ecosse', 'Scotland', 'Pays de Galles', 'Wales', 'Grande Bretagne'],
  AE: ['EAU', 'UAE', 'Emirats', 'Dubai', 'Abu Dhabi'],
  CF: ['RCA', 'Centrafrique'],
  NL: ['Hollande', 'Holland'],
  KR: ['Coree du Sud', 'South Korea'],
  KP: ['Coree du Nord', 'North Korea'],
  CZ: ['Republique tcheque', 'Czech Republic'],
  RU: ['Russie'],
  VA: ['Vatican'],
  MM: ['Birmanie', 'Burma'],
  SZ: ['Swaziland'],
  MK: ['Macedoine'],
  TL: ['Timor oriental', 'East Timor'],
  CV: ['Cap Vert', 'Cabo Verde'],
  TW: ['Taiwan'],
  PS: ['Palestine'],
};

const ALIAS_KEYS = new Map(Object.entries(ALIASES).map(([code, names]) => [code, names.map(searchKey)]));

/** Pays dont le nom (français ou anglais), un nom courant ou le code correspond à la saisie. Les débuts de nom passent en premier. */
export function searchCountries(query: string): Country[] {
  const key = searchKey(query);
  if (!key) return [...COUNTRIES];
  const starts: Country[] = [];
  const contains: Country[] = [];
  for (const country of COUNTRIES) {
    const names = [searchKey(country.fr), searchKey(country.en), ...(ALIAS_KEYS.get(country.code) ?? [])];
    if (country.code.toLowerCase() === key || names.some((name) => name.startsWith(key))) starts.push(country);
    else if (names.some((name) => name.includes(key))) contains.push(country);
  }
  return [...starts, ...contains];
}
