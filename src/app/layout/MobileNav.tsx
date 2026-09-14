import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { MODULES } from '@/app/navigation';
import { cn } from '@/shared/lib/utils';
import { useSidebar } from '@/shared/ui/sidebar';

/** Raccourcis permanents sur téléphone ; « Menu » ouvre la navigation complète. */
const SHORTCUTS = [
  { id: 'cockpit', short: 'Cockpit' },
  { id: 'radar', short: 'Radar' },
  { id: 'analyse', short: 'Analyse' },
] as const;

export function MobileNav() {
  const { setOpenMobile } = useSidebar();

  const itemClass = 'flex min-h-14 w-full flex-col items-center justify-center gap-1 text-xs font-medium';

  return (
    <nav
      aria-label="Raccourcis"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-4">
        {SHORTCUTS.map((shortcut) => {
          const entry = MODULES.find((candidate) => candidate.id === shortcut.id);
          if (!entry) return null;
          const Icon = entry.icon;
          return (
            <li key={shortcut.id}>
              <NavLink
                to={entry.path}
                className={({ isActive }) =>
                  cn(itemClass, isActive ? 'text-brand-green-text' : 'text-muted-foreground hover:text-foreground')
                }
              >
                <Icon className="size-5" aria-hidden="true" />
                {shortcut.short}
              </NavLink>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setOpenMobile(true)}
            className={cn(itemClass, 'text-muted-foreground hover:text-foreground')}
          >
            <Menu className="size-5" aria-hidden="true" />
            Menu
          </button>
        </li>
      </ul>
    </nav>
  );
}
