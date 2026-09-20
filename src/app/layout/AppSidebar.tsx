import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronsUpDown, CreditCard, Home, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { ACCOUNT_PATH, ADMIN_PATH, MODULES, MODULE_GROUPS, visibleAdminSections } from '@/app/navigation';
import { initialsOf, useAuth } from '@/features/auth/AuthContext';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { BrandMark } from '@/shared/components/BrandLogo';
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
  const { account, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();

  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const credits = account?.credits;
  const planPct =
    credits && !credits.unlimited && credits.allowance ? Math.min(100, (credits.plan / credits.allowance) * 100) : 100;
  const adminSections = account ? visibleAdminSections(account.permissions) : [];

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

        {adminSections.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminSections.map((section) => {
                  const Icon = section.icon;
                  const isActive =
                    section.path === ADMIN_PATH
                      ? pathname === ADMIN_PATH
                      : pathname === section.path || pathname.startsWith(`${section.path}/`);
                  return (
                    <SidebarMenuItem key={section.id}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={section.label}>
                        <NavLink to={section.path} end={section.path === ADMIN_PATH} onClick={closeOnMobile}>
                          <Icon />
                          <span>{section.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                      {section.id === 'overview' && !account?.twoFactor.enabled && (
                        <SidebarMenuBadge className="text-warning">2FA</SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        {account && credits && (
          <div className="rounded-lg border bg-card p-3 group-data-[collapsible=icon]:hidden">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-muted-foreground">Points disponibles</span>
              <span className="font-semibold tabular-nums">{credits.unlimited ? 'Illimités' : credits.total}</span>
            </div>
            <Progress value={planPct} className="mt-2 h-1.5" aria-label="Quota mensuel restant" />
            {!credits.unlimited && credits.bonus > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">dont {credits.bonus} bonus</p>
            )}
            {/*
              « inline-flex » et une hauteur minimale de 24 px : ce lien est une commande à
              part entière, pas un mot dans une phrase. Au ras du texte, il mesurait 16 px
              de haut — en dessous du minimum tactile, un doigt le manquait.
            */}
            <Link
              to={`${ACCOUNT_PATH}#paliers`}
              onClick={closeOnMobile}
              className="mt-1 inline-flex min-h-6 items-center text-xs font-medium text-brand-green-text underline-offset-4 hover:underline"
            >
              Changer de palier
            </Link>
          </div>
        )}

        {account && (
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-accent text-xs font-semibold text-accent-foreground">
                        {initialsOf(account.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="grid min-w-0 flex-1 text-left leading-tight">
                      <span className="truncate text-sm font-semibold">{account.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {account.role === 'admin' ? 'Administrateur · ' : ''}Palier {account.plan.label}
                      </span>
                    </span>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" sideOffset={8} className="min-w-56">
                  <DropdownMenuLabel className="font-normal">
                    <span className="block truncate text-sm font-semibold">{account.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{account.email}</span>
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
                  <DropdownMenuItem
                    onSelect={() => {
                      closeOnMobile();
                      navigate(`${ACCOUNT_PATH}#paliers`);
                    }}
                  >
                    <CreditCard />
                    Paliers et paiement
                  </DropdownMenuItem>
                  {adminSections.length > 0 && (
                    <DropdownMenuItem
                      onSelect={() => {
                        closeOnMobile();
                        navigate(adminSections[0]!.path);
                      }}
                    >
                      <ShieldCheck />
                      Administration
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => navigate('/')}>
                    <Home />
                    Page d’accueil
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      void logout().finally(() => navigate('/'));
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
