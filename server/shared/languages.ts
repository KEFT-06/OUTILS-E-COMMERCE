/**
 * Langues des guides multilingues.
 *
 * Les 10 langues les plus parlées au monde passent en tête, dans l'ordre du
 * classement Ethnologue 2025 (locuteurs natifs et seconde langue confondus).
 * Suivent d'autres langues utiles aux marchés du site, dont plusieurs langues
 * africaines. Module pur, partagé avec le site.
 */

export interface Language {
  /** Code BCP 47, posé sur le texte traduit (attribut `lang`). */
  code: string;
  fr: string;
  /** Nom de la langue dans la langue elle-même. */
  native: string;
  /** Nom anglais, pour la consigne envoyée au modèle de traduction. */
  en: string;
  /** Rang parmi les 10 langues les plus parlées au monde ; null au-delà. */
  rank: number | null;
  direction: 'ltr' | 'rtl';
}

export const LANGUAGE_RANKING_SOURCE =
  'Classement Ethnologue, 28ᵉ édition (2025), locuteurs natifs et seconde langue confondus.';

const language = (code: string, fr: string, native: string, en: string, rank: number | null = null, direction: 'ltr' | 'rtl' = 'ltr'): Language => ({
  code,
  fr,
  native,
  en,
  rank,
  direction,
});

export const LANGUAGES: readonly Language[] = [
  language('en', 'Anglais', 'English', 'English', 1),
  language('zh', 'Chinois mandarin', '中文', 'Simplified Chinese (Mandarin)', 2),
  language('hi', 'Hindi', 'हिन्दी', 'Hindi', 3),
  language('es', 'Espagnol', 'Español', 'Spanish', 4),
  language('ar', 'Arabe', 'العربية', 'Modern Standard Arabic', 5, 'rtl'),
  language('fr', 'Français', 'Français', 'French', 6),
  language('bn', 'Bengali', 'বাংলা', 'Bengali', 7),
  language('pt', 'Portugais', 'Português', 'Portuguese', 8),
  language('ru', 'Russe', 'Русский', 'Russian', 9),
  language('id', 'Indonésien', 'Bahasa Indonesia', 'Indonesian', 10),

  language('ur', 'Ourdou', 'اردو', 'Urdu', null, 'rtl'),
  language('de', 'Allemand', 'Deutsch', 'German'),
  language('ja', 'Japonais', '日本語', 'Japanese'),
  language('tr', 'Turc', 'Türkçe', 'Turkish'),
  language('vi', 'Vietnamien', 'Tiếng Việt', 'Vietnamese'),
  language('ko', 'Coréen', '한국어', 'Korean'),
  language('it', 'Italien', 'Italiano', 'Italian'),
  language('fa', 'Persan', 'فارسی', 'Persian (Farsi)', null, 'rtl'),
  language('sw', 'Swahili', 'Kiswahili', 'Swahili'),
  language('ha', 'Haoussa', 'Hausa', 'Hausa'),
  language('yo', 'Yoruba', 'Yorùbá', 'Yoruba'),
  language('ig', 'Igbo', 'Igbo', 'Igbo'),
  language('am', 'Amharique', 'አማርኛ', 'Amharic'),
  language('ln', 'Lingala', 'Lingála', 'Lingala'),
  language('wo', 'Wolof', 'Wolof', 'Wolof'),
  language('ff', 'Peul', 'Fulfulde', 'Fula (Fulfulde)'),
  language('nl', 'Néerlandais', 'Nederlands', 'Dutch'),
  language('pl', 'Polonais', 'Polski', 'Polish'),
  language('th', 'Thaï', 'ไทย', 'Thai'),
  language('ms', 'Malais', 'Bahasa Melayu', 'Malay'),
];

export const LANGUAGE_CODES: readonly string[] = LANGUAGES.map((entry) => entry.code);

/** Les 10 langues les plus parlées, dans l'ordre du classement. */
export const TOP_LANGUAGES: readonly Language[] = LANGUAGES.filter((entry) => entry.rank !== null);

export function findLanguage(code: string | null | undefined): Language | undefined {
  return code ? LANGUAGES.find((entry) => entry.code === code) : undefined;
}

export function isLanguageCode(value: string): boolean {
  return LANGUAGE_CODES.includes(value);
}

export function languageName(code: string): string {
  return findLanguage(code)?.fr ?? code;
}

/**
 * Langues proposées pour une vidéo : celle de la voix, et celle de tout ce qui s'y dit.
 *
 * Liste volontairement plus courte que celle des traductions. Un texte traduit se relit ; une voix
 * mal prononcée ne se corrige pas, et la vidéo est déjà payée. Seules figurent les grandes langues,
 * le français d'abord puisque c'est celle de la plupart des auteurs du site.
 */
export const VIDEO_LANGUAGE_CODES = ['fr', 'en', 'es', 'pt', 'ar', 'de', 'it', 'hi', 'zh', 'ru', 'id'] as const;

export type VideoLanguageCode = (typeof VIDEO_LANGUAGE_CODES)[number];

export const VIDEO_LANGUAGES: readonly Language[] = VIDEO_LANGUAGE_CODES.map((code) => findLanguage(code)!);

export function isVideoLanguage(value: unknown): value is VideoLanguageCode {
  return typeof value === 'string' && (VIDEO_LANGUAGE_CODES as readonly string[]).includes(value);
}
