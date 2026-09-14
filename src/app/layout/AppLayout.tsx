import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { WorkspaceProvider } from '@/app/providers/WorkspaceProvider';
import { SidebarInset, SidebarProvider } from '@/shared/ui/sidebar';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import { CommandPalette } from './CommandPalette';
import { MobileNav } from './MobileNav';
import { NicheAnalysisDialog } from './NicheAnalysisDialog';

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
          <main id="contenu" tabIndex={-1} className="flex-1 px-4 pt-6 pb-28 outline-none sm:px-6 md:pb-12 lg:px-8">
            <div className="mx-auto w-full max-w-6xl">
              <Outlet />
            </div>
          </main>
        </SidebarInset>
        <MobileNav />
        <CommandPalette />
        <NicheAnalysisDialog />
      </SidebarProvider>
    </WorkspaceProvider>
  );
}
