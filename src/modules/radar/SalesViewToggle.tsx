import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group';

/**
 * Deux lectures des ventes d'une boutique surveillée :
 *   · « globale » — le total depuis la création des produits, tel que la boutique le publie ;
 *   · « suivi »   — ce qui s'est vendu depuis la mise sous surveillance.
 */
export type SalesView = 'globale' | 'suivi';

export function SalesViewToggle({ value, onChange }: { value: SalesView; onChange: (value: SalesView) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      // Un second clic sur l'option active ne doit pas laisser le choix vide.
      onValueChange={(next) => next && onChange(next as SalesView)}
      aria-label="Période des ventes"
    >
      <ToggleGroupItem value="globale">Depuis la création</ToggleGroupItem>
      <ToggleGroupItem value="suivi">Depuis le suivi</ToggleGroupItem>
    </ToggleGroup>
  );
}
