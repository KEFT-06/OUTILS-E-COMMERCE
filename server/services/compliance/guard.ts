import { AppError } from '@server/middleware';
import { ComplianceUnavailableError, checkText } from '@server/services/compliance';

/**
 * Traduit l'indisponibilité de la table en 503 explicite.
 *
 * Le client doit pouvoir distinguer « rien à signaler » d'« impossible de
 * vérifier » : dans le second cas il bloque l'export au lieu de l'autoriser.
 * Un 500 générique laisserait cette distinction à l'interprétation.
 */
export function asComplianceRouteError(error: unknown): never {
  if (error instanceof ComplianceUnavailableError) {
    console.error('[conformité] table illisible :', error.configPath, error.cause);
    throw new AppError(503, error.message, 'COMPLIANCE_UNAVAILABLE');
  }
  throw error;
}

/** Refuse une génération dont le brief déclenche une règle bloquante (422 avec constats). */
export async function assertCompliantBrief(text: string, message: string): Promise<void> {
  const verdict = await checkText(text).catch(asComplianceRouteError);
  if (!verdict.exportAllowed) {
    throw new AppError(
      422,
      message,
      'BRIEF_NON_COMPLIANT',
      verdict.findings.filter((finding) => finding.severity === 'block'),
    );
  }
}
