import type { ReactNode } from 'react';
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
 */
interface NoDataStateProps {
  /** Ce qui serait affiché ici une fois la source branchée. */
  title: string;
  /** Pourquoi il n'y a rien à montrer — en clair, sans jargon technique. */
  reason: ReactNode;
  icon?: LucideIcon;
  action?: { label: string; onClick: () => void };
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
          {action && (
            <Button variant="outline" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {children}
        </EmptyContent>
      )}
    </Empty>
  );
}
