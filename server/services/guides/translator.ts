import { z } from 'zod';
import { generateJson } from '@server/services/ai/gemini';
import type { GuideSection } from '@server/shared/guides';
import { findLanguage } from '@server/shared/languages';

/**
 * Traduction des guides par Gemini.
 *
 * Le guide est envoyé par lots de sections, avec leurs identifiants : la réponse,
 * en JSON structuré, se recolle section par section, et une section oubliée par le
 * modèle reste vide, donc signalée par les contrôles automatiques.
 */

const TIMEOUT_MS = 180_000;
const BATCH_CHARACTERS = 12_000;

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

export async function translateGuide(input: {
  title: string;
  sections: readonly GuideSection[];
  from: string;
  to: string;
  terms: readonly string[];
}): Promise<{ title: string; sections: GuideSection[] }> {
  let title = '';
  const translated = new Map<string, GuideSection>();

  for (const [index, batch] of batchesOf(input.sections).entries()) {
    const withTitle = index === 0;
    const source = { ...(withTitle ? { title: input.title } : {}), sections: batch };
    const result = await generateJson({
      service: SERVICE,
      prompt: `${translationInstructions({ from: input.from, to: input.to, terms: input.terms, withTitle })}\n\nSOURCE (JSON):\n${JSON.stringify(source)}`,
      responseSchema: RESPONSE_SCHEMA,
      parse: (value) => responseSchema.parse(value),
      timeoutMs: TIMEOUT_MS,
    });
    if (withTitle) title = result.title?.trim() ?? '';
    const expected = new Set(batch.map((section) => section.id));
    for (const section of result.sections) {
      if (expected.has(section.id)) translated.set(section.id, { id: section.id, heading: section.heading.trim(), body: section.body.trim() });
    }
  }

  return {
    title,
    sections: input.sections.map((section) => translated.get(section.id) ?? { id: section.id, heading: '', body: '' }),
  };
}
