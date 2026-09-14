import { safeHttpsUrl } from '@/shared/lib/safeUrl';

/**
 * Liens de campagne UTM — Lot 6, affiliation.
 *
 * Paramètres reconnus par Google Analytics, d'après sa documentation consultée le
 * 14 septembre 2026 : `utm_source`, `utm_medium` et `utm_campaign` sont à toujours
 * renseigner ; `utm_id` et `utm_source_platform` sont recommandés ; `utm_term` et
 * `utm_content` sont facultatifs.
 */

export const UTM_DOCUMENTATION_URL = 'https://support.google.com/analytics/answer/10917952';

export interface UtmFields {
  source: string;
  medium: string;
  campaign: string;
  id: string;
  sourcePlatform: string;
  term: string;
  content: string;
}

export const EMPTY_UTM: UtmFields = {
  source: '',
  medium: '',
  campaign: '',
  id: '',
  sourcePlatform: '',
  term: '',
  content: '',
};

const PARAMETERS: readonly { key: keyof UtmFields; name: string; required: boolean }[] = [
  { key: 'source', name: 'utm_source', required: true },
  { key: 'medium', name: 'utm_medium', required: true },
  { key: 'campaign', name: 'utm_campaign', required: true },
  { key: 'id', name: 'utm_id', required: false },
  { key: 'sourcePlatform', name: 'utm_source_platform', required: false },
  { key: 'term', name: 'utm_term', required: false },
  { key: 'content', name: 'utm_content', required: false },
];

/**
 * Normalise une valeur : minuscules, sans accents, espaces remplacés par « _ ».
 *
 * Google Analytics distingue « Facebook » de « facebook » : sans convention
 * commune, une même source se retrouve éclatée en plusieurs lignes de rapport.
 */
export function normalizeUtmValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.-]/g, '');
}

export type UtmResult = { ok: true; url: string } | { ok: false; errors: string[] };

/**
 * Construit le lien de campagne. Les paramètres de l'adresse de départ qui ne
 * sont pas des UTM (par exemple un code de parrainage) sont conservés ; les
 * paramètres `utm_` déjà présents sont remplacés par ceux du formulaire.
 */
export function buildUtmUrl(baseUrl: string, fields: UtmFields): UtmResult {
  const errors: string[] = [];
  const base = safeHttpsUrl(baseUrl.trim());

  if (!base) errors.push("L'adresse de destination doit être un lien https valide.");
  for (const parameter of PARAMETERS) {
    if (parameter.required && !normalizeUtmValue(fields[parameter.key])) {
      errors.push(`Le paramètre ${parameter.name} est obligatoire.`);
    }
  }
  if (!base || errors.length > 0) return { ok: false, errors };

  const url = new URL(base);
  for (const parameter of PARAMETERS) {
    const value = normalizeUtmValue(fields[parameter.key]);
    if (value) {
      url.searchParams.set(parameter.name, value);
    } else {
      url.searchParams.delete(parameter.name);
    }
  }

  return { ok: true, url: url.toString() };
}

/** Un lien par code d'affilié : `utm_source` = code, `utm_medium` = affiliate. */
export function buildAffiliateLinks(
  baseUrl: string,
  fields: Omit<UtmFields, 'source' | 'medium'>,
  codes: string[],
): { code: string; result: UtmResult }[] {
  return codes
    .map((code) => code.trim())
    .filter(Boolean)
    .map((code) => ({
      code,
      result: buildUtmUrl(baseUrl, { ...fields, source: code, medium: 'affiliate' }),
    }));
}
