import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/shared/ui/empty';

export function NotFoundPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Compass />
          </EmptyMedia>
          <EmptyTitle>Page introuvable</EmptyTitle>
          <EmptyDescription>Cette adresse ne correspond à aucune page de Smart Creator.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center gap-2">
          <Button asChild>
            <Link to="/app/cockpit">Ouvrir l’espace de travail</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/">Accueil</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
