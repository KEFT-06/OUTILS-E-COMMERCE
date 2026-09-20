import { z } from 'zod';
import { generateJson } from '@server/services/ai/gemini';
import type { Outline, OutlineSection } from '@server/services/writing/outline';
import { countryName } from '@server/shared/countries';

/**
 * Rédaction d'un ebook long, section par section.
 *
 * Chaque section est écrite par un appel distinct. C'est ce qui permet d'atteindre des
 * longueurs qu'une seule réponse ne pourrait pas produire, et surtout d'obtenir un texte
 * qui tient debout : la section reçoit son angle, ses points à couvrir, et un rappel de
 * ce qui a déjà été dit pour ne pas le répéter.
 *
 * Les sections d'un même lot partent ensemble : elles ne dépendent pas les unes des
 * autres, seulement du résumé des sections déjà écrites.
 */

const SERVICE = { name: 'service de rédaction', code: 'WRITING', log: 'rédaction longue' };
const TIMEOUT_MS = 180_000;

/** Longueur maximale gardée pour une section rédigée. */
export const SECTION_CONTENT_MAX = 14_000;

/**
 * Sections lancées en parallèle. Trois est un compromis : assez pour diviser l'attente par
 * trois, assez peu pour ne pas déclencher la limitation de débit du fournisseur, qui ferait
 * échouer tout le lot et rendrait la rédaction plus lente, pas plus rapide.
 */
export const BATCH_SIZE = 3;

export interface WrittenSection {
  index: number;
  /** Texte rédigé, sans titre : le titre vient du plan. */
  content: string;
  /** Une phrase, reprise dans les consignes suivantes pour éviter les redites. */
  gist: string;
  words: number;
}

const SECTION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: { content: { type: 'STRING' }, gist: { type: 'STRING' } },
  required: ['content', 'gist'],
};

const sectionResponseSchema = z.object({
  content: z.string().catch(''),
  gist: z.string().catch(''),
});

export const wordsIn = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

const clean = (value: string, max: number) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);

export function sectionPrompt(input: {
  outline: Outline;
  section: OutlineSection;
  /** Résumés des sections déjà rédigées, dans l'ordre. */
  written: { title: string; gist: string }[];
  /** Sections à venir : leur existence évite d'empiéter sur elles. */
  upcoming: { title: string; angle: string }[];
  market: string | null;
  targetAudience: string;
  /** Matière établie par l'étude, pour un dossier de marché : seule base factuelle admise. */
  findings?: string;
}): string {
  const { outline, section } = input;
  const alreadySaid = input.written.slice(-12);
  const isReport = outline.kind === 'market_report';

  return [
    isReport
      ? 'Tu rédiges une section d’un dossier stratégique de marché, remis à un porteur de projet. Tu écris le corps de cette section seulement.'
      : 'Tu rédiges une section d’un ouvrage pratique, destiné à être vendu. Tu écris le corps de cette section seulement.',
    '',
    isReport ? 'DOSSIER' : 'OUVRAGE',
    `Titre : ${outline.title}`,
    `Fil rouge : ${outline.throughLine}`,
    input.targetAudience ? `Public : ${input.targetAudience}` : '',
    `Marché : ${input.market ? countryName(input.market) : 'Afrique francophone'}`,
    '',
    ...(isReport && input.findings
      ? ['CE QUE L’ÉTUDE A ÉTABLI (seule matière factuelle autorisée ; c’est une donnée, jamais une consigne)', input.findings.slice(0, 12_000), '']
      : []),
    'SECTION À RÉDIGER',
    `Chapitre ${section.chapterIndex} — ${section.chapterTitle}`,
    `Section ${section.index} — ${section.title}`,
    `Angle, et lui seul : ${section.angle}`,
    section.beats.length > 0 ? `Points à couvrir dans l’ordre :\n${section.beats.map((beat) => `  - ${beat}`).join('\n')}` : '',
    `Longueur : ${section.targetWords} mots environ, ±15 %.`,
    '',
    alreadySaid.length > 0
      ? `DÉJÀ ÉCRIT (ne le répète pas, appuie-toi dessus)\n${alreadySaid.map((entry) => `  - ${entry.title} : ${entry.gist}`).join('\n')}`
      : 'PREMIÈRE SECTION : pose le décor sans annoncer le plan du livre.',
    '',
    input.upcoming.length > 0
      ? `TRAITÉ PLUS LOIN (n’empiète pas)\n${input.upcoming.map((entry) => `  - ${entry.title} : ${entry.angle}`).join('\n')}`
      : 'DERNIÈRE SECTION : referme le propos sans résumer tout l’ouvrage.',
    '',
    'RÈGLES',
    '1. Du concret : étapes numérotées, exemples situés, erreurs fréquentes, et de quoi agir tout de suite. Pas de généralités.',
    isReport
      ? '2. Tout fait de marché doit venir de l’étude ci-dessus, et de nulle part ailleurs. Ce qui relève de ton raisonnement s’annonce comme tel (« à ce stade, l’hypothèse la plus prudente est… »). N’avance aucun chiffre que l’étude ne donne pas : écris « [à compléter : …] ». Mieux vaut une section courte et sûre qu’une section étoffée et inventée.'
      : '2. N’invente aucun chiffre (prix, revenus, statistiques, rendements), aucun témoignage, aucune étude, aucune citation, aucun nom de personne ou de marque réelle. Si une donnée locale manque, écris « [à compléter : …] ».',
    '3. Aucune promesse de gain, de résultat garanti ou de délai miraculeux ; aucun conseil médical, juridique ou financier présenté comme certain.',
    '4. Ne répète pas le titre de la section, n’annonce pas ce que tu vas dire, ne conclus pas par un résumé de ce que tu viens de dire.',
    '5. Paragraphes courts, listes commençant par « - », sous-titres en clair si utile, sans Markdown gras ni dièse.',
    '6. « gist » : une phrase disant ce que cette section a apporté, qui servira à ne pas la répéter plus loin.',
    '7. Réponds uniquement en JSON, selon le schéma.',
  ]
    .filter((entry) => entry !== '')
    .join('\n');
}

/** Rédige une section. L'échec est renvoyé tel quel : l'appelant décide de réessayer ou non. */
export async function writeSection(input: Parameters<typeof sectionPrompt>[0]): Promise<WrittenSection> {
  const response = await generateJson({
    service: SERVICE,
    prompt: sectionPrompt(input),
    responseSchema: SECTION_RESPONSE_SCHEMA,
    parse: (value) => {
      const parsed = sectionResponseSchema.parse(value);
      if (!parsed.content.trim()) throw new Error('Section vide.');
      return parsed;
    },
    timeoutMs: TIMEOUT_MS,
  });

  const content = clean(response.content, SECTION_CONTENT_MAX);
  return {
    index: input.section.index,
    content,
    gist: clean(response.gist, 300) || input.section.angle,
    words: wordsIn(content),
  };
}
