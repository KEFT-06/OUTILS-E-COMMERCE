/**
 * Lecture du Markdown des rapports rédigés, en blocs et en segments de texte.
 *
 * Volontairement réduit à ce que le rédacteur produit (titres, paragraphes, listes, citations,
 * tableaux, gras, italique, renvois [n]) et sans aucun HTML : l'écran construit ses éléments
 * à partir de ces blocs, jamais par injection de balises. Le même découpage sert au PDF.
 */

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'rule' };

export type InlineSegment =
  | { type: 'text'; text: string; bold?: boolean; italic?: boolean }
  | { type: 'citation'; id: number };

const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3 | 4, text: heading[2]! });
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
      continue;
    }

    if (TABLE_ROW.test(line) && TABLE_SEPARATOR.test(lines[index + 1] ?? '')) {
      flush();
      const header = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW.test(lines[index]!)) {
        rows.push(cells(lines[index]!));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      flush();
      const isOrdered = Boolean(ordered);
      const pattern = isOrdered ? ORDERED : BULLET;
      const items: string[] = [(bullet ?? ordered)![1]!.trim()];
      while (index + 1 < lines.length) {
        const next = lines[index + 1]!;
        const item = pattern.exec(next);
        if (item) {
          items.push(item[1]!.trim());
        } else if (next.trim() && /^\s{2,}\S/.test(next) && !BULLET.test(next) && !ORDERED.test(next)) {
          // Suite d'un élément sur la ligne suivante, indentée.
          items[items.length - 1] = `${items[items.length - 1]} ${next.trim()}`;
        } else break;
        index += 1;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const parts = [quote[1]!.trim()];
      while (index + 1 < lines.length && QUOTE.test(lines[index + 1]!)) {
        parts.push(QUOTE.exec(lines[index + 1]!)![1]!.trim());
        index += 1;
      }
      blocks.push({ type: 'quote', text: parts.join(' ').trim() });
      continue;
    }

    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

const INLINE = /\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)(.+?)\*|_(?!\s)(.+?)_(?![\p{L}\d])|\[(\d{1,3})\]|`([^`]+)`|\[([^\]]+)\]\((?:[^)\s]+)\)/gu;

/** Découpe une ligne en segments : texte (gras, italique) et renvois vers la bibliographie. */
export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ type: 'text', text: text.slice(last, start) });
    const [, bold1, bold2, italic1, italic2, citation, code, linkText] = match;
    if (bold1 ?? bold2) segments.push({ type: 'text', text: (bold1 ?? bold2)!, bold: true });
    else if (italic1 ?? italic2) segments.push({ type: 'text', text: (italic1 ?? italic2)!, italic: true });
    else if (citation) segments.push({ type: 'citation', id: Number(citation) });
    else if (code) segments.push({ type: 'text', text: code });
    // Un lien écrit par le rédacteur garde son texte, pas son adresse : les sites sont en annexe.
    else if (linkText) segments.push({ type: 'text', text: linkText });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return segments;
}

/** Texte brut d'une ligne : marques retirées, renvois gardés sous la forme [n]. */
export function plainInline(text: string): string {
  return parseInline(text)
    .map((segment) => (segment.type === 'citation' ? `[${segment.id}]` : segment.text))
    .join('');
}
