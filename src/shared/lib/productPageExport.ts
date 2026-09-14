import { ComplianceBlockedError, checkSectionsCompliance } from '@/shared/lib/complianceGate';
import { triggerDownload } from '@/shared/lib/download';
import { FALLBACK_DISCLAIMER } from '@/shared/lib/legal';
import { toFileSlug } from '@/shared/lib/pdfText';
import {
  PageVariant,
  buildPageModel,
  missingForExport,
  pageComplianceSections,
  renderPageHtml,
} from '@/shared/lib/productPage';
import { DigitalProductIdea } from '@/shared/types/analysis';
import { ProductPageDraft } from '@/shared/types/productPage';

/**
 * Seul chemin d'export d'une page produit : complétude, conformité, puis rendu.
 * Même règle que pour les rapports et les produits : aucun contenu publié ne sort
 * sans verdict du vérificateur.
 */

export class PageIncompleteError extends Error {
  constructor(readonly missing: string[]) {
    super('La page est incomplète.');
    this.name = 'PageIncompleteError';
  }
}

/**
 * @throws {PageIncompleteError} s'il manque le lien de paiement ou le problème.
 * @throws {ComplianceBlockedError} si une formulation bloquante est trouvée dans l'une des variantes.
 */
export async function exportProductPage(
  product: DigitalProductIdea,
  draft: ProductPageDraft,
  variant: PageVariant,
): Promise<void> {
  const missing = missingForExport(draft);
  if (missing.length > 0) throw new PageIncompleteError(missing);

  const verdict = await checkSectionsCompliance(pageComplianceSections(product, draft));
  if (!verdict.exportAllowed) throw new ComplianceBlockedError(verdict);

  const html = renderPageHtml(
    buildPageModel(product, draft, variant),
    verdict.requiredDisclaimer || FALLBACK_DISCLAIMER,
  );

  triggerDownload(
    new Blob([html], { type: 'text/html;charset=utf-8' }),
    `${toFileSlug(product.title, 'page-produit')}-variante-${variant.toLowerCase()}.html`,
  );
}
