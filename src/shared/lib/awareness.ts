import { AwarenessLevel } from '@/shared/types/creatives';

/**
 * Niveaux de conscience du prospect (Eugene Schwartz), libellés pour l'écran.
 * Partagés par le générateur de créatifs et le générateur de pages produits.
 */
export const AWARENESS_OPTIONS: readonly { value: AwarenessLevel; label: string; hint: string }[] = [
  { value: 'unaware', label: 'Inconscient', hint: "Ne sait pas encore qu'il a un problème : capter l'attention sans parler du produit." },
  { value: 'problem_aware', label: 'Conscient du problème', hint: 'Vit le problème sans connaître de solution : montrer la frustration.' },
  { value: 'solution_aware', label: 'Conscient de la solution', hint: 'Sait que des solutions existent : montrer le bénéfice recherché.' },
  { value: 'product_aware', label: 'Conscient du produit', hint: "Connaît votre produit sans l'avoir acheté : montrer ce qui le distingue." },
  { value: 'most_aware', label: 'Pleinement conscient', hint: "Prêt à acheter : montrer l'offre et un appel à l'action clair." },
];

export function awarenessLabel(level: AwarenessLevel): string {
  return AWARENESS_OPTIONS.find((option) => option.value === level)?.label ?? level;
}
