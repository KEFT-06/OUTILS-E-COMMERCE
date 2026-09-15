import { ComplianceBlockedError, checkSectionsCompliance } from '@/shared/lib/complianceGate';
import { triggerDownload } from '@/shared/lib/download';
import { formatDateFr } from '@/shared/lib/formatDate';
import { FALLBACK_DISCLAIMER } from '@/shared/lib/legal';
import { marketLabel } from '@/shared/lib/markets';
import { toFileSlug } from '@/shared/lib/pdfText';
import { recordExport } from '@/shared/lib/usage';
import { DigitalProductIdea } from '@/shared/types/analysis';
import { ComplianceSection } from '@/shared/types/compliance';
import { KitObjective, LaunchKitConfig, LaunchKitDraft } from '@/shared/types/launchKit';

/**
 * Kit de lancement — feuille de route 5.1 : contrôles et export.
 *
 * Même règle que pour tout contenu publié : aucun texte ne sort sans verdict du
 * vérificateur de conformité. Les noms de boutons ne sont pas contrôlés : ce
 * sont les libellés officiels de la plateforme, pas des textes de l'auteur.
 */

export const OBJECTIVE_LABELS: Record<KitObjective, string> = {
  sales: 'Ventes',
  leads: 'Prospects',
  traffic: 'Trafic',
};

export class KitIncompleteError extends Error {
  constructor(readonly missing: string[]) {
    super('Le kit est incomplet.');
    this.name = 'KitIncompleteError';
  }
}

function filled(text: string): boolean {
  return text.trim().length > 0;
}

export function missingForKit(draft: LaunchKitDraft): string[] {
  return draft.copies.some((copy) => filled(copy.primaryText))
    ? []
    : ['Au moins un texte publicitaire principal : le kit ne le rédige pas à votre place.'];
}

export function kitComplianceSections(draft: LaunchKitDraft, config: LaunchKitConfig): ComplianceSection[] {
  const copySections = draft.copies.map((copy, index) => ({
    label: `Texte publicitaire ${index + 1}`,
    text: [copy.primaryText, copy.headline, copy.description].join('\n'),
  }));

  const scriptSections = config.scriptFormats.map((format) => {
    const beats = draft.scripts[String(format.durationSeconds)] ?? {};
    return {
      label: `Script ${format.label}`,
      text: format.beats
        .map((beat) => [beats[beat.id]?.onScreen ?? '', beats[beat.id]?.voiceOver ?? ''].join('\n'))
        .join('\n'),
    };
  });

  return [...copySections, ...scriptSections].filter((section) => section.text.trim().length > 0);
}

export function renderKitText(
  product: DigitalProductIdea,
  draft: LaunchKitDraft,
  config: LaunchKitConfig,
  disclaimer: string,
): string {
  const lines: string[] = [
    `KIT DE LANCEMENT — ${product.title}`,
    `Objectif de campagne : ${OBJECTIVE_LABELS[draft.objective]}`,
    `Exporté par Smart Creator le ${formatDateFr(new Date().toISOString(), true)}`,
    '',
    '== TEXTES PUBLICITAIRES ==',
  ];

  draft.copies.forEach((copy, index) => {
    if (!filled(copy.primaryText) && !filled(copy.headline) && !filled(copy.description)) return;
    lines.push('', `-- Variante ${index + 1} --`);
    if (filled(copy.primaryText)) lines.push('Texte principal :', copy.primaryText.trim());
    if (filled(copy.headline)) lines.push(`Titre : ${copy.headline.trim()}`);
    if (filled(copy.description)) lines.push(`Description : ${copy.description.trim()}`);
  });

  for (const format of config.scriptFormats) {
    const beats = draft.scripts[String(format.durationSeconds)] ?? {};
    const written = format.beats.filter((beat) => filled(beats[beat.id]?.onScreen ?? '') || filled(beats[beat.id]?.voiceOver ?? ''));
    if (written.length === 0) continue;

    lines.push('', `== SCRIPT ${format.label.toUpperCase()} ==`);
    for (const beat of format.beats) {
      const text = beats[beat.id];
      lines.push(`[${beat.startSecond}–${beat.endSecond} s] ${beat.label}`);
      lines.push(`  À l'écran : ${text?.onScreen.trim() || '—'}`);
      lines.push(`  Voix off : ${text?.voiceOver.trim() || '—'}`);
    }
  }

  const platform = config.ctaPlatforms[0];
  const choices = Object.entries(draft.ctaByMarket).filter(([, buttonId]) => buttonId);
  if (platform && choices.length > 0) {
    lines.push('', `== BOUTONS D'APPEL À L'ACTION PAR MARCHÉ (${platform.label}) ==`);
    for (const [market, buttonId] of choices) {
      const button = platform.buttons.find((candidate) => candidate.id === buttonId);
      if (button) lines.push(`${marketLabel(market)} : ${button.officialName}`);
    }
    lines.push(`Noms officiels vérifiés le ${formatDateFr(platform.checkedAt)} — ${platform.source}`);
  }

  lines.push('', '---', disclaimer, '');
  return lines.join('\r\n');
}

/**
 * Seul chemin d'export du kit : complétude, conformité, puis fichier texte.
 *
 * @throws {KitIncompleteError} sans aucun texte publicitaire principal.
 * @throws {ComplianceBlockedError} si une formulation bloquante est trouvée.
 */
export async function exportLaunchKit(
  product: DigitalProductIdea,
  draft: LaunchKitDraft,
  config: LaunchKitConfig,
): Promise<void> {
  const missing = missingForKit(draft);
  if (missing.length > 0) throw new KitIncompleteError(missing);

  const verdict = await checkSectionsCompliance(kitComplianceSections(draft, config));
  if (!verdict.exportAllowed) throw new ComplianceBlockedError(verdict);

  const text = renderKitText(product, draft, config, verdict.requiredDisclaimer || FALLBACK_DISCLAIMER);
  triggerDownload(
    new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }),
    `${toFileSlug(product.title, 'produit')}-kit-de-lancement.txt`,
  );
  recordExport('launch_kit', 'txt');
}
