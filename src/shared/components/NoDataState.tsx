import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { PlugZap } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/shared/ui/empty';

/**
 * État vide explicite.
 *
 * Seuls deux états sont autorisés : la donnée réelle, ou l'aveu qu'elle n'existe
 * pas encore. Le composant force donc à dire **pourquoi** la donnée manque, en
 * mots d'utilisateur : un état vide sans explication fait croire à un bug.
 *
 * L'ACTION EST CE QUI SÉPARE UN CONSTAT D'UNE SORTIE. Dire « aucune vente pour l'instant »
 * renseigne ; offrir le bouton qui mène à la première vente débloque. Un écran vide est le
 * moment exact où l'on décide de revenir ou pas, et c'est celui où le produit doit nommer le
 * geste suivant plutôt que de renvoyer chercher par où commencer.
 */
interface NoDataStateProps {
  /** Ce qui serait affiché ici une fois la source branchée. */
  title: string;
  /** Pourquoi il n'y a rien à montrer — en clair, sans jargon technique. */
  reason: ReactNode;
  icon?: LucideIcon;
  /**
   * Le geste qui remplit l'écran : un lien interne (`to`) ou une action (`onClick`).
   *
   * `to` a été ajouté parce que la plupart des sorties sont un AUTRE écran — « ouvrez le
   * Studio », « analysez une niche ». Sans lui, il fallait passer un `onClick` qui navigue,
   * ce qui prive du clic milieu, de l'ouverture dans un onglet, et de l'aperçu du lien.
   */
  action?: { label: string; onClick?: () => void; to?: string };
  /** Contenu complémentaire, par exemple un aperçu du format attendu. */
  children?: ReactNode;
  className?: string;
}

export function NoDataState({ title, reason, icon: Icon = PlugZap, action, children, className }: NoDataStateProps) {
  return (
    <Empty className={cn('border border-dashed bg-muted/30 p-6 md:p-8', className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle className="text-base font-semibold">{title}</EmptyTitle>
        <EmptyDescription>{reason}</EmptyDescription>
      </EmptyHeader>
      {(action || children) && (
        <EmptyContent className="max-w-none">
          {action &&
            (action.to ? (
              <Button asChild variant="outline" size="sm">
                <Link to={action.to}>{action.label}</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          {children}
        </EmptyContent>
      )}
    </Empty>
  );
}
