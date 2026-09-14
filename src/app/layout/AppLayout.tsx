import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { WorkspaceProvider } from '@/app/providers/WorkspaceProvider';
import { SidebarInset, SidebarProvider } from '@/shared/ui/sidebar';
import { Skeleton } from '@/shared/ui/skeleton';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import { CommandPalette } from './CommandPalette';
import { MobileNav } from './MobileNav';
import { NicheAnalysisDialog } from './NicheAnalysisDialog';

/** Affiché le temps de télécharger un écran : la forme d'une page, sans contenu inventé. */
function PageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Chargement de l’écran">
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl lg:col-span-2" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

/**
 * Squelette de l'espace de travail : barre latérale groupée VOIR / CRÉER / VENDRE,
 * en-tête avec niche active et actions, barre basse sur mobile, palette ⌘K.
 */
export function AppLayout() {
  const { pathname } = useLocation();

  // Chaque écran s'ouvre en haut de page, comme une vraie navigation.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <WorkspaceProvider>
      <SidebarProvider>
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md"
        >
          Aller au contenu
        </a>
        <AppSidebar />
        <SidebarInset>
          <AppHeader />
          {/* SidebarInset est déjà l'élément <main> : un second <main> dupliquerait le repère. */}
          <div id="contenu" tabIndex={-1} className="flex-1 px-4 pt-6 pb-28 outline-none sm:px-6 md:pb-12 lg:px-8">
            <div className="mx-auto w-full max-w-6xl">
              {/* La clé relance le squelette à chaque écran chargé à la demande. */}
              <Suspense key={pathname} fallback={<PageSkeleton />}>
                <Outlet />
              </Suspense>
            </div>
          </div>
        </SidebarInset>
        <MobileNav />
        <CommandPalette />
        <NicheAnalysisDialog />
      </SidebarProvider>
    </WorkspaceProvider>
  );
}
