import { type BookBlock, parseBookText, sectionTitles } from '@server/shared/bookText';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { DigitalProductIdea, MarketAnalysisReport } from '@/shared/types/analysis';
import { ComplianceSection } from '@/shared/types/compliance';

/**
 * Modèle de document neutre pour l'export d'un produit — feuille de route 3.3.
 *
 * PDF, DOCX et lecture à l'écran sont rendus à partir de CE modèle, et non chacun depuis le
 * produit : trois rendus qui lisent la donnée brute chacun à leur façon finissent par produire
 * trois documents différents pour le même ouvrage.
 *
 * LE DOCUMENT EST LE LIVRE DU CLIENT, ET RIEN D'AUTRE. Le premier ebook sorti du site
 * (04/10/2026) se terminait par quarante-sept « sources » qui étaient celles de l'étude de
 * marché — concurrents analysés compris —, par une page « Contrôles avant export » citant la
 * table de règles, portait « Version retouchée en mode Expert » sous son titre, la fiche de
 * l'aimant à prospects au milieu des chapitres, et une mention de Smart Creator au pied de chaque
 * page. Rien de cela n'appartient au lecteur qui achète l'ouvrage : les contrôles restent à
 * l'écran, l'étude reste dans l'Analyse, et le livre ne porte que le nom de son auteur.
 */

/** Ancre de la note de source (ouvrage tiré d'une vidéo). Compatible Word : lettres, chiffres, soulignés. */
export const SOURCE_ANCHOR = 'chap_source';
export const SOURCE_TITLE = 'Source';
export const INTRODUCTION_TITLE = 'Introduction';
export const EMPTY_CHAPTER_NOTICE = 'Contenu à rédiger.';

export interface DocumentChapter {
  /** Identifiant stable, cible des liens du sommaire. */
  anchor: string;
  /** « Module 3 » ; vide pour l'introduction. */
  label: string;
  title: string;
  /** Titres, sous-titres, paragraphes et listes, dans l'ordre de lecture. */
  blocks: BookBlock[];
  /** Texte brut du chapitre, soumis aux contrôles de conformité et d'originalité. */
  paragraphs: string[];
}

export interface BibliographyEntry {
  kind: string;
  label: string;
  detail?: string;
  /** Toujours passée par `safeHttpUrl` avant d'arriver ici. */
  url?: string;
}

export interface ProductDocument {
  title: string;
  subtitle: string;
  typeName: string;
  chapters: DocumentChapter[];
  /** Vidéo dont l'ouvrage est tiré, quand c'est le cas : la seule source qui regarde le lecteur. */
  bibliography: BibliographyEntry[];
}

export interface TocEntry {
  anchor: string;
  title: string;
  /** 1 : chapitre ; 2 : section du chapitre. */
  level: 1 | 2;
}

function nonEmpty(value: string | undefined): value is string {
  return Boolean(value && value.trim());
}

/** Titre complet d'un chapitre, tel qu'il se lit au sommaire. */
export const chapterHeading = (chapter: Pick<DocumentChapter, 'label' | 'title'>) =>
  chapter.label ? `${chapter.label} — ${chapter.title}` : chapter.title;

/** Ancre de la section `index` (à partir de 0) d'un chapitre. */
export const sectionAnchor = (chapterAnchor: string, index: number) => `${chapterAnchor}_s${index + 1}`;

/**
 * @param _report rapport de la niche dont vient le produit. Gardé dans la signature pour les
 *        appelants ; l'ouvrage n'en reprend plus rien — l'étude de marché n'est pas son contenu.
 */
export function buildProductDocument(product: DigitalProductIdea, _report: MarketAnalysisReport | null = null): ProductDocument {
  const introduction = [
    product.transformationPromise,
    product.targetAudience ? `Cet ouvrage s’adresse à : ${product.targetAudience}` : undefined,
  ].filter(nonEmpty);

  const chapters: DocumentChapter[] = [
    ...(introduction.length > 0
      ? [
          {
            anchor: 'chap_introduction',
            label: '',
            title: INTRODUCTION_TITLE,
            blocks: introduction.map((text) => ({ type: 'p' as const, text })),
            paragraphs: introduction,
          },
        ]
      : []),
    // Ancres fondées sur la position, pas sur le numéro saisi : deux modules peuvent porter
    // le même numéro, pas la même ancre.
    ...product.tableOfContents.map((module, index) => ({
      anchor: `chap_module_${index + 1}`,
      label: `Module ${module.moduleNumber}`,
      title: module.title,
      blocks: parseBookText(module.details ?? ''),
      paragraphs: [module.details].filter(nonEmpty),
    })),
  ];

  const originUrl = product.origin?.kind === 'video' ? safeHttpUrl(product.origin.url) : null;
  const bibliography: BibliographyEntry[] =
    product.origin?.kind === 'video'
      ? [{ kind: 'Vidéo source', label: product.origin.label, ...(originUrl ? { url: originUrl } : {}) }]
      : [];

  return { title: product.title, subtitle: product.subtitle, typeName: product.typeName, chapters, bibliography };
}

/** Sommaire à deux niveaux : les chapitres, et sous chacun ses sections. */
export function tableOfContents(productDocument: ProductDocument): TocEntry[] {
  return [
    ...productDocument.chapters.flatMap((chapter) => [
      { anchor: chapter.anchor, title: chapterHeading(chapter), level: 1 as const },
      ...sectionTitles(chapter.blocks).map((title, index) => ({ anchor: sectionAnchor(chapter.anchor, index), title, level: 2 as const })),
    ]),
    ...(productDocument.bibliography.length > 0 ? [{ anchor: SOURCE_ANCHOR, title: SOURCE_TITLE, level: 1 as const }] : []),
  ];
}

/** Sections soumises au vérificateur de conformité, étiquetées par chapitre. */
export function documentComplianceSections(productDocument: ProductDocument): ComplianceSection[] {
  return [
    {
      label: 'Titre et sous-titre',
      text: [productDocument.title, productDocument.subtitle].filter(nonEmpty).join('\n'),
    },
    ...productDocument.chapters.map((chapter) => ({
      label: chapterHeading(chapter),
      text: [chapterHeading(chapter), ...chapter.paragraphs].join('\n'),
    })),
  ].filter((section) => section.text.trim().length > 0);
}

/** Texte intégral soumis au vérificateur d'originalité. */
export function documentPlainText(productDocument: ProductDocument): string {
  return documentComplianceSections(productDocument)
    .map((section) => section.text)
    .join('\n\n');
}
