import { Suspense } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogIn, ShieldCheck } from 'lucide-react';
import { findAdminSection, visibleAdminSections } from '@/app/navigation';
import { useAuth } from '@/features/auth/AuthContext';
import { SecondFactorChooser } from '@/features/auth/SecurityCodeForm';
import { PageHeader } from '@/shared/components/PageHeader';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * Enveloppe de l'administration.
 *
 * Trois portes avant la moindre donnée : le compte détient au moins un privilège,
 * il est protégé par la double authentification, et la session courante a été
 * ouverte avec le code. Le serveur applique les mêmes règles ; l'écran les
 * explique au lieu d'afficher des erreurs.
 */
export function AdminLayout() {
  const { account, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  if (!account) return null;
  if (!account.isStaff) return <Navigate to="/app/cockpit" replace />;

  const sections = visibleAdminSections(account.permissions);

  if (!account.twoFactor.enabled) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Administration"
          title="Protégez d’abord votre compte"
          description="Un compte qui modifie des soldes, des paliers et des privilèges doit résister à un mot de passe volé."
        />
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>
              <h2 className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-brand-green-text" aria-hidden="true" />
                Second facteur obligatoire
              </h2>
            </CardTitle>
            <CardDescription>
              Choisissez un code de sécurité, demandé après votre mot de passe, ou une application d’authentification.
              L’administration s’ouvre dès l’activation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SecondFactorChooser account={account} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!account.twoFactor.sessionVerified) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Administration" title="Confirmez votre identité" />
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>
              <h2>Session ouverte sans votre code</h2>
            </CardTitle>
            <CardDescription>
              Cette session date d’avant l’activation de votre second facteur. Reconnectez-vous : votre code vous sera demandé.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => {
                void logout().finally(() => navigate('/connexion', { state: { from: pathname, email: account.email } }));
              }}
            >
              <LogIn />
              Me reconnecter
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const current = findAdminSection(pathname);
  if (current && !account.permissions.includes(current.permission)) {
    return <Navigate to={sections[0]?.path ?? '/app/cockpit'} replace />;
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Sections de l’administration" className="-mx-1 overflow-x-auto px-1 pb-1">
        <ul className="flex w-max gap-1 rounded-lg border bg-muted/50 p-1">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <li key={section.id}>
                <NavLink
                  to={section.path}
                  end={section.id === 'overview'}
                  className={({ isActive }) =>
                    cn(
                      'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground',
                      isActive && 'bg-background text-foreground shadow-sm',
                    )
                  }
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {section.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <Suspense
        fallback={
          <div className="space-y-4" role="status" aria-label="Chargement">
            <Skeleton className="h-10 w-72" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </div>
  );
}
