import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Bookmark, BookmarkCheck, ChevronDown, Plus, Search, Sparkles, X } from 'lucide-react';
import { searchKey } from '@server/shared/countries';
import { ACCOUNT_PATH } from '@/app/navigation';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { NICHE_COUNT, NICHE_SECTORS } from '@/data/nicheCatalog';
import { PageHeader } from '@/shared/components/PageHeader';
import { toApiError } from '@/shared/lib/apiError';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty';
import { Input } from '@/shared/ui/input';
import { Progress } from '@/shared/ui/progress';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Catalogue des niches, tous secteurs confondus, et niches enregistrées.
 *
 * Le nombre de niches qu'un compte peut enregistrer dépend de son palier : le
 * serveur refuse au-delà, l'écran l'annonce avant.
 */

const PREVIEW_COUNT = 5;

export function NichesView() {
  const navigate = useNavigate();
  const { account, saveNiche, removeNiche } = useAuth();
  const { analyzeNiche, isAnalyzing } = useWorkspace();
  const [query, setQuery] = useState('');
  const [sectorId, setSectorId] = useState('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [custom, setCustom] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const saved = useMemo(() => account?.savedNiches ?? [], [account?.savedNiches]);
  const limit = account ? account.limits.savedNiches : 0;
  const full = limit !== null && saved.length >= limit;
  const savedKeys = useMemo(() => new Set(saved.map(searchKey)), [saved]);

  const key = searchKey(query);
  const results = useMemo(
    () =>
      NICHE_SECTORS.filter((sector) => sectorId === 'all' || sector.id === sectorId)
        .map((sector) => ({
          sector,
          niches:
            !key || searchKey(sector.label).includes(key)
              ? sector.niches
              : sector.niches.filter((niche) => searchKey(niche).includes(key)),
        }))
        .filter((entry) => entry.niches.length > 0),
    [key, sectorId],
  );
  const matchCount = results.reduce((total, entry) => total + entry.niches.length, 0);

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

  const addCustom = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = custom.trim();
    if (name.length < 2) return;
    await toggle(name);
    setCustom('');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voir"
        title="Niches"
        description={`${NICHE_COUNT} niches dans ${NICHE_SECTORS.length} secteurs : santé, nutrition, tech, IA, mines et pétrole, agriculture, finance… Enregistrez celles que vous suivez, puis lancez leur analyse.`}
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
              Aucune niche enregistrée. Utilisez le signet d’une niche du catalogue, ou ajoutez la vôtre ci-dessous.
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

          <form onSubmit={(event) => void addCustom(event)} className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="custom-niche" className="sr-only">
              Ajouter une niche absente du catalogue
            </label>
            <Input
              id="custom-niche"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              maxLength={200}
              placeholder="Ajouter une niche absente du catalogue"
              disabled={full}
            />
            <Button type="submit" variant="outline" disabled={full || custom.trim().length < 2 || pending !== null}>
              <Plus />
              Ajouter
            </Button>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="catalogue-titre" className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 id="catalogue-titre" className="font-display text-xl font-extrabold tracking-tight">
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

        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="flex w-max gap-2" role="group" aria-label="Filtrer par secteur">
            <Button size="sm" variant={sectorId === 'all' ? 'secondary' : 'outline'} aria-pressed={sectorId === 'all'} onClick={() => setSectorId('all')}>
              Tous les secteurs
            </Button>
            {NICHE_SECTORS.map((sector) => (
              <Button
                key={sector.id}
                size="sm"
                variant={sectorId === sector.id ? 'secondary' : 'outline'}
                aria-pressed={sectorId === sector.id}
                onClick={() => setSectorId(sector.id)}
              >
                {sector.label}
              </Button>
            ))}
          </div>
        </div>

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {matchCount} niche{matchCount > 1 ? 's' : ''}
          {key ? ` pour « ${query.trim()} »` : ''}
        </p>

        {matchCount === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>Aucune niche ne correspond</EmptyTitle>
              <EmptyDescription>Essayez un autre mot, ou ajoutez cette niche à vos niches enregistrées.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {results.map(({ sector, niches }) => {
              const Icon = sector.icon;
              const showAll = Boolean(key) || expanded[sector.id];
              const visible = showAll ? niches : niches.slice(0, PREVIEW_COUNT);
              return (
                <Card key={sector.id} className="gap-4">
                  <CardHeader>
                    <CardTitle>
                      <h3 className="flex items-center gap-2">
                        <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                          <Icon className="size-4" aria-hidden="true" />
                        </span>
                        {sector.label}
                        <Badge variant="outline" className="ml-auto tabular-nums">
                          {sector.niches.length}
                        </Badge>
                      </h3>
                    </CardTitle>
                    <CardDescription>{sector.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="divide-y">
                      {visible.map((niche) => {
                        const isSaved = savedKeys.has(searchKey(niche));
                        return (
                          <li key={niche} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                            <span className="min-w-0 flex-1 text-sm">{niche}</span>
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
                          </li>
                        );
                      })}
                    </ul>
                    {!showAll && niches.length > PREVIEW_COUNT && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2 w-full"
                        onClick={() => setExpanded((previous) => ({ ...previous, [sector.id]: true }))}
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
    </div>
  );
}
