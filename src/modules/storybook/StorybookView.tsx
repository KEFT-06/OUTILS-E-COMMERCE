import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Download, PenLine, Sparkles } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { PageHeader } from '@/shared/components/PageHeader';
import { ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { useAuth } from '@/features/auth/AuthContext';
import { CountryCombobox } from '@/shared/components/CountryCombobox';
import { guessCountryCode } from '@/shared/lib/geo';
import { type StoryDraft, type StorybookBrief, storybookPdfPath } from '@/shared/types/storybook';
import { StorybookLibrary } from '@/modules/storybook/StorybookLibrary';
import { StoryPreviewPanel } from '@/modules/storybook/StoryPreviewPanel';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';
import { useScreenMemory } from '@/shared/lib/apiCache';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { storybookBriefOf } from '@/shared/lib/analysisDefaults';
import { culturalElementsOf } from '@/shared/lib/culturalElements';
import { usePrefill } from '@/shared/lib/prefill';

/**
 * Storybook africain : le conte est rédigé, relu et corrigé par son auteur, puis enregistré ; le PDF
 * se télécharge depuis le site. Les éléments culturels — proposés d'après le pays d'ancrage (voir
 * culturalElements.ts) et corrigés par l'auteur — nourrissent l'histoire.
 *
 * Les contes ne sont plus illustrés depuis le 28/10/2026 (génération d'images retirée du site) ;
 * ceux qui l'ont été restent téléchargeables dans « Mes contes ».
 */

const INITIAL_BRIEF: StorybookBrief = {
  country: 'CI',
  language: 'fr',
  ageRange: '6-8',
  pages: 8,
  heroName: '',
  heroDescription: '',
  theme: '',
  culturalElements: '',
  visualStyle: '',
};

export function StorybookView() {
  const { runWithCredits } = useCreditGate();

  const { account } = useAuth();
  // Le brief en cours et le conte écrit en attente de relecture se retrouvent en revenant sur l'écran.
  const [brief, setBrief] = useScreenMemory<StorybookBrief>('storybook.brief', () => ({
    ...INITIAL_BRIEF,
    country: account?.country ?? guessCountryCode() ?? INITIAL_BRIEF.country,
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  /** Conte écrit, en attente de relecture. Null : rien à relire pour l’instant. */
  const [story, setStory] = useScreenMemory<StoryDraft | null>('storybook.conte', null);
  /** Conte enregistré : son PDF se télécharge. */
  const [result, setResult] = useState<{ storybookId: string } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [title, setTitle] = useScreenMemory<string | null>('storybook.titre', null);
  /** Change à chaque conte créé : la liste « Mes contes » se recharge. */
  const [libraryVersion, setLibraryVersion] = useState(0);

  // Le suivi s'arrête si l'écran est quitté. Remis à false au montage (mode strict).
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const update = <K extends keyof StorybookBrief>(key: K, value: StorybookBrief[K]) =>
    setBrief((previous) => ({ ...previous, [key]: value }));

  // Le brief s'ouvre prêt à lancer : un personnage, un thème tiré de la niche analysée, un style. Tout se change.
  const { currentReport } = useWorkspace();
  const propose = storybookBriefOf(currentReport);
  usePrefill(brief.heroName, (value) => update('heroName', value), propose.heroName, 'storybook.prenom');
  usePrefill(brief.heroDescription ?? '', (value) => update('heroDescription', value), propose.heroDescription, 'storybook.personnage');
  usePrefill(brief.theme, (value) => update('theme', value), propose.theme, 'storybook.theme');
  // D'après le pays d'ancrage : la case suit le pays tant que l'auteur ne l'a pas retouchée.
  usePrefill(brief.culturalElements ?? '', (value) => update('culturalElements', value), culturalElementsOf(brief.country), 'storybook.culture');

  /*
    Nombre de pages : saisi en texte, borné en quittant le champ.

    Il était borné à chaque frappe, si bien qu'on ne pouvait pas TAPER un nombre de 10 à 19 :
    le « 1 » devenait aussitôt 4, puis le « 2 » faisait « 42 », ramené à 20. Seules les
    flèches y menaient.
  */
  const [pagesDraft, setPagesDraft] = useState(() => String(brief.pages));
  const bornerPages = (texte: string) => Math.min(20, Math.max(4, Math.round(Number(texte)) || 4));
  const saisirPages = (texte: string) => {
    setPagesDraft(texte);
    const lu = Number(texte);
    if (Number.isInteger(lu) && lu >= 4 && lu <= 20) update('pages', lu);
  };
  const validerPages = () => {
    const borne = bornerPages(pagesDraft);
    setPagesDraft(String(borne));
    update('pages', borne);
  };

  const canSubmit = brief.heroName.trim().length > 0 && brief.theme.trim().length >= 3 && !isSaving;

  const requestBody = () => {
    const optional = (value: string | undefined) => (value && value.trim() ? value.trim() : undefined);
    return {
      country: brief.country,
      language: brief.language,
      ageRange: brief.ageRange,
      pages: brief.pages,
      heroName: brief.heroName.trim(),
      theme: brief.theme.trim(),
      heroDescription: optional(brief.heroDescription),
      culturalElements: optional(brief.culturalElements),
    };
  };

  /**
   * Première étape : écrire le conte, et rien de plus.
   *
   * L'auteur lit son histoire, la corrige, puis l'enregistre — sans payer de nouveau.
   */
  const ecrireLeConte = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setResult(null);
    setTitle(null);
    setStory(null);

    try {
      await runWithCredits('storybook_story', async () => {
        setIsWriting(true);
        try {
          const response = await fetch('/api/storybook/stories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody()),
          });
          if (!response.ok) throw await readApiError(response, `L’écriture a échoué (${response.status}).`);
          const { story: ecrit } = (await response.json()) as { story: StoryDraft };
          setStory(ecrit);
          setTitle(ecrit.title);
        } finally {
          if (!unmountedRef.current) setIsWriting(false);
        }
      });
    } catch (caught) {
      if (!unmountedRef.current) setError(toApiError(caught, 'L’écriture du conte a échoué.'));
    }
  };


  /** Seconde étape : enregistrer le conte tel que l'auteur vient de le relire, corrections comprises. Gratuit. */
  const enregistrer = async (approuve: StoryDraft) => {
    setError(null);
    setIsSaving(true);
    try {
      const response = await fetch('/api/storybook/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody(), story: approuve }),
      });
      if (!response.ok) throw await readApiError(response, `L’enregistrement a échoué (${response.status}).`);
      const saved = (await response.json()) as { storybookId: string; title: string };
      if (unmountedRef.current) return;
      setTitle(saved.title);
      setResult({ storybookId: saved.storybookId });
      setStory(null);
      setLibraryVersion((version) => version + 1);
    } catch (caught) {
      if (!unmountedRef.current) setError(toApiError(caught, 'L’enregistrement du conte a échoué.'));
    } finally {
      if (!unmountedRef.current) setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Créer"
        title="Storybook"
        description="Des contes ancrés dans le pays de vos lecteurs, à relire, corriger et télécharger en PDF."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4 text-brand-green-text" aria-hidden="true" />
            Brief du conte
          </CardTitle>
          <CardDescription>Le prénom du personnage et le thème suffisent pour écrire le conte.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={ecrireLeConte} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="story-country">Pays d’ancrage</FieldLabel>
                <CountryCombobox id="story-country" value={brief.country} onChange={(value) => update('country', value)} />
              </Field>

              <Field>
                <FieldLabel htmlFor="story-language">Langue</FieldLabel>
                <Select value={brief.language} onValueChange={(value) => update('language', value as StorybookBrief['language'])}>
                  <SelectTrigger id="story-language" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="en">Anglais</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="story-age">Âge des lecteurs</FieldLabel>
                <Select value={brief.ageRange} onValueChange={(value) => update('ageRange', value as StorybookBrief['ageRange'])}>
                  <SelectTrigger id="story-age" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3-5">3 à 5 ans</SelectItem>
                    <SelectItem value="6-8">6 à 8 ans</SelectItem>
                    <SelectItem value="9-12">9 à 12 ans</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="story-pages">Pages</FieldLabel>
                <Input
                  id="story-pages"
                  type="number"
                  min={4}
                  max={20}
                  value={pagesDraft}
                  onChange={(event) => saisirPages(event.target.value)}
                  onBlur={validerPages}
                />
                <FieldDescription>Entre 4 et 20.</FieldDescription>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="story-hero">Prénom du personnage principal</FieldLabel>
                <Input
                  id="story-hero"
                  value={brief.heroName}
                  onChange={(event) => update('heroName', event.target.value)}
                  maxLength={60}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="story-hero-description">Description du personnage</FieldLabel>
                <Input
                  id="story-hero-description"
                  value={brief.heroDescription}
                  onChange={(event) => update('heroDescription', event.target.value)}
                  maxLength={300}
                  placeholder="âge, apparence, trait de caractère"
                />
              </Field>

              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="story-theme">Thème et message du conte</FieldLabel>
                <Input
                  id="story-theme"
                  value={brief.theme}
                  onChange={(event) => update('theme', event.target.value)}
                  maxLength={300}
                  placeholder="ex. le courage d’avouer une erreur"
                />
              </Field>

              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="story-culture">Éléments culturels à intégrer (facultatif)</FieldLabel>
                <Textarea
                  id="story-culture"
                  value={brief.culturalElements}
                  onChange={(event) => update('culturalElements', event.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="prénoms, lieux, plats, fêtes, proverbes que vous connaissez et souhaitez voir figurer"
                />
              </Field>

            </div>

            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-relaxed text-muted-foreground">Vous relisez l’histoire avant de l’enregistrer.</p>
              <Button type="submit" disabled={!canSubmit || isWriting} className="shrink-0">
                {isWriting ? <Spinner /> : <Sparkles />}
                {isWriting ? 'Écriture en cours…' : 'Écrire le conte'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {story && !result && <StoryPreviewPanel story={story} busy={isSaving} onSave={(approuve) => void enregistrer(approuve)} onRewrite={() => setStory(null)} />}

      {error && (
        <Alert variant="danger">
          <AlertTriangle />
          <AlertTitle>Le conte n’a pas pu être écrit ou enregistré</AlertTitle>
          <AlertDescription>
            <p>{error.message}</p>
            {error.findings.length > 0 && (
              <ul className="mt-2 w-full space-y-2">
                {error.findings.map((finding, index) => (
                  <li key={`${finding.category}-${index}`} className="rounded-md border border-danger-border bg-card p-3">
                    <p className="text-xs font-semibold tracking-wider text-danger uppercase">{finding.category}</p>
                    <p className="mt-1 font-medium">« {finding.matched} »</p>
                    <p className="mt-1.5 flex items-start gap-1.5 text-muted-foreground">
                      <PenLine className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {finding.rewriteHint}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      {result && (
        <Card className="border-success-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
              {title ? `« ${title} » est prêt` : 'Votre conte est prêt'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <a href={storybookPdfPath(result.storybookId)} download>
                  <Download />
                  Télécharger le PDF
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <StorybookLibrary version={libraryVersion} />
    </div>
  );
}
