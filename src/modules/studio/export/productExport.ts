import { checkSectionsCompliance } from '@/shared/lib/complianceGate';
import { coversApi } from '@/shared/lib/covers';
import { composeCoverFor } from '@/shared/lib/downloadBookCover';
import {
  ProductDocument,
  buildProductDocument,
  documentComplianceSections,
  documentPlainText,
} from '@/modules/studio/export/productDocument';
import { renderProductPDF } from '@/modules/studio/export/productPdf';
import { recordExport } from '@/shared/lib/usage';
import { DigitalProductIdea, MarketAnalysisReport } from '@/shared/types/analysis';
import { ReportComplianceVerdict } from '@/shared/types/compliance';
import { OriginalityVerdict } from '@/shared/types/originality';

/**
 * Porte d'export d'un produit — feuilles de route 3.2 et 3.3.
 *
 * Deux contrôles, un seul chemin : la conformité publicitaire (veto du Lot 1),
 * puis l'originalité (blocage sous le seuil). Comme pour le rapport, c'est le seul
 * point d'entrée exposé : un bouton d'export ne peut pas « oublier » un contrôle.
 *
 * Les contrôles décident de l'export ; ils ne s'impriment plus dans l'ouvrage. Le livre est
 * celui du client : son lecteur n'a pas à y lire la version d'une table de règles.
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

/** Plafond aligné sur la validation de `POST /api/originality/check`. */
const MAX_TEXT_CHARS = 50_000;

async function requestOriginality(
  productDocument: ProductDocument,
): Promise<{ verdict: OriginalityVerdict | null; unavailableReason?: string }> {
  try {
    const response = await fetch('/api/originality/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: documentPlainText(productDocument).slice(0, MAX_TEXT_CHARS),
        references: [],
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
  /** null : produit créé hors analyse. */
  report: MarketAnalysisReport | null,
  format: ProductExportFormat,
  /** Couverture générée prête, placée en première page. */
  coverId: string | null = null,
): Promise<ProductExportVerdict> {
  const productDocument = buildProductDocument(product, report);
  const verdict = await checkProductExport(productDocument);

  if (!verdict.exportAllowed || !verdict.originality) {
    throw new ProductExportBlockedError(verdict);
  }

  /*
    Tout ouvrage part avec sa couverture, celle qui se voit à l'écran : son illustration sous le
    titre s'il en a une, une couverture typographique sinon. Sans illustration, le document
    commençait par une page de titre nue ; avec, par une image surmontée d'un bandeau qui n'était
    pas la couverture montrée ailleurs. Si la composition échoue, le document part sans elle.
  */
  const illustration = coverId ? await coversApi.image(coverId).catch(() => null) : null;
  const cover = await composeCoverFor({
    imageUrl: illustration?.dataUrl ?? null,
    text: { title: productDocument.title, subtitle: productDocument.subtitle, label: productDocument.typeName },
    seed: product.id,
  })
    .then((canvas) => canvas.toDataURL('image/jpeg', 0.92))
    .catch(() => null);

  if (format === 'pdf') {
    renderProductPDF(productDocument, cover ? { dataUrl: cover, format: 'JPEG', composed: true } : null);
  } else {
    // Chargé à la demande : la bibliothèque DOCX est lourde et ne sert qu'à cet export.
    const { renderProductDOCX } = await import('@/modules/studio/export/productDocx');
    const bytes = cover ? Uint8Array.from(atob(cover.slice(cover.indexOf(',') + 1)), (char) => char.charCodeAt(0)) : null;
    await renderProductDOCX(productDocument, bytes ? { type: 'jpg', data: bytes, composed: true } : null);
  }

  recordExport('ebook', format);
  return verdict;
}
