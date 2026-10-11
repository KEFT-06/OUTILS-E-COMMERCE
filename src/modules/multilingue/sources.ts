import { type GuideSection, parseGuideText } from '@server/shared/guides';
import type { DigitalProductIdea, MarketAnalysisReport, ReportDocument } from '@/shared/types/analysis';
import type { StorybookEntry } from '@/shared/types/storybook';

/**
 * Ce qui se traduit : un ouvrage du Studio, un rapport d'analyse, un conte illustré.
 *
 * Demande du propriétaire, 11/10/2026 : « au niveau des guides multilingues, on ne crée pas de
 * guide, on traduit les rapports disponibles, les ebooks disponibles, les storybooks
 * disponibles ». Ce fichier dit, pour chacun, le texte qui part à la traduction.
 */

export type WorkKind = 'product' | 'report' | 'storybook';

export const WORK_LABELS: Record<WorkKind, { one: string; many: string; empty: string }> = {
  product: { one: 'Ebook', many: 'Ebooks et ouvrages', empty: 'Aucun ouvrage pour l’instant : le Studio en crée à partir d’une analyse, d’un texte ou d’une vidéo.' },
  report: { one: 'Rapport', many: 'Rapports d’analyse', empty: 'Aucun rapport pour l’instant : « Analyser une niche », en haut de l’écran, crée le premier.' },
  storybook: { one: 'Conte', many: 'Contes illustrés', empty: 'Aucun conte prêt pour l’instant : le Storybook illustré en crée à partir d’un prénom et d’un thème.' },
};

const newId = () => crypto.randomUUID().slice(0, 12);
const section = (heading: string, body: string): GuideSection => ({ id: newId(), heading, body });
const liste = (lignes: readonly string[]) => lignes.filter((ligne) => ligne.trim()).map((ligne) => `- ${ligne.trim()}`).join('\n');
const nonVides = (sections: GuideSection[]) => sections.filter((entry) => entry.heading.trim() || entry.body.trim());

/** Un ouvrage du Studio : sa promesse, son public, puis chaque module. */
export function productSections(product: DigitalProductIdea): GuideSection[] {
  return nonVides([
    ...(product.transformationPromise.trim() ? [section('Promesse', product.transformationPromise)] : []),
    ...(product.targetAudience.trim() ? [section('Pour qui', product.targetAudience)] : []),
    ...product.tableOfContents.map((module) => section(`Module ${module.moduleNumber} — ${module.title}`, module.details)),
  ]);
}

/**
 * Un rapport d'analyse : son rapport rédigé quand il existe — c'est le texte que l'auteur lit et
 * exporte —, sinon l'étude elle-même, rubrique par rubrique.
 */
export function reportSections(report: MarketAnalysisReport, document: Pick<ReportDocument, 'status' | 'markdown'> | null): GuideSection[] {
  if (document?.status === 'ready' && document.markdown?.trim()) {
    const written = parseGuideText(document.markdown, newId);
    if (written.length > 0) return written;
  }
  const audience = report.audience;
  const pricing = report.pricing;
  return nonVides([
    section('Synthèse', [report.executiveSummary, report.verdictRationale ?? ''].filter((texte) => texte.trim()).join('\n\n')),
    ...(report.keyFindings ?? []).map((finding) => section(finding.title, finding.detail)),
    ...(audience
      ? [
          section(
            'Public visé',
            [audience.profile, audience.pains.length ? `Ce qui lui pèse :\n${liste(audience.pains)}` : '', audience.motivations.length ? `Ce qui le motive :\n${liste(audience.motivations)}` : '', audience.objections.length ? `Ce qui le retient :\n${liste(audience.objections)}` : '']
              .filter((texte) => texte.trim())
              .join('\n\n'),
          ),
        ]
      : []),
    ...(pricing ? [section('Prix', [pricing.observed, pricing.recommendation].filter((texte) => texte.trim()).join('\n\n'))] : []),
    ...(report.channels?.length ? [section('Canaux', liste(report.channels.map((channel) => `${channel.channel} : ${channel.why}`)))] : []),
    ...report.competitors.map((competitor) =>
      section(
        `Concurrent — ${competitor.name}`,
        [competitor.positioning, competitor.strengths.length ? `Forces :\n${liste(competitor.strengths)}` : '', competitor.weaknesses.length ? `Faiblesses :\n${liste(competitor.weaknesses)}` : '', competitor.exploitableGaps.length ? `Ouvertures :\n${liste(competitor.exploitableGaps)}` : '']
          .filter((texte) => texte.trim())
          .join('\n\n'),
      ),
    ),
    ...(report.risks?.length ? [section('Risques', liste(report.risks.map((risk) => `${risk.risk} — ${risk.mitigation}`)))] : []),
    ...report.strategicActionPlan.map((phase) => section(`${phase.phase} — ${phase.title}`, liste(phase.steps))),
  ]);
}

/** Un conte illustré : le texte de chaque page, dans l'ordre. Les illustrations ne se traduisent pas. */
export function storybookSections(entry: Pick<StorybookEntry, 'story'>): GuideSection[] {
  return nonVides(entry.story.pages.map((page, index) => section(page.heading.trim() || `Page ${index + 1}`, page.text)));
}

/** Le texte entier de sections : sert à reconnaître la langue d'origine. */
export const textOf = (sections: readonly GuideSection[]) => sections.map((entry) => `${entry.heading}\n${entry.body}`).join('\n');
