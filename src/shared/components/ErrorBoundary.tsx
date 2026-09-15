import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/shared/ui/empty';

/**
 * Écran de secours quand un écran plante pendant son affichage.
 *
 * Sans lui, une seule erreur de rendu démonte tout le site et laisse une page
 * blanche, sans explication ni moyen d'en sortir. Les liens sont de vrais liens
 * (rechargement complet) : l'état qui a provoqué l'erreur ne survit pas.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Change à chaque écran : naviguer ailleurs efface l'erreur. */
  resetKey?: string;
  /** « page » occupe tout l'écran ; « inline » reste dans l'espace de travail. */
  variant?: 'page' | 'inline';
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Fichier d'un écran introuvable : le site a été mis à jour depuis l'ouverture de l'onglet. */
function isStaleBundle(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|ChunkLoadError/i.test(
    `${error.name} ${error.message}`,
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Journal du navigateur seulement : aucune donnée ne part vers un service tiers.
    console.error('[écran de secours]', error, info.componentStack);
  }

  override componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isStaleBundle(error);
    const content = (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert />
          </EmptyMedia>
          <EmptyTitle>{stale ? 'Une nouvelle version du site est disponible' : 'Cet écran n’a pas pu s’afficher'}</EmptyTitle>
          <EmptyDescription>
            {stale
              ? 'Rechargez la page pour continuer : vos données sont enregistrées sur votre compte.'
              : 'Une erreur inattendue l’a interrompu. Rechargez la page ; si le problème revient, signalez-le à l’équipe Smart Creator.'}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RefreshCw />
            Recharger la page
          </Button>
          <Button variant="outline" asChild>
            <a href={this.props.variant === 'inline' ? '/app/cockpit' : '/'}>
              {this.props.variant === 'inline' ? 'Retour au cockpit' : 'Accueil'}
            </a>
          </Button>
        </EmptyContent>
      </Empty>
    );

    if (this.props.variant === 'inline') {
      return (
        <div role="alert" className="rounded-xl border border-dashed py-10">
          {content}
        </div>
      );
    }
    return (
      <div role="alert" className="flex min-h-svh items-center justify-center bg-background px-4">
        {content}
      </div>
    );
  }
}
