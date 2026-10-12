import { useEffect } from 'react';
import { useScreenMemory } from '@/shared/lib/apiCache';

/**
 * Remplit un champ resté vide avec ce que l'analyse propose.
 *
 * Demande du propriétaire, 11/10/2026 : « à partir de l'analyse de la niche, l'outil remplit
 * toutes les cases de chaque module ; l'utilisateur ne fait que modifier ». Trois règles, pour que
 * ce confort ne devienne jamais une gêne :
 *
 *  - on ne remplace JAMAIS ce que l'auteur a écrit lui-même ;
 *  - une proposition n'est faite qu'une fois : ce que l'auteur efface reste effacé ;
 *  - quand il change de niche sans avoir touché au champ, la proposition suit la nouvelle niche.
 *
 * `key` : nom du champ, pour retenir d'une visite à l'autre ce qui a déjà été proposé.
 */
export function usePrefill(value: string, setValue: (next: string) => void, suggestion: string | null | undefined, key: string): void {
  const [proposed, setProposed] = useScreenMemory<string | null>(`prerempli.${key}`, null);

  useEffect(() => {
    if (!suggestion || proposed === suggestion) return;
    // Autre chose que notre dernière proposition : c'est le texte de l'auteur.
    if (value.trim() && value !== proposed) return;
    setProposed(suggestion);
    setValue(suggestion);
  }, [suggestion, proposed, value, setValue, setProposed]);
}
