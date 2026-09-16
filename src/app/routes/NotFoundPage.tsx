import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { BrandLogo } from '@/shared/components/BrandLogo';
import { Button } from '@/shared/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/shared/ui/empty';

/**
 * Adresse inconnue. En production, le serveur répond déjà 404 avec ce titre et `noindex`
 * (server/services/seo) ; ici, le titre suit aussi une navigation faite dans le navigateur.
 */
export function NotFoundPage() {
  useEffect(() => {
    document.title = 'Page introuvable · Smart Creator';
  }, []);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4">
      <Link to="/" className="rounded-md" aria-label="Accueil Smart Creator">
        <BrandLogo size="md" />
      </Link>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Compass />
          </EmptyMedia>
          <EmptyTitle>
            <h1>Page introuvable</h1>
          </EmptyTitle>
          <EmptyDescription>
            Cette adresse ne correspond à aucune page de Smart Creator : le lien est peut-être ancien ou mal recopié.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/">Retour à l’accueil</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/contact?sujet=bug">Signaler ce lien</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
