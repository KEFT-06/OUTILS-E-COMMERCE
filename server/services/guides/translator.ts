import { z } from 'zod';
import { AppError } from '@server/middleware';
import { generateJson } from '@server/services/ai/gemini';
import type { GuideSection } from '@server/shared/guides';
import { findLanguage } from '@server/shared/languages';

/**
 * Traduction des guides par Gemini.
 *
 * Le guide est envoyé par lots de sections, avec leurs identifiants : la réponse,
 * en JSON structuré, se recolle section par section, et une section oubliée par le
 * modèle reste vide, donc signalée par les contrôles automatiques.
 *
 * UN GUIDE LONG SE TRADUIT PAR TRANCHES. Les lots partaient l'un après l'autre dans une seule
 * requête : un ouvrage de cent pages demandait dix minutes là où l'hébergeur en accorde cinq, et
 * l'écran refusait d'avance tout guide de plus de 120 000 caractères (« découpez-le en plusieurs
 * guides »). Les lots partent maintenant plusieurs à la fois, dans un temps borné ; ce qui n'a pas
 * tenu dans la tranche revient à la suivante, que l'écran demande de lui-même. La longueur du
 * guide n'est plus l'affaire de son auteur.
 */

/** Temps accordé à un lot : au-delà, il reviendra à la tranche suivante. */
const BATCH_TIMEOUT_MS = 150_000;
/**
 * Taille d'un lot. Mesuré sur le vrai service le 07/10/2026 : 2 100 caractères se traduisent en 13 s
 * avec le modèle de rédaction (le plus juste : « Selling Beignets Outside the School »), 3,6 s avec
 * le modèle léger. À 6 000 caractères, un lot aboutit en moins d'une minute — sous le délai où une
 * connexion mobile lâche — et quatre lots de front traduisent une centaine de pages par tranche.
 */
const BATCH_CHARACTERS = 6_000;
/** Lots traduits en même temps : assez pour avancer vite, pas assez pour épuiser le débit accordé. */
const CONCURRENCY = 4;
/** En deçà, on ne lance plus de lot : il n'aurait pas le temps d'aboutir. */
const MIN_BATCH_MS = 25_000;

const SERVICE = { name: 'service de traduction', code: 'TRANSLATION', log: 'traduction' };

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, heading: { type: 'STRING' }, body: { type: 'STRING' } },
        required: ['id', 'heading', 'body'],
      },
    },
  },
  required: ['sections'],
};

const responseSchema = z.object({
  title: z.string().optional(),
  sections: z.array(z.object({ id: z.string(), heading: z.string(), body: z.string() })),
});

function batchesOf(sections: readonly GuideSection[]): GuideSection[][] {
  const batches: GuideSection[][] = [];
  let current: GuideSection[] = [];
  let size = 0;
  for (const section of sections) {
    const length = section.heading.length + section.body.length;
    if (current.length > 0 && size + length > BATCH_CHARACTERS) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(section);
    size += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Consigne du traducteur. Fonction pure, testable sans appel réseau. */
export function translationInstructions(input: { from: string; to: string; terms: readonly string[]; withTitle: boolean }): string {
  const from = findLanguage(input.from)?.en ?? input.from;
  const to = findLanguage(input.to)?.en ?? input.to;
  return [
    'You are a professional translator and editor specialised in practical guides and e-books sold online.',
    `Translate from ${from} into ${to}.`,
    'Write natural, fluent text for native readers of the target language: adapt idioms and examples, keep the meaning, tone and level of detail. Do not summarise, shorten, add or omit anything.',
    'Keep every number, price, currency code, date, quantity, URL and e-mail address exactly as written, with Western Arabic digits (0-9).',
    input.terms.length > 0
      ? `Keep these names exactly as written, untranslated: ${input.terms.map((term) => `"${term}"`).join(', ')}.`
      : 'Keep brand, product and person names untranslated.',
    'Keep the Markdown formatting of the source (lists, bold, line breaks).',
    'Return JSON only, with the same section ids in the same order. Translate every heading and body; an empty field stays empty.',
    input.withTitle ? 'Also translate the guide title into "title".' : 'Leave "title" empty.',
  ].join('\n');
}

export interface TranslationSlice {
  /** Titre traduit, quand cette tranche le demandait et l'a obtenu. */
  title: string;
  /** Sections traduites par cette tranche, par identifiant. */
  sections: Map<string, GuideSection>;
  /** Toutes les sections demandées ont-elles été traduites ? */
  complete: boolean;
}

/**
 * Traduit autant de sections que le temps accordé le permet, plusieurs lots à la fois.
 *
 * `sections` : celles qui restent à traduire. Un lot refusé n'efface pas ceux qui ont abouti : la
 * tranche rend ce qu'elle a, et dit qu'elle n'est pas complète. Si RIEN n'a abouti, le refus du
 * service remonte tel quel — c'est lui qui dit quoi faire (points rendus, service indisponible).
 */
export async function translateSlice(input: {
  title: string;
  /** Demander aussi le titre du guide (première tranche, ou titre encore manquant). */
  withTitle: boolean;
  sections: readonly GuideSection[];
  from: string;
  to: string;
  terms: readonly string[];
  budgetMs: number;
}): Promise<TranslationSlice> {
  const deadline = Date.now() + input.budgetMs;
  const batches = batchesOf(input.sections);
  const translated = new Map<string, GuideSection>();
  let title = '';
  let firstFailure: unknown = null;

  const translateBatch = async (batch: GuideSection[], withTitle: boolean) => {
    const source = { ...(withTitle ? { title: input.title } : {}), sections: batch };
    const result = await generateJson({
      service: SERVICE,
      prompt: `${translationInstructions({ from: input.from, to: input.to, terms: input.terms, withTitle })}\n\nSOURCE (JSON):\n${JSON.stringify(source)}`,
      responseSchema: RESPONSE_SCHEMA,
      parse: (value) => responseSchema.parse(value),
      timeoutMs: Math.min(BATCH_TIMEOUT_MS, Math.max(MIN_BATCH_MS, deadline - Date.now())),
    });
    if (withTitle) title = result.title?.trim() ?? '';
    const expected = new Set(batch.map((section) => section.id));
    for (const section of result.sections) {
      if (expected.has(section.id)) translated.set(section.id, { id: section.id, heading: section.heading.trim(), body: section.body.trim() });
    }
  };

  for (let start = 0; start < batches.length; start += CONCURRENCY) {
    if (start > 0 && deadline - Date.now() < MIN_BATCH_MS) break;
    const group = batches.slice(start, start + CONCURRENCY);
    const outcomes = await Promise.allSettled(group.map((batch, offset) => translateBatch(batch, input.withTitle && start + offset === 0)));
    const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    if (failure) {
      firstFailure ??= failure.reason;
      // Un refus n'est pas un hasard de lot : inutile d'en lancer d'autres dans cette tranche.
      break;
    }
  }

  if (translated.size === 0 && firstFailure) {
    if (firstFailure instanceof AppError) throw firstFailure;
    throw new AppError(502, `Le ${SERVICE.name} n’a pas pu aboutir. Vos points ont été rendus.`, `${SERVICE.code}_FAILED`);
  }
  // Une section sans texte n'attend rien : elle est « traduite » dès qu'elle est vue.
  const attendues = input.sections.filter((section) => section.heading.trim() || section.body.trim());
  return { title, sections: translated, complete: attendues.every((section) => translated.has(section.id)) };
}

/** Traduction d'un guide entier, d'une traite. Reste pour les guides courts et pour les tests. */
export async function translateGuide(input: {
  title: string;
  sections: readonly GuideSection[];
  from: string;
  to: string;
  terms: readonly string[];
}): Promise<{ title: string; sections: GuideSection[] }> {
  const slice = await translateSlice({ ...input, withTitle: true, budgetMs: 15 * 60_000 });
  return {
    title: slice.title,
    sections: input.sections.map((section) => slice.sections.get(section.id) ?? { id: section.id, heading: '', body: '' }),
  };
}
