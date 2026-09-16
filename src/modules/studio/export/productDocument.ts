import { formatDateFr } from '@/shared/lib/formatDate';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { DigitalProductIdea, MarketAnalysisReport } from '@/shared/types/analysis';
import { ComplianceSection } from '@/shared/types/compliance';
import { DataProvenance, ReportDataProvenance } from '@/shared/types/provenance';

/**
 * Modèle de document neutre pour l'export d'un produit — feuille de route 3.3.
 *
 * PDF et DOCX sont rendus à partir de CE modèle, et non chacun depuis le produit.
 * Deux moteurs d'export qui lisent la donnée brute chacun à leur façon finissent
 * par produire deux documents différents pour le même produit. Les phrases de
 * contrôle et de portée sont aussi définies ici, pour être imprimées à l'identique.
 */

/** Ancres compatibles Word : lettres, chiffres et soulignés, commençant par une lettre. */
export const BIBLIOGRAPHY_ANCHOR = 'chap_sources';
export const BIBLIOGRAPHY_TITLE = 'Sources et références';
export const CONTROLS_ANCHOR = 'chap_controles';
export const CONTROLS_TITLE = 'Contrôles avant export';

export const DEMONSTRATION_COVER_NOTICE =
  "Contient des données de démonstration : ce document illustre le format d'export " +
  'et ne décrit pas un marché réel.';

export const DEMONSTRATION_BIBLIOGRAPHY_NOTICE =
  "Ce produit est issu d'un rapport de démonstration : les entrées ci-dessous illustrent " +
  'le format de la bibliographie et ne constituent pas des sources vérifiées.';

export const EMPTY_BIBLIOGRAPHY_NOTICE = "Aucune source documentaire n'est rattachée à ce produit.";

export const EMPTY_CHAPTER_NOTICE = 'Contenu à rédiger.';

export const EDITED_VERSION_NOTICE = 'Version retouchée en mode Expert.';

export interface DocumentChapter {
  /** Identifiant stable, cible des liens du sommaire. */
  anchor: string;
  title: string;
  paragraphs: string[];
}

export interface BibliographyEntry {
  /** Catégorie lisible : « Source web », « Données », « Concurrent analysé ». */
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
  bibliography: BibliographyEntry[];
  containsDemonstrationData: boolean;
  isEditedVersion: boolean;
}

export interface TocEntry {
  anchor: string;
  title: string;
}

export type OriginalityStamp =
  | { measured: true; percent: number; threshold: number; referencesCompared: number }
  | { measured: false; reason: string };

/** Résultat des contrôles, imprimé dans le document exporté. */
export interface ProductExportStamp {
  complianceRulesVersion: string;
  complianceWarnings: number;
  originality: OriginalityStamp;
  checkedAt: string;
  disclaimer: string;
}

function nonEmpty(value: string | undefined): value is string {
  return Boolean(value && value.trim());
}

const PROVENANCE_BLOCKS: { key: keyof ReportDataProvenance; label: string }[] = [
  { key: 'rates', label: 'Indicateurs de marché' },
  { key: 'searchTrends', label: 'Tendances de recherche' },
  { key: 'adCampaigns', label: 'Campagnes publicitaires' },
];

function provenanceEntry(blockLabel: string, provenance: DataProvenance): BibliographyEntry {
  const details = [blockLabel, `collecté le ${formatDateFr(provenance.collectedAt)}`];
  if (provenance.sampleSize !== undefined) {
    details.push(
      `${provenance.sampleSize.toLocaleString('fr-FR')}${provenance.sampleUnit ? ` ${provenance.sampleUnit}` : ''}`,
    );
  }

  const url = safeHttpUrl(provenance.sourceUrl);

  return {
    kind: 'Données',
    label: provenance.isDemonstration ? `${provenance.source} (démonstration)` : provenance.source,
    detail: details.join(' · '),
    ...(url ? { url } : {}),
  };
}

/**
 * @param report rapport de la niche dont vient le produit ; null pour un produit créé
 *        hors analyse (à la main, ou depuis une vidéo citée dans la bibliographie).
 */
export function buildProductDocument(
  product: DigitalProductIdea,
  report: MarketAnalysisReport | null,
  isEditedVersion: boolean,
): ProductDocument {
  const chapters: DocumentChapter[] = [
    {
      anchor: 'chap_promesse',
      title: 'Promesse et public cible',
      paragraphs: [
        product.transformationPromise,
        product.targetAudience ? `Public visé : ${product.targetAudience}` : undefined,
      ].filter(nonEmpty),
    },
    // Ancres fondées sur la position, pas sur le numéro saisi : en mode Expert,
    // deux modules peuvent porter le même numéro, pas la même ancre.
    ...product.tableOfContents.map((module, index) => ({
      anchor: `chap_module_${index + 1}`,
      title: `Module ${module.moduleNumber} — ${module.title}`,
      paragraphs: [module.details].filter(nonEmpty),
    })),
    {
      anchor: 'chap_lead_magnet',
      title: `Lead magnet — ${product.leadMagnet.title}`,
      paragraphs: [
        product.leadMagnet.format ? `Format : ${product.leadMagnet.format}` : undefined,
        product.leadMagnet.hook,
      ].filter(nonEmpty),
    },
  ];

  const originUrl = product.origin?.kind === 'video' ? safeHttpUrl(product.origin.url) : null;
  const origin: BibliographyEntry[] =
    product.origin?.kind === 'video'
      ? [{ kind: 'Vidéo source', label: product.origin.label, ...(originUrl ? { url: originUrl } : {}) }]
      : [];

  const webSources: BibliographyEntry[] = (report?.groundingSources ?? []).map((source) => {
    const url = safeHttpUrl(source.url);
    return { kind: 'Source web', label: source.title, ...(url ? { url } : {}) };
  });

  const dataSources: BibliographyEntry[] = PROVENANCE_BLOCKS.flatMap(({ key, label }) => {
    const provenance = report?.dataProvenance?.[key];
    return provenance ? [provenanceEntry(label, provenance)] : [];
  });

  const competitors: BibliographyEntry[] = (report?.competitors ?? []).map((competitor) => ({
    kind: 'Concurrent analysé',
    label: competitor.name,
    ...(competitor.urlOrHandle ? { detail: competitor.urlOrHandle } : {}),
  }));

  return {
    title: product.title,
    subtitle: product.subtitle,
    typeName: product.typeName,
    chapters,
    bibliography: [...origin, ...webSources, ...dataSources, ...competitors],
    containsDemonstrationData: PROVENANCE_BLOCKS.some(
      ({ key }) => report?.dataProvenance?.[key]?.isDemonstration === true,
    ),
    isEditedVersion,
  };
}

export function tableOfContents(productDocument: ProductDocument): TocEntry[] {
  return [
    ...productDocument.chapters.map(({ anchor, title }) => ({ anchor, title })),
    { anchor: BIBLIOGRAPHY_ANCHOR, title: BIBLIOGRAPHY_TITLE },
    { anchor: CONTROLS_ANCHOR, title: CONTROLS_TITLE },
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
      label: chapter.title,
      text: [chapter.title, ...chapter.paragraphs].join('\n'),
    })),
  ].filter((section) => section.text.trim().length > 0);
}

/** Texte intégral soumis au vérificateur d'originalité. */
export function documentPlainText(productDocument: ProductDocument): string {
  return documentComplianceSections(productDocument)
    .map((section) => section.text)
    .join('\n\n');
}

export function describeCompliance(stamp: ProductExportStamp): string {
  const warnings =
    stamp.complianceWarnings > 0
      ? `, ${stamp.complianceWarnings} point(s) de vigilance signalé(s)`
      : '';
  return `Conformité publicitaire : aucune formulation bloquante (table de règles v${stamp.complianceRulesVersion})${warnings}.`;
}

export function describeOriginality(originality: OriginalityStamp): string {
  return originality.measured
    ? `Originalité : ${originality.percent.toLocaleString('fr-FR')} % (seuil bloquant : ${originality.threshold} %), ` +
        `mesurée contre ${originality.referencesCompared} texte(s) de référence connus. ` +
        "Ce n'est pas une recherche sur le web."
    : `Originalité : non mesurée — ${originality.reason}`;
}

export function describeCheckDate(stamp: ProductExportStamp): string {
  return `Contrôles effectués le ${formatDateFr(stamp.checkedAt, true)}.`;
}
