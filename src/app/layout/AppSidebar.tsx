import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronsUpDown, Home, LogOut, UserRound } from 'lucide-react';
import { ACCOUNT_PATH, MODULES, MODULE_GROUPS } from '@/app/navigation';
import { initialsOf, useAuth } from '@/features/auth/AuthContext';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { BrandMark } from '@/shared/ui/BrandLogo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Progress } from '@/shared/ui/progress';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/shared/ui/sidebar';

export function AppSidebar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();

  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const remaining = user ? Math.max(0, user.apiSearchesLimit - user.apiSearchesUsed) : 0;
  const remainingPct = user && user.apiSearchesLimit > 0 ? (remaining / user.apiSearchesLimit) * 100 : 0;

  return (
    <Sidebar collapsible="icon" role="navigation" aria-label="Navigation principale">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Smart Creator">
              <Link to="/app/cockpit" onClick={closeOnMobile}>
                <BrandMark className="size-8" />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span data-brand-wordmark="" className="font-display text-sm font-black tracking-wide">
                    <span className="text-brand-green">SMART</span> <span className="text-brand-orange">CREATOR</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">Veille stratégique &amp; production e-commerce</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {MODULE_GROUPS.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel>{group.label.fr}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {MODULES.filter((entry) => entry.group === group.id).map((entry) => {
                  const Icon = entry.icon;
                  const isActive = pathname === entry.path || pathname.startsWith(`${entry.path}/`);
                  return (
                    <SidebarMenuItem key={entry.id}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={entry.label.fr}>
                        <NavLink to={entry.path} onClick={closeOnMobile}>
                          <Icon />
                          <span>{entry.label.fr}</span>
                        </NavLink>
                      </SidebarMenuButton>
                      {!entry.ready && <SidebarMenuBadge className="text-muted-foreground">bientôt</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        {user && (
          <div className="rounded-lg border bg-card p-3 group-data-[collapsible=icon]:hidden">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-muted-foreground">Points restants</span>
              <span className="font-semibold tabular-nums">
                {remaining} / {user.apiSearchesLimit}
              </span>
            </div>
            <Progress value={remainingPct} className="mt-2 h-1.5" aria-label="Points de recherche restants" />
          </div>
        )}

        {user && (
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-accent text-xs font-semibold text-accent-foreground">
                        {initialsOf(user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="grid min-w-0 flex-1 text-left leading-tight">
                      <span className="truncate text-sm font-semibold">{user.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {user.isDemo ? 'Démonstration · ' : ''}Palier {user.plan}
                      </span>
                    </span>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" sideOffset={8} className="min-w-56">
                  <DropdownMenuLabel className="font-normal">
                    <span className="block truncate text-sm font-semibold">{user.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {user.email || 'Compte de démonstration'}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      closeOnMobile();
                      navigate(ACCOUNT_PATH);
                    }}
                  >
                    <UserRound />
                    Mon compte
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate('/')}>
                    <Home />
                    Page d’accueil
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      logout();
                      navigate('/');
                    }}
                  >
                    <LogOut />
                    Se déconnecter
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
