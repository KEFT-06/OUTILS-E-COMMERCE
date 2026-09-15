/**
 * Guides multilingues : sections, niveaux de relecture et contrôles automatiques.
 *
 * Module pur, partagé avec le site : l'écran annonce les mêmes problèmes que le
 * serveur vérifie avant de valider une traduction.
 */

export interface GuideSection {
  id: string;
  heading: string;
  body: string;
}

export const GUIDE_LIMITS = {
  titleMax: 200,
  sectionsMax: 60,
  headingMax: 300,
  bodyMax: 20_000,
  /** Taille totale d'un guide, en caractères (environ 20 000 mots). */
  totalMax: 120_000,
  /** Guides par compte. */
  guidesMax: 200,
} as const;

/**
 * Trois niveaux de relecture. C : traduit par l'IA puis contrôlé automatiquement ;
 * B : relu et validé par l'auteur ; A : relu par un locuteur natif.
 */
export type ReviewLevel = 'A' | 'B' | 'C';

export const REVIEW_LEVELS: Record<ReviewLevel, { name: string; short: string; description: string; exportNotice: string }> = {
  C: {
    name: 'Niveau C',
    short: 'Traduit par IA, contrôlé',
    description:
      'Traduction automatique, puis contrôles automatiques : aucune section oubliée, chiffres, prix, liens et noms de marque conservés.',
    exportNotice: 'Traduction automatique contrôlée, pas encore relue par un humain.',
  },
  B: {
    name: 'Niveau B',
    short: 'Relu par l’auteur',
    description: 'Vous, ou une personne bilingue de votre équipe, relisez chaque section à côté de l’original, corrigez, puis validez.',
    exportNotice: 'Traduction relue et validée par l’auteur.',
  },
  A: {
    name: 'Niveau A',
    short: 'Relu par un locuteur natif',
    description:
      'Un relecteur dont c’est la langue maternelle corrige tournures, références culturelles et ton. Conseillé pour un produit vendu.',
    exportNotice: 'Traduction relue par un locuteur natif.',
  },
};

export type TranslationStatus = 'ready' | 'review_requested' | 'in_review';

export interface TranslationCheck {
  severity: 'error' | 'warning';
  code: 'MISSING_TITLE' | 'MISSING_SECTION' | 'EMPTY_SECTION' | 'NUMBERS' | 'LINKS' | 'TERMS' | 'UNTRANSLATED' | 'LENGTH';
  message: string;
  sectionId?: string;
}

export function reviewLevelOf(translation: { reviewedAt: string | Date | null; authorValidatedAt: string | Date | null }): ReviewLevel {
  if (translation.reviewedAt) return 'A';
  if (translation.authorValidatedAt) return 'B';
  return 'C';
}

export function hasBlockingIssues(checks: readonly TranslationCheck[]): boolean {
  return checks.some((check) => check.severity === 'error');
}

export function guideCharacters(guide: { title: string; sections: readonly GuideSection[] }): number {
  return guide.title.length + guide.sections.reduce((total, section) => total + section.heading.length + section.body.length, 0);
}

export function wordCount(sections: readonly GuideSection[]): number {
  return sections.reduce((total, section) => total + `${section.heading} ${section.body}`.split(/\s+/).filter(Boolean).length, 0);
}

/**
 * Découpe un texte collé en sections : chaque titre Markdown (#, ## ou ###) ouvre
 * une section. Un texte sans titre donne une seule section.
 */
export function parseGuideText(text: string, newId: () => string): GuideSection[] {
  const sections: GuideSection[] = [];
  let heading = '';
  let lines: string[] = [];

  const flush = () => {
    const body = lines.join('\n').trim();
    if (heading.trim() || body) sections.push({ id: newId(), heading: heading.trim(), body });
    lines = [];
  };

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const match = /^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      flush();
      heading = match[1]!;
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

/* -------------------------------------------------------------------------- */
/*  Contrôles automatiques                                                     */
/* -------------------------------------------------------------------------- */

/** Chiffres arabes-indiens, persans, devanagari, bengalis et pleine chasse ramenés à 0-9. */
const DIGIT_BLOCKS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0xff10];

function asciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹०-९০-৯０-９]/g, (char) => {
    const code = char.charCodeAt(0);
    const block = DIGIT_BLOCKS.find((start) => code >= start && code <= start + 9)!;
    return String(code - block);
  });
}

/**
 * Nombres d'un texte, séparateurs retirés : « 10 000 FCFA », « 10,000 » et
 * « ١٠٬٠٠٠ » donnent tous « 10000 ». Un séparateur ne compte que suivi de trois
 * chiffres, pour ne pas fusionner une liste « 1, 2, 3 ».
 */
function numbersOf(text: string): string[] {
  const matches = asciiDigits(text).match(/\d{1,3}(?:[ \u00a0\u202f.,\u066c]\d{3})+(?:[.,\u066b]\d+)?|\d+(?:[.,\u066b]\d+)?/g) ?? [];
  return matches.map((match) => match.replace(/\D/g, ''));
}

function linksOf(text: string): string[] {
  return text.match(/(?:https?:\/\/|www\.)[^\s)>\]"'«»]+|[\w.+-]+@[\w-]+\.[\w.]+/gi)?.map((link) => link.replace(/[.,;:!?]+$/, '')) ?? [];
}

/** Éléments de `expected` absents de `actual`, en tenant compte des répétitions. */
function missing(expected: string[], actual: string[]): string[] {
  const pool = new Map<string, number>();
  for (const item of actual) pool.set(item, (pool.get(item) ?? 0) + 1);
  const absent: string[] = [];
  for (const item of expected) {
    const left = pool.get(item) ?? 0;
    if (left > 0) pool.set(item, left - 1);
    else absent.push(item);
  }
  return [...new Set(absent)];
}

const COMPACT_SCRIPTS = new Set(['zh', 'ja', 'ko']);

export function checkTranslation(
  source: { title: string; sections: readonly GuideSection[] },
  translation: { title: string; sections: readonly GuideSection[] },
  options: { language: string; terms?: readonly string[] } = { language: '' },
): TranslationCheck[] {
  const checks: TranslationCheck[] = [];
  const byId = new Map(translation.sections.map((section) => [section.id, section]));

  if (source.title.trim() && !translation.title.trim()) {
    checks.push({ severity: 'error', code: 'MISSING_TITLE', message: 'Le titre du guide n’est pas traduit.' });
  }

  source.sections.forEach((original, index) => {
    const label = original.heading.trim() ? `« ${original.heading.trim().slice(0, 60)} »` : `n° ${index + 1}`;
    const translated = byId.get(original.id);
    if (!translated) {
      checks.push({ severity: 'error', code: 'MISSING_SECTION', sectionId: original.id, message: `La section ${label} manque dans la traduction.` });
      return;
    }
    if ((original.body.trim() && !translated.body.trim()) || (original.heading.trim() && !translated.heading.trim())) {
      checks.push({ severity: 'error', code: 'EMPTY_SECTION', sectionId: original.id, message: `La section ${label} est vide dans la traduction.` });
      return;
    }

    const originalText = `${original.heading}\n${original.body}`;
    const translatedText = `${translated.heading}\n${translated.body}`;

    const absentNumbers = missing(numbersOf(originalText), numbersOf(translatedText));
    if (absentNumbers.length > 0) {
      checks.push({
        severity: 'warning',
        code: 'NUMBERS',
        sectionId: original.id,
        message: `Section ${label} : chiffres absents de la traduction (${absentNumbers.slice(0, 5).join(', ')}). Vérifiez prix, dates et quantités.`,
      });
    }

    const absentLinks = missing(linksOf(originalText), linksOf(translatedText));
    if (absentLinks.length > 0) {
      checks.push({
        severity: 'warning',
        code: 'LINKS',
        sectionId: original.id,
        message: `Section ${label} : lien ou adresse modifié (${absentLinks.slice(0, 3).join(', ')}).`,
      });
    }

    const absentTerms = (options.terms ?? []).filter((term) => term.trim() && originalText.includes(term) && !translatedText.includes(term));
    if (absentTerms.length > 0) {
      checks.push({
        severity: 'warning',
        code: 'TERMS',
        sectionId: original.id,
        message: `Section ${label} : nom à garder tel quel absent (${absentTerms.slice(0, 3).join(', ')}).`,
      });
    }

    if (original.body.trim().length > 40 && original.body.trim() === translated.body.trim()) {
      checks.push({ severity: 'warning', code: 'UNTRANSLATED', sectionId: original.id, message: `La section ${label} semble ne pas être traduite.` });
    } else if (original.body.length > 200) {
      const ratio = translated.body.length / original.body.length;
      const floor = COMPACT_SCRIPTS.has(options.language) ? 0.12 : 0.35;
      if (ratio < floor || ratio > 3) {
        checks.push({
          severity: 'warning',
          code: 'LENGTH',
          sectionId: original.id,
          message: `Section ${label} : longueur très différente de l’original. Un passage a peut-être été oublié ou ajouté.`,
        });
      }
    }
  });

  return checks;
}
