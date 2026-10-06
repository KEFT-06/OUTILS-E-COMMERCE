import { useDeferredValue, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  FolderHeart,
  FolderPlus,
  History,
  type LucideIcon,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { countryName, searchKey } from '@server/shared/countries';
import type { ReportSummary } from '@server/shared/analysis';
import { ACCOUNT_PATH } from '@/app/navigation';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { NICHE_COUNT, NICHE_SECTORS } from '@/modules/niches/nicheCatalog';
import { suggestCatalog } from '@/modules/niches/nicheMatch';
import { PageHeader } from '@/shared/components/PageHeader';
import { toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { cn } from '@/shared/lib/utils';
import { type NicheCatalogState, useNicheCatalog } from '@/shared/stores/useNicheCatalog';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Progress } from '@/shared/ui/progress';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Catalogue des niches, niches enregistrées, et historique des niches analysées.
 *
 * Le catalogue du site est une taxonomie de départ. L'utilisateur le complète : une niche qu'il
 * ajoute est rangée d'elle-même dans le secteur qui lui convient (il peut en choisir un autre),
 * et il crée les catalogues qui manquent. Le tout est conservé sur son compte.
 *
 * Le nombre de niches qu'un compte peut ENREGISTRER (signet) dépend de son palier : le serveur
 * refuse au-delà, l'écran l'annonce avant. Ranger une niche dans le catalogue n'en dépend pas.
 */

const PREVIEW_COUNT = 5;
const HISTORY_PREVIEW = 6;

/** Rangement automatique : le catalogue est choisi d'après les mots de la niche. */
const AUTO = 'auto';
/** Création d'un catalogue au passage. */
const NEW = 'nouveau';
/** Catalogue personnel par défaut : reçoit les niches qu'aucun secteur ne réclame. Il n'existe que s'il contient quelque chose. */
const DEFAULT_OWN = { id: 'perso-mes-niches', label: 'Mes niches' };

interface DisplayedCatalog {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  niches: readonly string[];
  /** Catalogue créé par l'utilisateur (ou son catalogue par défaut). */
  own: boolean;
  /** Peut être supprimé : un catalogue créé, pas un secteur du site. */
  removable: boolean;
}

type Confirmation = { kind: 'one'; report: ReportSummary } | { kind: 'all' } | null;

export function NichesView() {
  const navigate = useNavigate();
  const { account, saveNiche, removeNiche } = useAuth();
  const { analyzeNiche, isAnalyzing, reports, currentReport, selectReport, deleteReport, deleteAllReports } = useWorkspace();
  const own = useNicheCatalog();
  const [query, setQuery] = useState('');
  const [sectorId, setSectorId] = useState('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [custom, setCustom] = useState('');
  const [target, setTarget] = useState(AUTO);
  const [newCatalog, setNewCatalog] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [deleting, setDeleting] = useState(false);

  const saved = useMemo(() => account?.savedNiches ?? [], [account?.savedNiches]);
  const limit = account ? account.limits.savedNiches : 0;
  const full = limit !== null && saved.length >= limit;
  const savedKeys = useMemo(() => new Set(saved.map(searchKey)), [saved]);

  /** Niches ajoutées par l'utilisateur, par leur clé de recherche. */
  const ownKeys = useMemo(() => new Set(own.niches.map((niche) => searchKey(niche.name))), [own.niches]);

  /** Le catalogue affiché : les catalogues de l'utilisateur d'abord, puis les secteurs du site complétés de ses niches. */
  const catalogs = useMemo<DisplayedCatalog[]>(() => {
    const known = new Set([...own.catalogs.map((catalog) => catalog.id), ...NICHE_SECTORS.map((sector) => sector.id)]);
    const addedTo = (catalogId: string) => own.niches.filter((niche) => niche.catalogId === catalogId).map((niche) => niche.name);
    // Une niche dont le catalogue n'existe plus n'est jamais perdue : elle rejoint « Mes niches ».
    const unfiled = own.niches.filter((niche) => !known.has(niche.catalogId)).map((niche) => niche.name);

    const personal: DisplayedCatalog[] = own.catalogs.map((catalog) => ({
      id: catalog.id,
      label: catalog.label,
      description: 'Catalogue créé par vous.',
      icon: FolderHeart,
      niches: addedTo(catalog.id),
      own: true,
      removable: true,
    }));
    if (unfiled.length > 0) {
      personal.unshift({
        ...DEFAULT_OWN,
        description: 'Vos niches qu’aucun secteur du catalogue ne couvre encore.',
        icon: FolderHeart,
        niches: unfiled,
        own: true,
        removable: false,
      });
    }
    const builtIn: DisplayedCatalog[] = NICHE_SECTORS.map((sector) => {
      const added = addedTo(sector.id);
      return { ...sector, niches: added.length > 0 ? [...added, ...sector.niches] : sector.niches, own: false, removable: false };
    });
    return [...personal, ...builtIn];
  }, [own.catalogs, own.niches]);

  /*
    La saisie reste prioritaire : une recherche d'une lettre fait remonter des centaines de
    niches, et les redessiner à chaque touche faisait ramer le champ sur téléphone. La liste
    suit, un instant après, sans bloquer la frappe.
  */
  const deferredQuery = useDeferredValue(query);
  const key = searchKey(deferredQuery);
  const results = useMemo(
    () =>
      catalogs
        .filter((catalog) => sectorId === 'all' || catalog.id === sectorId)
        .map((catalog) => ({
          catalog,
          niches:
            !key || searchKey(catalog.label).includes(key) ? catalog.niches : catalog.niches.filter((niche) => searchKey(niche).includes(key)),
        }))
        // Un catalogue personnel encore vide reste affiché : c'est là qu'on voit qu'il existe.
        .filter((entry) => entry.niches.length > 0 || (entry.catalog.own && !key)),
    [catalogs, key, sectorId],
  );
  const matchCount = results.reduce((total, entry) => total + entry.niches.length, 0);

  /*
    Catalogue que le rangement automatique donnerait à la niche en cours de saisie. Calculé sur la
    saisie elle-même, sans différé : l'annonce affichait un instant « Mes niches » avant le bon
    catalogue. Le calcul est immédiat, l'index du catalogue n'étant bâti qu'une fois.
  */
  const suggestion = useMemo(() => (custom.trim().length >= 3 ? suggestCatalog(custom, catalogs) : null), [custom, catalogs]);

  const toggle = async (name: string) => {
    const isSaved = savedKeys.has(searchKey(name));
    setPending(name);
    try {
      if (isSaved) {
        await removeNiche(name);
        toast.success('Niche retirée', { description: name });
      } else {
        await saveNiche(name);
        toast.success('Niche enregistrée', { description: name });
      }
    } catch (caught) {
      const error = toApiError(caught, 'La niche n’a pas pu être enregistrée.');
      const limitReached = error.code === 'NICHE_LIMIT_REACHED';
      toast.error(limitReached ? 'Limite de votre palier atteinte' : 'Action impossible', {
        description: error.message,
        ...(limitReached ? { action: { label: 'Voir les paliers', onClick: () => navigate(`${ACCOUNT_PATH}#paliers`) } } : {}),
      });
    } finally {
      setPending(null);
    }
  };

  const showCatalog = (catalogId: string) => {
    setQuery('');
    setSectorId(catalogId);
    document.getElementById('catalogue-titre')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** Annule une suppression faite dans le catalogue personnel. */
  const undoable = (title: string, description: string, previous: NicheCatalogState) =>
    toast.success(title, { description, action: { label: 'Annuler', onClick: () => own.restore(previous) } });

  const canSubmit = custom.trim().length >= 2 || (target === NEW && newCatalog.trim().length >= 2);

  const addOwn = (event: React.FormEvent) => {
    event.preventDefault();
    const name = custom.trim();
    const wantedCatalog = newCatalog.trim();
    if (!canSubmit || (target === NEW && wantedCatalog.length < 2)) return;

    // Un catalogue seul : il est créé vide, prêt à recevoir ses niches.
    if (name.length < 2) {
      const createdId = own.addCatalog(wantedCatalog);
      toast.success('Catalogue créé', { description: `« ${wantedCatalog} » est prêt : ajoutez-y vos niches.` });
      setNewCatalog('');
      // Retour au rangement automatique : une niche du même sujet ira d'elle-même dans ce catalogue.
      setTarget(AUTO);
      showCatalog(createdId);
      return;
    }

    // Déjà au catalogue du site : on la montre où elle est, sans doublon.
    const already = NICHE_SECTORS.find((sector) => sector.niches.some((niche) => searchKey(niche) === searchKey(name)));
    if (already && target === AUTO) {
      toast.info('Cette niche est déjà au catalogue', { description: `Secteur « ${already.label} ».` });
      setCustom('');
      setSectorId(already.id);
      setQuery(name);
      return;
    }

    let catalogId: string;
    let label: string;
    if (target === NEW) {
      catalogId = own.addCatalog(wantedCatalog);
      label = wantedCatalog;
    } else if (target === AUTO) {
      const found = suggestCatalog(name, catalogs);
      catalogId = found?.id ?? DEFAULT_OWN.id;
      label = found?.label ?? DEFAULT_OWN.label;
    } else {
      catalogId = target;
      label = catalogs.find((catalog) => catalog.id === target)?.label ?? DEFAULT_OWN.label;
    }
    own.addNiche(name, catalogId);

    /*
      La réponse est immédiate : la niche est rangée, l'écran le dit et la montre. Elle attendait
      la fin de l'enregistrement du signet — en production, sur une connexion lente, « Ajouter »
      semblait ne rien faire pendant plus de trente secondes (06/10/2026).
    */
    toast.success('Niche ajoutée', { description: `Rangée dans « ${label} ».` });
    setCustom('');
    setNewCatalog('');
    setTarget(AUTO);
    showCatalog(catalogId);

    // Elle rejoint aussi les niches enregistrées, tant que le palier le permet — sans faire attendre.
    // Si l'envoi échoue, le rangement reste fait et le signet reste proposé sur la ligne de la niche.
    if (!savedKeys.has(searchKey(name)) && !full) void saveNiche(name).catch(() => undefined);
  };

  const confirmDeletion = async () => {
    if (!confirmation) return;
    setDeleting(true);
    try {
      if (confirmation.kind === 'all') await deleteAllReports();
      else await deleteReport(confirmation.report.id);
    } finally {
      setDeleting(false);
      setConfirmation(null);
    }
  };

  const shownReports = historyOpen ? reports : reports.slice(0, HISTORY_PREVIEW);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voir"
        title="Niches"
        description={`${NICHE_COUNT} niches dans ${NICHE_SECTORS.length} secteurs : santé, nutrition, tech, IA, mines et pétrole, agriculture, finance… Ajoutez les vôtres, créez les catalogues qui manquent, puis lancez leur analyse.`}
      />

      <Card id="mes-niches" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <Bookmark className="size-4 text-brand-green-text" aria-hidden="true" />
              Mes niches enregistrées
            </h2>
          </CardTitle>
          <CardDescription>
            {limit === null
              ? `${saved.length} enregistrée${saved.length > 1 ? 's' : ''} · illimité avec le palier ${account?.plan.label ?? ''}`
              : `${saved.length} sur ${limit} avec le palier ${account?.plan.label ?? ''}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {limit !== null && (
            <Progress
              value={limit === 0 ? 100 : Math.min(100, (saved.length / limit) * 100)}
              aria-label={`${saved.length} niches enregistrées sur ${limit}`}
            />
          )}

          {full && (
            <Alert variant="warning">
              <AlertTitle>Vous avez atteint la limite de votre palier</AlertTitle>
              <AlertDescription>
                <p>Retirez une niche pour en enregistrer une autre, ou passez à un palier supérieur.</p>
                <Button variant="link" className="h-auto p-0" onClick={() => navigate(`${ACCOUNT_PATH}#paliers`)}>
                  Voir les paliers
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {saved.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune niche enregistrée. Utilisez le signet d’une niche du catalogue, ou ajoutez la vôtre plus bas.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="Niches enregistrées">
              {saved.map((niche) => (
                <li key={niche} className="flex items-center gap-1 rounded-full border bg-background py-1 pr-1 pl-3 text-sm">
                  <span className="max-w-[16rem] truncate">{niche}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-full"
                    onClick={() => void analyzeNiche(niche)}
                    disabled={isAnalyzing}
                    aria-label={`Analyser ${niche}`}
                  >
                    <Sparkles />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-full"
                    onClick={() => void toggle(niche)}
                    disabled={pending === niche}
                    aria-label={`Retirer ${niche}`}
                  >
                    {pending === niche ? <Spinner /> : <X />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Historique : chaque analyse est conservée sur le compte, et se supprime une par une ou d'un coup. */}
      <Card id="historique" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <History className="size-4 text-brand-green-text" aria-hidden="true" />
              Niches analysées
            </h2>
          </CardTitle>
          <CardDescription>
            {reports.length === 0
              ? 'Votre historique est vide.'
              : `${reports.length} analyse${reports.length > 1 ? 's' : ''} conservée${reports.length > 1 ? 's' : ''} sur votre compte.`}
          </CardDescription>
          {reports.length > 0 && (
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => setConfirmation({ kind: 'all' })}>
                <Trash2 />
                Tout supprimer
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">Les niches que vous analysez apparaissent ici, avec leur rapport.</p>
          ) : (
            <>
              <ul className="divide-y" aria-label="Historique des niches analysées">
                {shownReports.map((report) => (
                  <li key={report.id} className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{report.nicheName || report.query}</span>
                        {currentReport?.id === report.id && (
                          <Badge variant="outline" className="shrink-0">
                            Ouverte
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateFr(report.createdAt)}
                        {report.market ? ` · ${countryName(report.market)}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        selectReport(report.id);
                        navigate('/app/analyse');
                      }}
                    >
                      Ouvrir
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      aria-label={`Supprimer l’analyse de ${report.nicheName || report.query}`}
                      onClick={() => setConfirmation({ kind: 'one', report })}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
              {!historyOpen && reports.length > HISTORY_PREVIEW && (
                <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setHistoryOpen(true)}>
                  <ChevronDown />
                  Afficher les {reports.length - HISTORY_PREVIEW} autres
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="catalogue-titre" className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 id="catalogue-titre" className="scroll-mt-24 font-display text-xl font-extrabold tracking-tight">
            Catalogue
          </h2>
          <div className="relative w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher : pétrole, diabète, IA, poulets…"
              aria-label="Rechercher une niche"
              className="pl-9"
            />
          </div>
        </div>

        {/* Compléter le catalogue : une niche, rangée d'elle-même, ou un catalogue qui manque. */}
        <Card>
          <CardHeader>
            <CardTitle>
              <h3 className="flex items-center gap-2">
                <FolderPlus className="size-4 text-brand-green-text" aria-hidden="true" />
                Ajouter une niche ou un catalogue
              </h3>
            </CardTitle>
            <CardDescription>
              Votre niche est rangée dans le catalogue qui lui convient. Aucun ne convient ? Créez le vôtre.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={addOwn} className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-start">
              <Field>
                <FieldLabel htmlFor="custom-niche">Niche</FieldLabel>
                <Input
                  id="custom-niche"
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                  maxLength={200}
                  placeholder="Ex. Élevage d’escargots à petite échelle"
                  disabled={!own.canAddNiche}
                />
                {target === AUTO && custom.trim().length >= 3 && (
                  <FieldDescription aria-live="polite">
                    Sera rangée dans : <span className="font-medium text-foreground">{suggestion?.label ?? DEFAULT_OWN.label}</span>
                  </FieldDescription>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="custom-catalogue">Catalogue</FieldLabel>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger id="custom-catalogue" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO}>Rangement automatique</SelectItem>
                    {own.canAddCatalog && <SelectItem value={NEW}>Créer un catalogue…</SelectItem>}
                    {own.catalogs.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Vos catalogues</SelectLabel>
                        {own.catalogs.map((catalog) => (
                          <SelectItem key={catalog.id} value={catalog.id}>
                            {catalog.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    <SelectGroup>
                      <SelectLabel>Secteurs du catalogue</SelectLabel>
                      {NICHE_SECTORS.map((sector) => (
                        <SelectItem key={sector.id} value={sector.id}>
                          {sector.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {target === NEW && (
                  <Input
                    value={newCatalog}
                    onChange={(event) => setNewCatalog(event.target.value)}
                    maxLength={80}
                    placeholder="Nom du nouveau catalogue"
                    aria-label="Nom du nouveau catalogue"
                    autoFocus
                  />
                )}
              </Field>
              <Button type="submit" variant="outline" className="lg:mt-[1.625rem]" disabled={!canSubmit || pending !== null}>
                <Plus />
                Ajouter
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="flex w-max gap-2" role="group" aria-label="Filtrer par secteur">
            <Button size="sm" variant={sectorId === 'all' ? 'secondary' : 'outline'} aria-pressed={sectorId === 'all'} onClick={() => setSectorId('all')}>
              Tous les secteurs
            </Button>
            {catalogs.map((catalog) => (
              <Button
                key={catalog.id}
                size="sm"
                variant={sectorId === catalog.id ? 'secondary' : 'outline'}
                aria-pressed={sectorId === catalog.id}
                onClick={() => setSectorId(catalog.id)}
              >
                {catalog.own && <FolderHeart />}
                {catalog.label}
              </Button>
            ))}
          </div>
        </div>

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {matchCount} niche{matchCount > 1 ? 's' : ''}
          {key ? ` pour « ${deferredQuery.trim()} »` : ''}
        </p>

        {results.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>Aucune niche ne correspond</EmptyTitle>
              <EmptyDescription>Essayez un autre mot, ou ajoutez cette niche au catalogue ci-dessus.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {results.map(({ catalog, niches }) => {
              const Icon = catalog.icon;
              const showAll = Boolean(key) || expanded[catalog.id];
              const visible = showAll ? niches : niches.slice(0, PREVIEW_COUNT);
              return (
                // Hors de l'écran, une carte n'est ni mise en page ni peinte (content-visibility) :
                // le catalogue entier compte plusieurs milliers d'éléments.
                <Card key={catalog.id} className="gap-4 [contain-intrinsic-size:auto_26rem] [content-visibility:auto]">
                  <CardHeader>
                    <CardTitle>
                      <h3 className="flex items-center gap-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                          <Icon className="size-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 truncate">{catalog.label}</span>
                        <Badge variant="outline" className="ml-auto tabular-nums">
                          {catalog.niches.length}
                        </Badge>
                        {catalog.removable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            aria-label={`Supprimer le catalogue ${catalog.label}`}
                            onClick={() => {
                              const previous = { catalogs: own.catalogs, niches: own.niches };
                              own.removeCatalog(catalog.id);
                              if (sectorId === catalog.id) setSectorId('all');
                              undoable('Catalogue supprimé', catalog.label, previous);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </h3>
                    </CardTitle>
                    <CardDescription>{catalog.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {niches.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Ce catalogue est vide. Ajoutez-y une niche ci-dessus en le choisissant dans « Catalogue ».
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {visible.map((niche) => {
                          const isSaved = savedKeys.has(searchKey(niche));
                          const isOwn = ownKeys.has(searchKey(niche));
                          return (
                            <li key={niche} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                              <span className="min-w-0 flex-1 text-sm">
                                {niche}
                                {isOwn && !catalog.own && (
                                  <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                                    Ajoutée par vous
                                  </Badge>
                                )}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void analyzeNiche(niche)}
                                disabled={isAnalyzing}
                                aria-label={`Analyser la niche ${niche}`}
                              >
                                <Sparkles />
                                <span className="hidden sm:inline">Analyser</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={cn('size-8', isSaved && 'text-brand-green-text')}
                                aria-pressed={isSaved}
                                aria-label={isSaved ? `Retirer ${niche} de mes niches` : `Enregistrer ${niche}`}
                                disabled={pending === niche || (!isSaved && full)}
                                onClick={() => void toggle(niche)}
                              >
                                {pending === niche ? <Spinner /> : isSaved ? <BookmarkCheck /> : <Bookmark />}
                              </Button>
                              {isOwn && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-muted-foreground hover:text-destructive"
                                  aria-label={`Retirer ${niche} du catalogue`}
                                  onClick={() => {
                                    const previous = { catalogs: own.catalogs, niches: own.niches };
                                    own.removeNiche(niche);
                                    undoable('Niche retirée du catalogue', niche, previous);
                                  }}
                                >
                                  <X />
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {!showAll && niches.length > PREVIEW_COUNT && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2 w-full"
                        onClick={() => setExpanded((previous) => ({ ...previous, [catalog.id]: true }))}
                      >
                        <ChevronDown />
                        Afficher les {niches.length - PREVIEW_COUNT} autres
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Dialog open={confirmation !== null} onOpenChange={(open) => !open && !deleting && setConfirmation(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmation?.kind === 'all' ? 'Effacer tout l’historique ?' : 'Supprimer cette analyse ?'}</DialogTitle>
            <DialogDescription>
              {confirmation?.kind === 'all'
                ? `Vos ${reports.length} analyses et leurs rapports seront supprimés définitivement. Vos niches enregistrées et votre catalogue ne changent pas.`
                : `L’analyse de « ${confirmation?.report.nicheName || confirmation?.report.query} » et son rapport seront supprimés définitivement.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConfirmation(null)} disabled={deleting}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={() => void confirmDeletion()} disabled={deleting}>
              {deleting ? <Spinner /> : <Trash2 />}
              {confirmation?.kind === 'all' ? 'Tout supprimer' : 'Supprimer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
