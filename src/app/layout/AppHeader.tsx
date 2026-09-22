import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, Moon, MoreHorizontal, Search, Sparkles, Sun } from 'lucide-react';
import { ACCOUNT_PATH, MODULE_GROUPS, findAdminSection, findModule } from '@/app/navigation';
import { usePreferences } from '@/app/providers/PreferencesContext';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/shared/ui/breadcrumb';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Kbd, KbdGroup } from '@/shared/ui/kbd';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { Separator } from '@/shared/ui/separator';
import { SidebarTrigger } from '@/shared/ui/sidebar';
import { Spinner } from '@/shared/ui/spinner';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function AppHeader() {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = usePreferences();
  const {
    reports,
    currentReport,
    selectReport,
    isAnalyzing,
    setAnalysisDialogOpen,
    setCommandOpen,
    exportPdf,
    isExportingPdf,
  } = useWorkspace();

  const entry = findModule(pathname);
  const adminSection = entry ? undefined : findAdminSection(pathname);
  const group = entry
    ? MODULE_GROUPS.find((candidate) => candidate.id === entry.group)
    : adminSection
      ? { label: { fr: 'Administration' } }
      : undefined;
  const pageLabel = entry
    ? entry.label.fr
    : adminSection
      ? adminSection.label
      : pathname.startsWith(ACCOUNT_PATH)
        ? 'Mon compte'
        : 'Espace de travail';

  useEffect(() => {
    document.title = `${pageLabel} · Smart Creator`;
  }, [pageLabel]);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 hidden data-[orientation=vertical]:h-5 md:block" />

      {/*
        C'est le fil d'Ariane qui cède, jamais les actions.

        Le bloc de droite portait `min-w-0` : la disposition le comprimait donc sous la largeur
        de son contenu, alors que ses boutons sont tous `shrink-0`. À 768 px, il mesurait 214 px
        pour 244 px de boutons, et le dernier — « Plus d'actions » — sortait de l'écran, qui se
        mettait à défiler latéralement. Le fil d'Ariane prend désormais l'espace restant et
        tronque son libellé ; les actions gardent leur taille.
      */}
      <Breadcrumb className="hidden min-w-0 flex-1 md:block">
        <BreadcrumbList className="flex-nowrap">
          {group && (
            <>
              <BreadcrumbItem className="shrink-0">{group.label.fr}</BreadcrumbItem>
              <BreadcrumbSeparator className="shrink-0" />
            </>
          )}
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{pageLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        {currentReport && reports.length > 0 && (
        <Select value={currentReport.id} onValueChange={selectReport}>
          <SelectTrigger size="sm" aria-label="Niche analysée" className="w-[8.5rem] sm:w-[13rem] xl:w-[17rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              <SelectLabel>Rapports disponibles</SelectLabel>
              {reports.map((report) => (
                <SelectItem key={report.id} value={report.id}>
                  {report.nicheName}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => setCommandOpen(true)}
          className="hidden gap-2 text-muted-foreground lg:inline-flex"
        >
          <Search />
          Rechercher
          <KbdGroup>
            <Kbd>{IS_MAC ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setCommandOpen(true)} aria-label="Rechercher">
          <Search />
        </Button>

        <Button size="sm" onClick={() => setAnalysisDialogOpen(true)} disabled={isAnalyzing}>
          {isAnalyzing ? <Spinner /> : <Sparkles />}
          <span className="sr-only sm:not-sr-only">Analyser une niche</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Plus d’actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => void exportPdf()} disabled={isExportingPdf || !currentReport}>
              {isExportingPdf ? <Spinner /> : <Download />}
              Exporter le dossier PDF
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={toggleTheme}>
              {theme === 'dark' ? <Sun /> : <Moon />}
              {theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
