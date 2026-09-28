import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Download, PenLine, Sparkles } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { PageHeader } from '@/shared/components/PageHeader';
import { ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { MAX_POLL_MISSES, lostTrackMessage, pollStatus } from '@/shared/lib/polling';
import { useAuth } from '@/features/auth/AuthContext';
import { CountryCombobox } from '@/shared/components/CountryCombobox';
import { guessCountryCode } from '@/shared/lib/geo';
import { type StoryDraft, type StorybookBrief, type StorybookStatus, storybookPdfPath } from '@/shared/types/storybook';
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

/**
 * Storybook africain : le conte est rédigé, mis en page et illustré une page à la fois ;
 * le PDF se télécharge depuis le site.
 *
 * Trois engagements visibles à l'écran, parce qu'ils conditionnent ce que l'auteur
 * peut promettre à ses propres lecteurs :
 *  - la cohérence du personnage d'une page à l'autre n'est pas garantie ;
 *  - aucun fait culturel n'est inventé : seuls les éléments fournis par l'auteur
 *    servent de références culturelles précises ;
 *  - le conte généré n'a pas été relu par le vérificateur de conformité.
 */

/** Cadence de sondage recommandée par le service de mise en page. */
const POLL_INTERVAL_MS = 5_000;
/** Au-delà, l'écran cesse de suivre ; le serveur continue de vérifier la génération et rend les points si elle échoue. */
const MAX_WAIT_MS = 10 * 60_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const { runWithCredits, costTable } = useCreditGate();
  /*
    Le prix vient de la grille servie par le serveur, jamais d’une constante recopiée ici :
    un tarif affiché sur un bouton et un tarif facturé qui divergent est la pire des
    surprises. Tant que la grille n’est pas chargée, le bouton ne promet aucun chiffre.
  */
  const coutIllustration = costTable?.actions.find((action) => action.id === 'storybook_illustration')?.cost ?? null;

  const { account } = useAuth();
  const [brief, setBrief] = useState<StorybookBrief>(() => ({
    ...INITIAL_BRIEF,
    country: account?.country ?? guessCountryCode() ?? INITIAL_BRIEF.country,
  }));
  const [isGenerating, setIsGenerating] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  /** Conte écrit, en attente de relecture. Null : rien à relire pour l’instant. */
  const [story, setStory] = useState<StoryDraft | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [result, setResult] = useState<StorybookStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [title, setTitle] = useState<string | null>(null);
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

  useEffect(() => {
    if (!isGenerating) return;
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = setInterval(() => setElapsedSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [isGenerating]);

  const update = <K extends keyof StorybookBrief>(key: K, value: StorybookBrief[K]) =>
    setBrief((previous) => ({ ...previous, [key]: value }));

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

  const canSubmit = brief.heroName.trim().length > 0 && brief.theme.trim().length >= 3 && !isGenerating;

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
      visualStyle: optional(brief.visualStyle),
    };
  };

  /**
   * Première étape : écrire le conte, et rien de plus.
   *
   * Elle ne touche pas à la mise en page, donc elle coûte trois points au lieu de quinze.
   * L'auteur lit son histoire avant d'engager l'étape chère — c'est tout l'objet de la
   * séparation, et c'est ce qui permet de recommencer sans payer une illustration perdue.
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

  /** Seconde étape : illustrer le conte tel que l'auteur vient de le valider, corrections comprises. */
  const illustrer = async (approuve: StoryDraft) => {
    setError(null);
    setResult(null);

    try {
      // Points réservés par le serveur au lancement, rendus automatiquement si le conte échoue.
      await runWithCredits('storybook_illustration', async () => {
        setIsGenerating(true);
        try {
          const created = await fetch('/api/storybook/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...requestBody(), story: approuve }),
          });
          if (!created.ok) throw await readApiError(created, `La demande a échoué (${created.status}).`);

          const {
            generationId,
            storybookId,
            title: storyTitle,
          } = (await created.json()) as { generationId: string; storybookId: string; title: string };
          setTitle(storyTitle);
          setLibraryVersion((version) => version + 1);
          const deadline = Date.now() + MAX_WAIT_MS;
          let misses = 0;

          while (Date.now() < deadline) {
            await wait(POLL_INTERVAL_MS);
            if (unmountedRef.current) {
              throw new ApiError("Suivi interrompu : l'écran a été quitté pendant la génération.");
            }

            const status = await pollStatus<StorybookStatus>(
              `/api/storybook/generations/${encodeURIComponent(generationId)}`,
              'Le suivi a échoué',
            );
            if (!status) {
              misses += 1;
              if (misses >= MAX_POLL_MISSES) throw new ApiError(lostTrackMessage('dans « Mes contes » ci-dessous'));
              continue;
            }
            misses = 0;
            if (status.status === 'completed') {
              setResult({ ...status, storybookId: status.storybookId ?? storybookId });
              setLibraryVersion((version) => version + 1);
              return;
            }
            if (status.status === 'failed') {
              setLibraryVersion((version) => version + 1);
              throw new ApiError(status.errorMessage ?? 'La génération a échoué.');
            }
          }

          throw new ApiError(
            'La génération dépasse 10 minutes : suivi abandonné sur cet écran. Si le conte échoue, vos points vous seront rendus automatiquement.',
          );
        } finally {
          if (!unmountedRef.current) setIsGenerating(false);
        }
      });
    } catch (caught) {
      if (!unmountedRef.current) setError(toApiError(caught, 'La génération a échoué.'));
    }
  };


  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Créer"
        title="Storybook illustré"
        description="Des contes illustrés ancrés dans le pays de vos lecteurs : le texte est rédigé, mis en page et illustré page par page, vous téléchargez le PDF."
      />

      <Alert variant="warning">
        <AlertTriangle />
        <AlertTitle>Cohérence du personnage non garantie</AlertTitle>
        <AlertDescription>
          La mise en page ne permet pas de fixer l’apparence d’un personnage d’une illustration à l’autre : Smart Creator transmet la même
          fiche du personnage pour chaque page, sans pouvoir l’imposer. Vérifiez chaque page avant de publier.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4 text-brand-green-text" aria-hidden="true" />
            Brief du conte
          </CardTitle>
          <CardDescription>Le prénom du personnage et le thème suffisent pour lancer la génération.</CardDescription>
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
                <FieldLabel htmlFor="story-culture">Éléments culturels à intégrer</FieldLabel>
                <Textarea
                  id="story-culture"
                  value={brief.culturalElements}
                  onChange={(event) => update('culturalElements', event.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="prénoms, lieux, plats, fêtes, proverbes que vous connaissez et souhaitez voir figurer"
                />
                <FieldDescription>
                  La rédaction n’utilise comme références culturelles précises que ces éléments, et
                  d’éviter caricatures et stéréotypes. Rien n’est inventé à votre place.
                </FieldDescription>
              </Field>

              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="story-style">Style visuel</FieldLabel>
                <Input
                  id="story-style"
                  value={brief.visualStyle}
                  onChange={(event) => update('visualStyle', event.target.value)}
                  maxLength={300}
                  placeholder="facultatif — ex. aquarelle aux couleurs chaudes"
                />
              </Field>
            </div>

            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Le brief passe le vérificateur de conformité avant l’envoi. L’écriture se paie seule : vous lisez
                l’histoire, vous la corrigez, et vous ne payez l’illustration que si elle vous convient.
              </p>
              <Button type="submit" disabled={!canSubmit || isWriting} className="shrink-0">
                {isWriting ? <Spinner /> : <Sparkles />}
                {isWriting ? 'Écriture en cours…' : 'Écrire le conte'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/*
        L'aperçu disparaît dès que l'illustration part : on ne relit plus un texte dont la
        mise en page est déjà lancée, et le laisser affiché inviterait à corriger ce qui
        n'est plus modifiable.
      */}
      {story && !isGenerating && !result && (
        <StoryPreviewPanel
          story={story}
          busy={isGenerating}
          coutIllustration={coutIllustration}
          onIllustrate={(approuve) => void illustrer(approuve)}
          onRewrite={() => setStory(null)}
        />
      )}

      {isGenerating && (
        <Alert variant="info" role="status">
          <Spinner />
          <AlertDescription className="tabular-nums">
            {title
              ? `« ${title} » est rédigé : mise en page et illustration de chaque page en cours`
              : 'Le conte est rédigé, page par page'}{' '}
            — {elapsedSeconds} s écoulées. Comptez en général 2 à 5 minutes.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="danger">
          <AlertTriangle />
          <AlertTitle>La génération n’a pas abouti</AlertTitle>
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

      {result && result.storybookId && (
        <Card className="border-success-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
              Votre conte est prêt
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {result.storybookId && (
                <Button asChild>
                  <a href={storybookPdfPath(result.storybookId)} download>
                    <Download />
                    Télécharger le PDF
                  </a>
                </Button>
              )}
            </div>
            <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              <li>Le texte généré n’a pas été relu par le vérificateur de conformité : relisez-le avant toute diffusion.</li>
              <li>Vérifiez que le personnage reste reconnaissable d’une page à l’autre.</li>
            </ul>
          </CardContent>
        </Card>
      )}

      <StorybookLibrary version={libraryVersion} />
    </div>
  );
}
