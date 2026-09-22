import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { MODULES } from '@/app/navigation';
import { cn } from '@/shared/lib/utils';
import { useRadarUnread } from '@/shared/stores/useRadarUnread';
import { useSidebar } from '@/shared/ui/sidebar';

/**
 * Raccourcis permanents sur téléphone ; « Menu » ouvre la navigation complète.
 *
 * Le radar y figure alors qu'il n'est pas le module le plus utilisé, pour une raison précise :
 * c'est le seul qui a du neuf à montrer sans qu'on lui ait rien demandé. Sur téléphone, la barre
 * latérale est repliée, donc sa pastille de nouveautés est invisible — sans cette place, le
 * travail de la nuit ne serait jamais vu par un utilisateur mobile, qui est la majorité ici.
 */
const SHORTCUTS = [
  { id: 'cockpit', short: 'Cockpit' },
  { id: 'niches', short: 'Niches' },
  { id: 'radar', short: 'Radar' },
  { id: 'analyse', short: 'Analyse' },
] as const;

export function MobileNav() {
  const { setOpenMobile } = useSidebar();
  const radarUnread = useRadarUnread();

  const itemClass = 'flex min-h-14 w-full flex-col items-center justify-center gap-1 text-xs font-medium';

  return (
    <nav
      aria-label="Raccourcis"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {/*
        Cinq colonnes égales : à 320 px cela fait 64 px par case, au-dessus du minimum tactile.
        Les libellés sont tronqués plutôt que laissés revenir à la ligne, ce qui déformerait la
        hauteur d'une seule case et désalignerait la barre.
      */}
      <ul className="grid grid-cols-5">
        {SHORTCUTS.map((shortcut) => {
          const entry = MODULES.find((candidate) => candidate.id === shortcut.id);
          if (!entry) return null;
          const Icon = entry.icon;
          const nouveautes = shortcut.id === 'radar' ? radarUnread : 0;
          return (
            <li key={shortcut.id} className="min-w-0">
              <NavLink
                to={entry.path}
                className={({ isActive }) =>
                  cn(itemClass, isActive ? 'text-brand-green-text' : 'text-muted-foreground hover:text-foreground')
                }
              >
                <span className="relative">
                  <Icon className="size-5" aria-hidden="true" />
                  {nouveautes > 0 && (
                    <span
                      className="absolute -end-1.5 -top-1 min-w-4 rounded-full bg-brand-green-text px-1 text-[10px] leading-4 font-semibold text-white"
                      aria-label={`${nouveautes} nouveautés`}
                    >
                      {nouveautes > 9 ? '9+' : nouveautes}
                    </span>
                  )}
                </span>
                <span className="w-full truncate px-0.5 text-center">{shortcut.short}</span>
              </NavLink>
            </li>
          );
        })}
        <li className="min-w-0">
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
