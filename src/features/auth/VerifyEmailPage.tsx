import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, MailCheck, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * Confirmation de l'adresse e-mail, depuis le lien reçu. Le jeton arrive après « # »
 * et disparaît de la barre d'adresse dès la lecture. Le lien fonctionne même sans
 * être connecté, sur n'importe quel appareil.
 */
export function VerifyEmailPage() {
  const { account, refresh } = useAuth();
  const [token] = useState(() => window.location.hash.slice(1));
  const [state, setState] = useState<'checking' | 'done' | 'failed'>(token ? 'checking' : 'failed');
  const [message, setMessage] = useState(token ? '' : 'Ce lien est incomplet : ouvrez-le exactement tel que vous l’avez reçu.');

  useEffect(() => {
    document.title = 'Confirmation de l’adresse · Smart Creator';
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    if (!token) return;

    let cancelled = false;
    apiRequest('/api/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => {
        if (cancelled) return;
        setState('done');
        void refresh();
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setState('failed');
        setMessage(toApiError(caught, 'Ce lien n’est plus valide.').message);
      });
    return () => {
      cancelled = true;
    };
  }, [token, refresh]);

  return (
    <div className="flex min-h-svh flex-col items-center bg-background px-4 py-10">
      <header>
        <Link to="/" className="rounded-md" aria-label="Accueil Smart Creator">
          <BrandLogo size="md" />
        </Link>
      </header>

      <main className="mt-10 w-full max-w-md">
        <Card>
          <CardHeader>
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <MailCheck className="size-5" aria-hidden="true" />
            </span>
            <CardTitle className="mt-2 font-display text-2xl font-extrabold tracking-tight">
              <h1>Confirmation de votre adresse</h1>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {state === 'checking' ? (
              <div className="space-y-3" role="status" aria-label="Vérification du lien">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
            ) : state === 'done' ? (
              <Alert variant="success" role="status">
                <CircleCheck />
                <AlertTitle>Adresse confirmée</AlertTitle>
                <AlertDescription>Vous pourrez recevoir un lien par e-mail si vous oubliez votre mot de passe.</AlertDescription>
              </Alert>
            ) : (
              <Alert variant="danger" role="alert">
                <TriangleAlert />
                <AlertTitle>Lien inutilisable</AlertTitle>
                <AlertDescription>
                  {message} Depuis Mon compte, vous pouvez demander un nouvel e-mail de confirmation.
                </AlertDescription>
              </Alert>
            )}
            {state !== 'checking' && (
              <Button className="w-full" asChild>
                <Link to={account ? '/app/compte' : '/connexion'}>{account ? 'Aller à mon compte' : 'Se connecter'}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
