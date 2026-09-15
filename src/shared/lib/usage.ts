import { apiRequest } from '@/shared/lib/api';

/**
 * Déclare au serveur un export fait dans le navigateur (ebook, page produit,
 * dossier PDF…), pour les statistiques de contenus de l'administration.
 *
 * Sans effet sur l'export lui-même : un échec de la déclaration ne doit jamais
 * priver l'utilisateur de son fichier.
 */

export type ExportKind = 'ebook' | 'product_page' | 'report_pdf' | 'swipe_file' | 'launch_kit';

export function recordExport(kind: ExportKind, format: 'pdf' | 'docx' | 'html' | 'csv' | 'txt'): void {
  void apiRequest('/api/account/exports', { method: 'POST', body: { kind, format } }).catch(() => undefined);
}
