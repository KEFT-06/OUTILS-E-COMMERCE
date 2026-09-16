/**
 * Miroir client du contrat de `server/services/compliance`.
 * Types seulement : aucun code serveur n'entre dans le bundle.
 */

export type ComplianceSeverity = 'block' | 'warn';

export interface ComplianceFinding {
  ruleId: string;
  category: string;
  severity: ComplianceSeverity;
  /** Extrait exact qui a déclenché la règle — l'utilisateur doit voir quoi corriger. */
  matched: string;
  offset: number;
  action: string;
  rewriteHint: string;
}

export interface ComplianceVerdict {
  /** false ⇒ export interdit. Aucun contournement ne doit être proposé. */
  exportAllowed: boolean;
  rulesVersion: string;
  checkedAt: string;
  findings: ComplianceFinding[];
  requiredDisclaimer: string;
}

/** Un fragment analysé, rattaché à l'endroit du rapport dont il provient. */
export interface ComplianceSection {
  /** Intitulé lisible, affiché à l'utilisateur : « Accroches publicitaires ». */
  label: string;
  text: string;
}

/** Constat enrichi de la section d'où il vient, pour être actionnable. */
export interface LocatedFinding extends ComplianceFinding {
  sectionLabel: string;
}

export interface ReportComplianceVerdict {
  exportAllowed: boolean;
  rulesVersion: string;
  checkedAt: string;
  findings: LocatedFinding[];
  requiredDisclaimer: string;
  /**
   * Renseigné quand la vérification n'a pas pu aboutir (API injoignable,
   * table de règles illisible). Dans ce cas `exportAllowed` vaut false :
   * sans verdict, pas d'export.
   */
  unavailableReason?: string;
}
