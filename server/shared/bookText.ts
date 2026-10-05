/**
 * Structure d'un texte d'ouvrage — commune au serveur (rédaction) et au navigateur (lecture à
 * l'écran, PDF, DOCX).
 *
 * Le premier ebook sorti du site (04/10/2026) se lisait comme un brouillon : les titres de
 * section et les sous-titres étaient des lignes ordinaires, perdues au milieu du texte ; des
 * listes entières tenaient dans un seul paragraphe de quarante lignes (« … 1. Passer du contexte…
 * 2. Passer de l'observation… - Gardez la fiche… ») ; rien n'était en gras. Un livre se compose de
 * titres, de sous-titres, de paragraphes et de listes : c'est cette structure que ce module lit
 * dans le texte, pour que chaque rendu la respecte de la même façon.
 *
 * Écriture attendue du rédacteur, volontairement minimale :
 *   « ## Titre de section » · « ### Sous-titre » · « - élément de liste » · « 1. étape »
 *   et une ligne vide entre deux paragraphes.
 * Un texte écrit avant cette règle est lu avec tolérance : un sous-titre resté en clair est
 * reconnu à sa forme, et une liste écrasée dans un paragraphe est redécoupée.
 */

export type BookBlock =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  /** Paragraphe ; un retour à la ligne simple y est gardé (deux phrases qui vont ensemble). */
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] };

const BULLET = /^\s*[-•*]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,2})[.)]\s+(.*)$/;
const MARKED_HEADING = /^\s*(#{1,6})\s+(.*)$/;
const BOLD_LINE = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/;

/** Signes de mise en forme laissés par le rédacteur malgré la consigne : retirés, le texte reste. */
const stripInline = (text: string) => text.replace(/\*\*|__|`/g, '').replace(/[ \t]{2,}/g, ' ').trim();

/**
 * Une ligne seule dans son bloc, courte et sans ponctuation finale, est un sous-titre resté en
 * clair. Une ligne qui finit par « : » annonce une liste, ce n'est pas un titre.
 */
function looksLikeHeading(line: string): boolean {
  const text = line.trim();
  if (text.length < 3 || text.length > 110) return false;
  if (/[.!?;,:…»"”)]$/.test(text)) return false;
  if (BULLET.test(text) || NUMBERED.test(text)) return false;
  if (text.split(/\s+/).length > 16) return false;
  return /^[A-ZÀ-ÖØ-Þ0-9«]/.test(text);
}

/**
 * Redécoupe un paragraphe où une liste a été écrasée : « … règles : - Reformulez… - Observez… »
 * ou « … 1. Passer… 2. Passer… ». Sans effet sur un paragraphe ordinaire.
 */
function unflatten(paragraph: string): string {
  if (paragraph.length < 400 || paragraph.includes('\n')) return paragraph;
  let text = paragraph;

  // Étapes numérotées : seulement si elles se suivent à partir de 1, pour ne pas couper « en 2024. 3 personnes ».
  const numbers = [...text.matchAll(/(?:^|[.:!?»”"]\s)(\d{1,2})\.\s(?=[A-ZÀ-ÖØ-Þ«])/g)].map((match) => Number(match[1]));
  const sequential = numbers.length >= 2 && numbers.every((value, index) => value === index + 1);
  if (sequential) text = text.replace(/([.:!?»”"])\s(\d{1,2})\.\s(?=[A-ZÀ-ÖØ-Þ«])/g, (_, end: string, n: string) => `${end}\n${n}. `);

  const bullets = text.match(/[.:!?»”"]\s-\s(?=[A-ZÀ-ÖØ-Þ«])/g) ?? [];
  if (bullets.length >= 2) text = text.replace(/([.:!?»”"])\s-\s(?=[A-ZÀ-ÖØ-Þ«])/g, (_, end: string) => `${end}\n- `);

  // La phrase qui annonce une liste (« Pour conserver cette posture : ») ouvre sa propre ligne,
  // au lieu de rester collée à la fin de l'élément ou de la phrase qui la précède.
  return text.replace(/([.!?»”"])\s([A-ZÀ-ÖØ-Þ][^.!?\n]{8,180}:)\n(?=-\s|1\.\s)/g, (_, end: string, intro: string) => `${end}\n${intro}\n`);
}

/** Lit un texte d'ouvrage et rend ses blocs, dans l'ordre. Fonction pure. */
export function parseBookText(raw: string): BookBlock[] {
  const groups = raw
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((group) => unflatten(group.trim()))
    .filter(Boolean);

  const blocks: BookBlock[] = [];
  for (const group of groups) {
    const lines = group.split('\n').map((line) => line.trim()).filter(Boolean);
    let paragraph: string[] = [];
    let list: { type: 'ul' | 'ol'; items: string[] } | null = null;
    const flushParagraph = () => {
      if (paragraph.length > 0) blocks.push({ type: 'p', text: paragraph.join('\n') });
      paragraph = [];
    };
    const flushList = () => {
      if (list) blocks.push(list);
      list = null;
    };

    lines.forEach((line, index) => {
      const marked = MARKED_HEADING.exec(line);
      const bold = BOLD_LINE.exec(line);
      const bullet = BULLET.exec(line);
      const numbered = NUMBERED.exec(line);
      const alone = lines.length === 1;

      if (marked) {
        flushParagraph();
        flushList();
        blocks.push({ type: marked[1]!.length <= 2 ? 'h2' : 'h3', text: stripInline(marked[2]!) });
      } else if (bold && (alone || index === 0)) {
        flushParagraph();
        flushList();
        blocks.push({ type: 'h3', text: stripInline(bold[1]!) });
      } else if (bullet) {
        flushParagraph();
        if (list?.type !== 'ul') flushList();
        list = list ?? { type: 'ul', items: [] };
        list.items.push(stripInline(bullet[1]!));
      } else if (numbered) {
        flushParagraph();
        if (list?.type !== 'ol') flushList();
        list = list ?? { type: 'ol', items: [] };
        list.items.push(stripInline(numbered[2]!));
      } else if (alone && looksLikeHeading(line)) {
        blocks.push({ type: 'h3', text: stripInline(line) });
      } else {
        flushList();
        paragraph.push(stripInline(line));
      }
    });
    flushParagraph();
    flushList();
  }
  return blocks;
}

/**
 * Remet au propre un texte tout juste rédigé, avant de l'enregistrer : un titre mis en gras
 * devient un sous-titre, les signes de mise en forme parasites disparaissent, les lignes vides en
 * trop aussi. Le texte reste lisible tel quel dans un champ de saisie.
 */
export function normalizeBookText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const bold = BOLD_LINE.exec(line);
      if (bold) return `### ${stripInline(bold[1]!)}`;
      const marked = MARKED_HEADING.exec(line);
      if (marked) return `${marked[1]!.length <= 2 ? '##' : '###'} ${stripInline(marked[2]!)}`;
      return line.replace(/\*\*|__|`/g, '').replace(/[ \t]+$/g, '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Titres de section d'un texte, dans l'ordre : de quoi bâtir un sommaire à deux niveaux. */
export function sectionTitles(blocks: readonly BookBlock[]): string[] {
  return blocks.flatMap((block) => (block.type === 'h2' ? [block.text] : []));
}

/**
 * Consigne de mise en forme donnée au rédacteur, la même partout où un texte d'ouvrage est écrit
 * ou retouché.
 */
export const BOOK_FORMAT_RULE =
  'Mise en forme d’un livre publié : des paragraphes de 3 à 5 phrases, séparés par une ligne vide ; un sous-titre par idée nouvelle, seul sur sa ligne et précédé de « ### » — jamais de titre au milieu d’un paragraphe ; chaque énumération en liste, un élément par ligne précédé de « - » ; les étapes d’une procédure numérotées « 1. », « 2. », une par ligne. Aucun autre signe de mise en forme (ni gras, ni italique, ni tableau). Un français soigné d’un bout à l’autre : aucun mot anglais, aucune phrase sans verbe, aucune répétition de syllabe. Dans un modèle que le LECTEUR remplira lui-même (message type, fiche), note le champ entre parenthèses — (prénom), (lieu de la rencontre) — et jamais entre crochets.';
