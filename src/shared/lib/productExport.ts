import { checkSectionsCompliance } from '@/shared/lib/complianceGate';
import { coversApi } from '@/shared/lib/covers';
import { fetchRequiredDisclaimer } from '@/shared/lib/legal';
import {
  ProductDocument,
  ProductExportStamp,
  buildProductDocument,
  documentComplianceSections,
  documentPlainText,
} from '@/shared/lib/productDocument';
import { renderProductPDF } from '@/shared/lib/productPdf';
import { recordExport } from '@/shared/lib/usage';
import { getSwipeEntries } from '@/shared/lib/useSwipeFile';
import { DigitalProductIdea, MarketAnalysisReport } from '@/shared/types/analysis';
import { ReportComplianceVerdict } from '@/shared/types/compliance';
import { OriginalityReference, OriginalityVerdict } from '@/shared/types/originality';

/**
 * Porte d'export d'un produit — feuilles de route 3.2 et 3.3.
 *
 * Deux contrôles, un seul chemin : la conformité publicitaire (veto du Lot 1),
 * puis l'originalité (blocage sous le seuil). Comme pour le rapport, c'est le seul
 * point d'entrée exposé : un bouton d'export ne peut pas « oublier » un contrôle.
 */

export type ProductExportFormat = 'pdf' | 'docx';

export interface ProductExportVerdict {
  compliance: ReportComplianceVerdict;
  /** null ⇒ la vérification n'a pas pu s'exécuter : l'export est bloqué. */
  originality: OriginalityVerdict | null;
  originalityUnavailableReason?: string;
  exportAllowed: boolean;
}

export class ProductExportBlockedError extends Error {
  constructor(readonly verdict: ProductExportVerdict) {
    super('Export du produit refusé par les contrôles.');
    this.name = 'ProductExportBlockedError';
  }
}

/** Plafonds alignés sur la validation de `POST /api/originality/check`. */
const MAX_REFERENCES = 80;
const MAX_REFERENCE_CHARS = 10_000;
const MAX_TEXT_CHARS = 50_000;

/**
 * Textes de tiers connus du client : les publicités sauvegardées dans le swipe file.
 *
 * Les textes « concurrents » du rapport sont volontairement exclus : positionnement,
 * forces et failles y sont rédigés par l'analyse de Smart Creator, pas par les
 * concurrents. Les comparer au produit signalerait comme plagiat la reprise de
 * notre propre analyse.
 */
export function collectOriginalityReferences(): OriginalityReference[] {
  return getSwipeEntries()
    .flatMap((entry) =>
      entry.ad.creativeBody
        ? [{ label: `Swipe file — ${entry.ad.advertiserName}`, text: entry.ad.creativeBody }]
        : [],
    )
    .slice(0, MAX_REFERENCES)
    .map((reference) => ({
      label: reference.label.slice(0, 200),
      text: reference.text.slice(0, MAX_REFERENCE_CHARS),
    }));
}

async function requestOriginality(
  productDocument: ProductDocument,
): Promise<{ verdict: OriginalityVerdict | null; unavailableReason?: string }> {
  try {
    const response = await fetch('/api/originality/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: documentPlainText(productDocument).slice(0, MAX_TEXT_CHARS),
        references: collectOriginalityReferences(),
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      return {
        verdict: null,
        unavailableReason:
          payload?.error?.message ?? `Le vérificateur d'originalité a répondu ${response.status}.`,
      };
    }

    return { verdict: (await response.json()) as OriginalityVerdict };
  } catch {
    return { verdict: null, unavailableReason: "Le vérificateur d'originalité est injoignable." };
  }
}

export async function checkProductExport(productDocument: ProductDocument): Promise<ProductExportVerdict> {
  const [compliance, originality] = await Promise.all([
    checkSectionsCompliance(documentComplianceSections(productDocument)),
    requestOriginality(productDocument),
  ]);

  return {
    compliance,
    originality: originality.verdict,
    ...(originality.unavailableReason
      ? { originalityUnavailableReason: originality.unavailableReason }
      : {}),
    // Échec fermé sur les deux contrôles : sans verdict, pas d'export. Une mesure
    // impossible faute de références ne bloque pas — elle est imprimée comme telle.
    exportAllowed:
      compliance.exportAllowed && originality.verdict !== null && !originality.verdict.blocking,
  };
}

/**
 * **Seul** chemin d'export d'un produit. Contrôle, puis rend — jamais l'inverse.
 *
 * @throws {ProductExportBlockedError} si un contrôle refuse ou n'a pas pu aboutir.
 */
export async function exportProduct(
  product: DigitalProductIdea,
  report: MarketAnalysisReport,
  isEditedVersion: boolean,
  format: ProductExportFormat,
  /** Couverture générée prête, placée en première page. */
  coverId: string | null = null,
): Promise<ProductExportVerdict> {
  const productDocument = buildProductDocument(product, report, isEditedVersion);
  const verdict = await checkProductExport(productDocument);
  const originality = verdict.originality;

  if (!verdict.exportAllowed || !originality) {
    throw new ProductExportBlockedError(verdict);
  }

  const stamp: ProductExportStamp = {
    complianceRulesVersion: verdict.compliance.rulesVersion,
    complianceWarnings: verdict.compliance.findings.filter((f) => f.severity === 'warn').length,
    originality:
      originality.measurable && originality.originalityPercent !== null
        ? {
            measured: true,
            percent: originality.originalityPercent,
            threshold: originality.threshold,
            referencesCompared: originality.referencesCompared,
          }
        : { measured: false, reason: originality.unmeasurableReason ?? 'mesure impossible.' },
    checkedAt: verdict.compliance.checkedAt,
    disclaimer: verdict.compliance.requiredDisclaimer || (await fetchRequiredDisclaimer()),
  };

  // Une couverture illisible ne prive pas de l'export : le document part sans elle.
  const image = coverId ? await coversApi.image(coverId).catch(() => null) : null;

  if (format === 'pdf') {
    const pdfFormat = image ? ({ 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WEBP' } as const)[image.mimeType as 'image/png'] : undefined;
    renderProductPDF(productDocument, stamp, image && pdfFormat ? { dataUrl: image.dataUrl, format: pdfFormat } : null);
  } else {
    // Chargé à la demande : la bibliothèque DOCX est lourde et ne sert qu'à cet export.
    const { renderProductDOCX } = await import('@/shared/lib/productDocx');
    const docxType = image?.mimeType === 'image/png' ? 'png' : image?.mimeType === 'image/jpeg' ? 'jpg' : null;
    await renderProductDOCX(productDocument, stamp, image && docxType ? { type: docxType, data: image.bytes } : null);
  }

  recordExport('ebook', format);
  return verdict;
}
