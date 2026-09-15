import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Download, LogOut, Moon, Sparkles, Sun, Target, UserRound } from 'lucide-react';
import { ACCOUNT_PATH, MODULES, MODULE_GROUPS, visibleAdminSections } from '@/app/navigation';
import { usePreferences } from '@/app/providers/PreferencesContext';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { useAuth } from '@/features/auth/AuthContext';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/shared/ui/command';

/** Palette ⌘K / Ctrl+K : aller à un module, changer de niche, lancer une action. */
export function CommandPalette() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = usePreferences();
  const { account, logout } = useAuth();
  const adminSections = account ? visibleAdminSections(account.permissions) : [];
  const { commandOpen, setCommandOpen, reports, currentReport, selectReport, setAnalysisDialogOpen, exportPdf } =
    useWorkspace();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(!commandOpen);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [commandOpen, setCommandOpen]);

  const run = (action: () => void) => {
    setCommandOpen(false);
    action();
  };

  return (
    <CommandDialog
      open={commandOpen}
      onOpenChange={setCommandOpen}
      title="Rechercher"
      description="Aller à un module, changer de niche ou lancer une action"
    >
      <CommandInput placeholder="Module, niche ou action…" />
      <CommandList>
        <CommandEmpty>Aucun résultat.</CommandEmpty>

        {MODULE_GROUPS.map((group) => (
          <CommandGroup key={group.id} heading={group.label.fr}>
            {MODULES.filter((entry) => entry.group === group.id).map((entry) => {
              const Icon = entry.icon;
              return (
                <CommandItem
                  key={entry.id}
                  value={`${entry.label.fr} ${entry.description.fr}`}
                  onSelect={() => run(() => navigate(entry.path))}
                >
                  <Icon />
                  <span>{entry.label.fr}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {entry.ready ? entry.description.fr : 'bientôt'}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}

        {adminSections.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Administration">
              {adminSections.map((section) => {
                const Icon = section.icon;
                return (
                  <CommandItem
                    key={section.id}
                    value={`administration ${section.label} ${section.description}`}
                    onSelect={() => run(() => navigate(section.path))}
                  >
                    <Icon />
                    <span>{section.label}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">{section.description}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Niches">
          {reports.map((report) => (
            <CommandItem
              key={report.id}
              value={`niche ${report.nicheName}`}
              onSelect={() => run(() => selectReport(report.id))}
            >
              <Target />
              <span className="truncate">{report.nicheName}</span>
              {report.id === currentReport.id && <Check className="ml-auto" aria-label="Niche active" />}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="analyser une niche" onSelect={() => run(() => setAnalysisDialogOpen(true))}>
            <Sparkles />
            Analyser une niche
          </CommandItem>
          <CommandItem value="exporter le dossier pdf" onSelect={() => run(() => void exportPdf())}>
            <Download />
            Exporter le dossier PDF
          </CommandItem>
          <CommandItem value="thème clair sombre" onSelect={() => run(toggleTheme)}>
            {theme === 'dark' ? <Sun /> : <Moon />}
            {theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
          </CommandItem>
          <CommandItem value="mon compte profil" onSelect={() => run(() => navigate(ACCOUNT_PATH))}>
            <UserRound />
            Mon compte
          </CommandItem>
          <CommandItem
            value="se déconnecter"
            onSelect={() =>
              run(() => {
                void logout().finally(() => navigate('/'));
              })
            }
          >
            <LogOut />
            Se déconnecter
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
