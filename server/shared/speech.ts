/**
 * Du texte écrit au texte lu : ce qu'un chapitre devient avant de partir à la synthèse vocale.
 * Fichier sans dépendance, partagé avec le navigateur (durée annoncée avant de lancer).
 *
 * Un chapitre est écrit pour l'œil : titres en dièses, gras, listes à puces, tableaux, liens. Lu
 * tel quel, la voix dirait « dièse dièse », épellerait une adresse, ou enchaînerait les lignes
 * d'une liste sans respirer. Ce module rend ce qu'un lecteur humain dirait à voix haute.
 */

/** Débit mesuré sur le vrai service le 11/10/2026, en français : 1 156 caractères lus en 71,7 s. */
export const SPEECH_CHARS_PER_SECOND = 16;

/**
 * Taille d'un passage envoyé d'un seul tenant. À 2 400 caractères, un passage dure environ
 * 2 min 30 et revient en moins d'une minute : plusieurs partent de front, et un passage refusé
 * se refait seul sans reprendre le chapitre.
 */
export const SPEECH_PASSAGE_CHARS = 2_400;

/** Durée de lecture estimée d'un texte, en secondes. */
export const speechSeconds = (text: string): number => Math.round(spokenText(text).length / SPEECH_CHARS_PER_SECOND);

/** Une ligne de tableau : ses cases, sans la ligne de tirets qui sépare l'en-tête. */
function tableRow(line: string): string | null {
  if (!/^\s*\|.*\|\s*$/.test(line)) return null;
  if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) return '';
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(', ');
}

const endsSentence = (text: string) => /[.!?…:;»"”)]$/.test(text);
const closed = (text: string) => (text && !endsSentence(text) ? `${text}.` : text);

/**
 * Le texte tel qu'il se lit à voix haute. Fonction pure.
 *
 * Les titres et les éléments de liste deviennent des phrases (un point les termine, la voix
 * marque la pause) ; le gras, l'italique, le code et les dièses disparaissent ; d'un lien il ne
 * reste que son texte, et une adresse nue n'est pas lue — personne ne la note à l'oreille.
 */
export function spokenText(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    const row = tableRow(raw);
    if (row !== null) {
      if (row) out.push(closed(row));
      continue;
    }
    let line = raw
      // Images, puis liens : on garde le texte, pas l'adresse.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '')
      .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[\s(«“"'’])[*_]([^*_\n]+)[*_](?=$|[\s.,;:!?)»”"'’])/g, '$1$2')
      .replace(/^\s{0,3}>\s?/, '')
      .trim();
    if (!line || /^([-*_=~])\1{2,}$/.test(line)) {
      out.push('');
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const item = /^(?:[-*+•]|\d{1,2}[.)])\s+(.*)$/.exec(line);
    if (heading) line = closed(heading[1]!.replace(/#+\s*$/, '').trim());
    else if (item) line = closed(item[1]!.trim());
    out.push(line.replace(/\s+/g, ' '));
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Coupe un texte lu en passages d'au plus `max` caractères, entre deux paragraphes d'abord, entre
 * deux phrases sinon. Fonction pure : aucun mot n'est perdu, aucun n'est répété.
 */
export function splitForSpeech(text: string, max = SPEECH_PASSAGE_CHARS): string[] {
  const passages: string[] = [];
  let current = '';
  const push = (piece: string) => {
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length <= max) {
      current = candidate;
      return;
    }
    if (current) passages.push(current);
    current = piece;
  };

  for (const paragraph of text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)) {
    if (paragraph.length <= max) {
      push(paragraph);
      continue;
    }
    // Paragraphe plus long qu'un passage : il se coupe à la fin d'une phrase, à défaut sur une espace.
    let rest = paragraph;
    while (rest.length > max) {
      const window = rest.slice(0, max + 1);
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '), window.lastIndexOf('… '), window.lastIndexOf('.\n'));
      const space = window.lastIndexOf(' ');
      const at = sentence > max / 3 ? sentence + 1 : space > max / 3 ? space : max;
      push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) push(rest);
  }
  if (current) passages.push(current);
  return passages;
}
