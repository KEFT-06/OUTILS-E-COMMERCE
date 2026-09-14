import { Hammer } from 'lucide-react';
import { PageHeader } from '@/shared/components/PageHeader';
import { Badge } from '@/shared/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/shared/ui/empty';

interface PlaceholderModuleViewProps {
  eyebrow?: string;
  title: string;
  description: string;
  /** Ce qui empêche le module d'exister aujourd'hui, dit sans détour. */
  blocker: string;
}

/**
 * Module non disponible. Aucun contenu simulé, aucun squelette animé : un écran
 * qui « charge » ferait croire qu'un résultat va arriver.
 */
export function PlaceholderModuleView({ eyebrow, title, description, blocker }: PlaceholderModuleViewProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={<Badge variant="warning">Non disponible</Badge>}
      />
      <Empty className="border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Hammer />
          </EmptyMedia>
          <EmptyTitle>Ce module n’est pas encore construit</EmptyTitle>
          <EmptyDescription>{blocker}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
