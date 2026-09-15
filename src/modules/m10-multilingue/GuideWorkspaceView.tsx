import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, ChevronDown, PenLine, Plus, Save, Trash2 } from 'lucide-react';
import { wordCount, type GuideSection } from '@server/shared/guides';
import { findLanguage, languageName } from '@server/shared/languages';
import { ACCOUNT_PATH } from '@/app/navigation';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { ExportMenu, LevelBadge, StatusBadge } from '@/modules/m10-multilingue/GuideBadges';
import { LanguageMultiPicker, LanguageName, LanguageSelect } from '@/modules/m10-multilingue/LanguagePicker';
import { type Guide, guidesApi } from '@/modules/m10-multilingue/guidesApi';
import { useProviders } from '@/shared/lib/useProviders';
import { CoverGenerator } from '@/shared/components/CoverGenerator';
import { PageHeader } from '@/shared/components/PageHeader';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/** Un guide : ses traductions, son texte original et sa couverture. */

const PREVIEW_SECTIONS = 3;

function firstIssue(error: ApiError): string {
  const issues = (error.details as { issues?: { message?: string }[] } | undefined)?.issues;
  return issues?.[0]?.message ?? error.message;
}

function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } catch (caught) {
                toast.error('Action impossible', { description: toApiError(caught, 'L’action a échoué.').message });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SourceDraft {
  title: string;
  sourceLanguage: string;
  sections: GuideSection[];
  termsText: string;
}

function SourceEditor({ value, onChange, translatedLanguages }: { value: SourceDraft; onChange: (next: SourceDraft) => void; translatedLanguages: string[] }) {
  const direction = findLanguage(value.sourceLanguage)?.direction;
  const update = (index: number, patch: Partial<GuideSection>) =>
    onChange({ ...value, sections: value.sections.map((section, position) => (position === index ? { ...section, ...patch } : section)) });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="source-title">Titre</Label>
          <Input id="source-title" value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} maxLength={200} dir={direction} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="source-language">Langue du texte</Label>
          <LanguageSelect id="source-language" value={value.sourceLanguage} onChange={(code) => onChange({ ...value, sourceLanguage: code })} exclude={translatedLanguages} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="source-terms">Noms à garder tels quels</Label>
        <Input
          id="source-terms"
          value={value.termsText}
          onChange={(event) => onChange({ ...value, termsText: event.target.value })}
          placeholder="Ex. PouletPro, Awa Diallo"
        />
        <p className="text-xs text-muted-foreground">Séparés par des virgules : marque, produit, personne. Ils ne sont jamais traduits.</p>
      </div>

      <ol className="space-y-3">
        {value.sections.map((section, index) => (
          <li key={section.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Titre de la section ${index + 1}`}
                value={section.heading}
                onChange={(event) => update(index, { heading: event.target.value })}
                placeholder={`Section ${index + 1}`}
                maxLength={300}
                dir={direction}
                className="font-medium"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Retirer la section ${index + 1}`}
                disabled={value.sections.length <= 1}
                onClick={() => onChange({ ...value, sections: value.sections.filter((_, position) => position !== index) })}
              >
                <Trash2 />
              </Button>
            </div>
            <Textarea
              aria-label={`Texte de la section ${index + 1}`}
              value={section.body}
              onChange={(event) => update(index, { body: event.target.value })}
              rows={Math.min(14, Math.max(3, Math.ceil(section.body.length / 80)))}
              maxLength={20_000}
              dir={direction}
            />
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange({ ...value, sections: [...value.sections, { id: crypto.randomUUID().slice(0, 12), heading: '', body: '' }] })}
        disabled={value.sections.length >= 60}
      >
        <Plus />
        Ajouter une section
      </Button>
    </div>
  );
}

export function GuideWorkspaceView() {
  const { guideId = '' } = useParams();
  const navigate = useNavigate();
  const { account, refresh } = useAuth();
  const { costTable } = useCreditGate();
  const providers = useProviders();

  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [translating, setTranslating] = useState(false);
  const [source, setSource] = useState<SourceDraft | null>(null);
  const [savingSource, setSavingSource] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    guidesApi
      .get(guideId)
      .then((loaded) => {
        if (!cancelled) setGuide(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'Le guide n’a pas pu être chargé.').message);
      });
    return () => {
      cancelled = true;
    };
  }, [guideId]);

  const backLink = (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <Link to="/app/multilingue">
        <ArrowLeft />
        Guides multilingues
      </Link>
    </Button>
  );

  if (error) {
    return (
      <div className="space-y-4">
        {backLink}
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!guide) {
    return (
      <div className="space-y-4" role="status" aria-label="Chargement du guide">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-xl lg:col-span-2" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  const costPerLanguage = costTable?.actions.find((action) => action.id === 'guide_translation')?.cost ?? 2;
  const remaining = guide.limits.languages === null ? null : Math.max(0, guide.limits.languages - guide.limits.used);
  const unavailable: Record<string, string> = {
    [guide.sourceLanguage]: 'Langue du guide',
    ...Object.fromEntries(guide.translations.map((translation) => [translation.language, 'Déjà traduit'])),
  };
  const total = selected.length * costPerLanguage;
  const unlimited = account?.credits.unlimited ?? false;
  const balance = account?.credits.total ?? 0;
  const insufficient = !unlimited && total > balance;
  const translationsUnavailable = providers?.text === false;

  const translate = async () => {
    setTranslating(true);
    try {
      const { guide: next, failures } = await guidesApi.translate(guide.id, selected);
      setGuide(next);
      const done = selected.length - failures.length;
      if (done > 0) toast.success(done > 1 ? `${done} traductions prêtes` : 'Traduction prête', { description: 'Relisez-les avant de les exporter.' });
      failures.forEach((failure) => toast.error(`${languageName(failure.language)} : pas de traduction`, { description: failure.message }));
      setPickerOpen(false);
      setSelected([]);
    } catch (caught) {
      toast.error('Traduction impossible', { description: toApiError(caught, 'La traduction a échoué.').message });
    } finally {
      setTranslating(false);
      void refresh();
    }
  };

  const saveSource = async () => {
    if (!source) return;
    setSavingSource(true);
    try {
      const next = await guidesApi.update(guide.id, {
        title: source.title,
        sourceLanguage: source.sourceLanguage,
        sections: source.sections,
        terms: source.termsText.split(',').map((term) => term.trim()).filter(Boolean),
      });
      const changed = next.revision !== guide.revision;
      setGuide(next);
      setSource(null);
      toast.success('Guide enregistré', changed && next.translations.length > 0 ? { description: 'Les traductions sont signalées à mettre à jour.' } : undefined);
    } catch (caught) {
      toast.error('Enregistrement impossible', { description: firstIssue(toApiError(caught, 'Le guide n’a pas pu être enregistré.')) });
    } finally {
      setSavingSource(false);
    }
  };

  const visibleSections = showAll ? guide.sections : guide.sections.slice(0, PREVIEW_SECTIONS);
  const direction = findLanguage(guide.sourceLanguage)?.direction;

  return (
    <div className="space-y-6">
      {backLink}
      <PageHeader
        eyebrow="Guides multilingues"
        title={guide.title}
        description={`${languageName(guide.sourceLanguage)} · ${guide.words.toLocaleString('fr-FR')} mots · ${guide.translations.length} traduction${guide.translations.length > 1 ? 's' : ''}`}
        actions={
          <>
            <ExportMenu guide={guide} language={guide.sourceLanguage} />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm" className="text-danger hover:text-danger">
                  <Trash2 />
                  Supprimer
                </Button>
              }
              title="Supprimer ce guide ?"
              description="Le guide, ses traductions et sa couverture sont effacés. Les relectures en attente sont annulées et leurs points rendus."
              confirmLabel="Supprimer le guide"
              onConfirm={async () => {
                await guidesApi.remove(guide.id);
                toast.success('Guide supprimé');
                navigate('/app/multilingue');
              }}
            />
          </>
        }
      />

      {translationsUnavailable && (
        <Alert variant="warning">
          <AlertTitle>Traduction indisponible pour l’instant</AlertTitle>
          <AlertDescription>
            Le service de traduction n’est pas encore configuré sur le serveur. Vous pouvez écrire le guide et préparer sa couverture ; la
            traduction s’ouvrira dès sa mise en service.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Traductions</h2>
              </CardTitle>
              <CardDescription>
                {guide.limits.languages === null
                  ? 'Langues illimitées avec votre palier.'
                  : `${guide.limits.used} langue${guide.limits.used > 1 ? 's' : ''} sur ${guide.limits.languages} avec le palier ${account?.plan.label ?? ''}.`}{' '}
                {costPerLanguage} points par langue.
              </CardDescription>
              <CardAction>
                <Dialog
                  open={pickerOpen}
                  onOpenChange={(open) => {
                    if (!translating) setPickerOpen(open);
                  }}
                >
                  <DialogTrigger asChild>
                    <Button size="sm" disabled={translationsUnavailable || remaining === 0}>
                      <Plus />
                      Ajouter des langues
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Traduire « {guide.title} »</DialogTitle>
                      <DialogDescription>
                        Traduction automatique puis contrôles : chiffres, liens, noms de marque et sections. Vous relirez chaque langue ensuite.
                      </DialogDescription>
                    </DialogHeader>
                    <LanguageMultiPicker selected={selected} onChange={setSelected} unavailable={unavailable} remaining={remaining} />
                    <div className="rounded-lg bg-muted/50 p-3 text-sm" aria-live="polite">
                      {selected.length === 0 ? (
                        'Choisissez une ou plusieurs langues.'
                      ) : (
                        <>
                          {selected.length} langue{selected.length > 1 ? 's' : ''} ×{' '}
                          {costPerLanguage} points = <strong className="tabular-nums">{unlimited ? 'inclus dans votre palier' : `${total} points`}</strong>
                          {!unlimited && ` · solde : ${balance} points`}
                          {insufficient && <span className="block text-danger">Solde insuffisant.</span>}
                          {translating && (
                            <span className="mt-1 flex items-center gap-2 text-muted-foreground">
                              <Spinner />
                              Traduction en cours, comptez environ une minute par langue…
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <DialogFooter className="gap-2 sm:gap-2">
                      <Button variant="outline" onClick={() => setPickerOpen(false)} disabled={translating}>
                        Annuler
                      </Button>
                      <Button onClick={() => void translate()} disabled={selected.length === 0 || insufficient || translating}>
                        {translating && <Spinner />}
                        Traduire
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardAction>
            </CardHeader>
            <CardContent>
              {remaining === 0 && (
                <p className="mb-4 text-sm text-muted-foreground">
                  Toutes les langues de votre palier sont utilisées.{' '}
                  <Link to={`${ACCOUNT_PATH}#paliers`} className="font-medium text-foreground underline underline-offset-2">
                    Voir les paliers
                  </Link>
                </p>
              )}
              {guide.translations.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune traduction. Commencez par les langues les plus parlées au monde.</p>
              ) : (
                <ul className="divide-y">
                  {guide.translations.map((translation) => {
                    const errors = translation.checks.filter((check) => check.severity === 'error').length;
                    const warnings = translation.checks.length - errors;
                    return (
                      <li key={translation.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="font-medium">
                            <LanguageName code={translation.language} />
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <LevelBadge level={translation.level} compact />
                            <StatusBadge status={translation.status} />
                            {translation.outdated && <Badge variant="warning">Guide modifié depuis</Badge>}
                            {errors > 0 && <Badge variant="danger">{errors} erreur{errors > 1 ? 's' : ''}</Badge>}
                            {warnings > 0 && <Badge variant="outline">{warnings} à vérifier</Badge>}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" asChild>
                            <Link to={`/app/multilingue/${guide.id}/${translation.language}`}>
                              <PenLine />
                              Relire
                            </Link>
                          </Button>
                          <ExportMenu guide={guide} language={translation.language} />
                          <ConfirmDialog
                            trigger={
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Supprimer la traduction en ${languageName(translation.language).toLowerCase()}`}
                                disabled={translation.status === 'in_review'}
                              >
                                <Trash2 />
                              </Button>
                            }
                            title={`Supprimer la traduction en ${languageName(translation.language).toLowerCase()} ?`}
                            description="La langue redevient disponible pour ce guide. Une relecture en attente est annulée et ses points rendus ; les points de la traduction ne sont pas rendus."
                            confirmLabel="Supprimer"
                            onConfirm={async () => {
                              setGuide(await guidesApi.removeTranslation(guide.id, translation.language));
                              void refresh();
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Texte original</h2>
              </CardTitle>
              <CardDescription>
                {guide.sections.length} section{guide.sections.length > 1 ? 's' : ''}
                {guide.terms.length > 0 && ` · noms gardés tels quels : ${guide.terms.join(', ')}`}
              </CardDescription>
              <CardAction>
                {source ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSource({ title: guide.title, sourceLanguage: guide.sourceLanguage, sections: guide.sections, termsText: guide.terms.join(', ') })
                    }
                  >
                    <PenLine />
                    Modifier
                  </Button>
                )}
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              {source ? (
                <>
                  {guide.translations.length > 0 && (
                    <Alert variant="info">
                      <AlertDescription>Modifier le texte signale les traductions à mettre à jour.</AlertDescription>
                    </Alert>
                  )}
                  <SourceEditor value={source} onChange={setSource} translatedLanguages={guide.translations.map((translation) => translation.language)} />
                  <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                    <span className="mr-auto self-center text-xs text-muted-foreground tabular-nums">
                      {wordCount(source.sections).toLocaleString('fr-FR')} mots
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setSource(null)} disabled={savingSource}>
                      Annuler
                    </Button>
                    <Button size="sm" onClick={() => void saveSource()} disabled={savingSource || source.title.trim().length < 2}>
                      {savingSource ? <Spinner /> : <Save />}
                      Enregistrer
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-4" lang={guide.sourceLanguage} dir={direction}>
                    {visibleSections.map((section) => (
                      <section key={section.id} className="space-y-1">
                        {section.heading && <h3 className="font-semibold">{section.heading}</h3>}
                        <p className="line-clamp-4 text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{section.body}</p>
                      </section>
                    ))}
                  </div>
                  {guide.sections.length > PREVIEW_SECTIONS && (
                    <Button variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>
                      <ChevronDown className={showAll ? 'rotate-180' : undefined} />
                      {showAll
                        ? 'Réduire'
                        : guide.sections.length - PREVIEW_SECTIONS === 1
                          ? 'Afficher la dernière section'
                          : `Afficher les ${guide.sections.length - PREVIEW_SECTIONS} autres sections`}
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>
              <h2>Couverture du PDF</h2>
            </CardTitle>
            <CardDescription>Une seule image pour toutes les langues : le titre est posé dans la langue de chaque export.</CardDescription>
          </CardHeader>
          <CardContent>
            {providers?.images === false ? (
              <p className="text-sm text-muted-foreground">La génération d’images n’est pas encore configurée sur le serveur.</p>
            ) : (
              <CoverGenerator
                subject="guide"
                subjectId={guide.id}
                title={guide.title}
                className="lg:flex-col"
                onChange={(cover) => setGuide((current) => (current ? { ...current, cover } : current))}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
