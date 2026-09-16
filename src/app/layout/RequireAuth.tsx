import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { Spinner } from '@/shared/ui/spinner';

/** Protège l'espace de travail : sans session, retour à la connexion puis à la page demandée. */
export function RequireAuth() {
  const { status, isAuthenticated } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div role="status" className="flex min-h-svh items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
        <Spinner className="size-5" />
        Vérification de votre session…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/connexion" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
  }

  return <Outlet />;
}
