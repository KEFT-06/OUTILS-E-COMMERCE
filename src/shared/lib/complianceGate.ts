import { MarketAnalysisReport } from '@/shared/types/analysis';
import {
  ComplianceSection,
  ComplianceVerdict,
  LocatedFinding,
  ReportComplianceVerdict,
} from '@/shared/types/compliance';
import { FALLBACK_DISCLAIMER } from '@/shared/lib/legal';
import { recordExport } from '@/shared/lib/usage';

/**
 * Porte de conformité — différenciateur n°2 (CdC §6.4.1).
 *
 * Le service serveur a un droit de veto : « aucun contenu ne s'exporte sans son
 * verdict ». Pour que cette phrase soit vraie, la vérification ne peut pas être
 * une ligne que chaque bouton d'export pense à appeler — il suffirait d'un
 * bouton distrait pour la contourner. Elle est donc placée ici, sur le seul
 * chemin d'export exposé au reste de l'application.
 *
 * Deux conséquences assumées :
 *  - En cas de verdict bloquant, on lève. L'appelant affiche les corrections ;
 *    il n'a aucun moyen de forcer le passage.
 *  - Si la vérification ne peut pas aboutir, on bloque aussi. Un export qui
 *    passe parce que le vérificateur était en panne est exactement le trou que
 *    le veto est censé fermer.
 */

/** Marge sous la limite de 20 000 caractères de l'API. */
const MAX_SECTION_CHARS = 18_000;

export class ComplianceBlockedError extends Error {
  constructor(readonly verdict: ReportComplianceVerdict) {
    super("Export bloqué par le vérificateur de conformité.");
    this.name = 'ComplianceBlockedError';
  }
}

/**
 * Découpe le rapport en sections étiquetées plutôt qu'en un seul bloc.
 *
 * Un constat qui dit « à l'offset 8423 » n'aide personne ; « dans les accroches
 * publicitaires » se corrige. Le découpage garde aussi chaque requête loin de
 * la limite de taille de l'API, sans avoir à tronquer — et tronquer reviendrait
 * à ne pas vérifier une partie du contenu tout en affirmant l'avoir fait.
 */
export function collectReportSections(report: MarketAnalysisReport): ComplianceSection[] {
  const sections: ComplianceSection[] = [];

  const push = (label: string, parts: (string | undefined)[]) => {
    const text = parts.filter((p): p is string => Boolean(p && p.trim())).join('\n');
    if (text.trim()) sections.push({ label, text: text.slice(0, MAX_SECTION_CHARS) });
  };

  push('Synthèse du rapport', [report.executiveSummary, report.overallVerdict ?? undefined, report.verdictRationale]);

  push(
    'Indicateurs de marché',
    Object.values(report.rates).map((rate) => rate.description),
  );

  push(
    'Produits digitaux proposés',
    report.digitalProducts.flatMap((product) => [
      product.title,
      product.subtitle,
      product.transformationPromise,
      product.leadMagnet.title,
      product.leadMagnet.hook,
    ]),
  );

  push(
    'Accroches et textes publicitaires',
    report.adCampaigns.flatMap((campaign) => [
      campaign.hookHeadline,
      campaign.metaPrimaryText,
      campaign.metaHeadline,
      campaign.callToAction,
    ]),
  );

  push(
    'Scripts vidéo',
    report.adCampaigns.flatMap((campaign) =>
      campaign.scenes.flatMap((scene) => [scene.onScreenText, scene.spokenVoiceover]),
    ),
  );

  push(
    "Plan d'action",
    report.strategicActionPlan.flatMap((phase) => [phase.title, ...phase.steps]),
  );

  return sections;
}

async function checkSection(section: ComplianceSection): Promise<ComplianceVerdict> {
  const response = await fetch('/api/compliance/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: section.text }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(
      payload?.error?.message ?? `Le vérificateur a répondu ${response.status}.`,
    );
  }

  return (await response.json()) as ComplianceVerdict;
}

export async function checkReportCompliance(
  report: MarketAnalysisReport,
): Promise<ReportComplianceVerdict> {
  return checkSectionsCompliance(collectReportSections(report));
}

/**
 * Soumet des sections étiquetées au vérificateur et fusionne les verdicts.
 *
 * Commun aux rapports et aux produits : une seule logique de veto, pour qu'un
 * type de document ne puisse pas devenir plus permissif que l'autre.
 * Ne lève jamais : un échec devient un verdict bloquant motivé.
 */
export async function checkSectionsCompliance(
  sections: ComplianceSection[],
): Promise<ReportComplianceVerdict> {
  try {
    const verdicts = await Promise.all(
      sections.map(async (section) => ({ section, verdict: await checkSection(section) })),
    );

    const findings: LocatedFinding[] = verdicts.flatMap(({ section, verdict }) =>
      verdict.findings.map((finding) => ({ ...finding, sectionLabel: section.label })),
    );

    const first = verdicts[0]?.verdict;

    return {
      exportAllowed: !findings.some((f) => f.severity === 'block'),
      rulesVersion: first?.rulesVersion ?? 'inconnue',
      checkedAt: first?.checkedAt ?? new Date().toISOString(),
      findings,
      requiredDisclaimer: first?.requiredDisclaimer ?? '',
    };
  } catch (error) {
    return {
      exportAllowed: false,
      rulesVersion: 'inconnue',
      checkedAt: new Date().toISOString(),
      findings: [],
      requiredDisclaimer: '',
      unavailableReason:
        error instanceof Error
          ? error.message
          : "Le vérificateur de conformité est injoignable.",
    };
  }
}

/**
 * **Seul** chemin d'export du rapport. Vérifie, puis exporte — jamais l'inverse.
 *
 * @throws {ComplianceBlockedError} si une règle bloquante est déclenchée ou si
 *         le verdict n'a pas pu être obtenu. L'appelant affiche le détail ;
 *         il ne peut pas passer outre.
 * @returns le verdict, qui peut contenir des avertissements non bloquants.
 */
export async function exportReportPDF(
  report: MarketAnalysisReport,
): Promise<ReportComplianceVerdict> {
  const verdict = await checkReportCompliance(report);

  if (!verdict.exportAllowed) {
    throw new ComplianceBlockedError(verdict);
  }

  // jsPDF et html2canvas pèsent à eux deux près de 140 Ko compressés. Chargés ici, et non en
  // tête de fichier, ils ne partent qu'au premier export : WorkspaceProvider passe par cette
  // porte, et les entraînait donc dans le premier écran de tout utilisateur connecté, y compris
  // ceux qui n'exportent jamais rien.
  const { generateAnalysisPDF } = await import('@/shared/lib/pdfGenerator');

  // Le verdict est apposé sur le document : mention légale obligatoire sur
  // chaque page, version de la table de règles et horodatage du contrôle.
  await generateAnalysisPDF(report, {
    rulesVersion: verdict.rulesVersion,
    checkedAt: verdict.checkedAt,
    warningCount: verdict.findings.filter((f) => f.severity === 'warn').length,
    disclaimer: verdict.requiredDisclaimer || FALLBACK_DISCLAIMER,
  });

  recordExport('report_pdf', 'pdf');
  return verdict;
}
