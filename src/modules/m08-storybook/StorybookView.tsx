import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, ExternalLink, PenLine, Sparkles } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { PageHeader } from '@/shared/components/PageHeader';
import { ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { MARKETS } from '@/shared/lib/markets';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import type { StorybookBrief, StorybookStatus } from '@/shared/types/storybook';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Storybook africain.
 *
 * Trois engagements visibles à l'écran, parce qu'ils conditionnent ce que l'auteur
 * peut promettre à ses propres lecteurs :
 *  - la cohérence du personnage d'une page à l'autre n'est pas garantie ;
 *  - aucun fait culturel n'est inventé : seuls les éléments fournis par l'auteur
 *    servent de références culturelles précises ;
 *  - le conte généré n'a pas été relu par le vérificateur de conformité.
 */

/** Cadence de sondage recommandée par la documentation Gamma. */
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
  const { runWithCredits } = useCreditGate();

  const [brief, setBrief] = useState<StorybookBrief>(INITIAL_BRIEF);
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [result, setResult] = useState<StorybookStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setResult(null);

    try {
      // Points réservés par le serveur au lancement, rendus automatiquement si le conte échoue.
      await runWithCredits('storybook_generation', async () => {
        setIsGenerating(true);
        try {
          const created = await fetch('/api/storybook/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody()),
          });
          if (!created.ok) throw await readApiError(created, `La demande a échoué (${created.status}).`);

          const { generationId } = (await created.json()) as { generationId: string };
          const deadline = Date.now() + MAX_WAIT_MS;

          while (Date.now() < deadline) {
            await wait(POLL_INTERVAL_MS);
            if (unmountedRef.current) {
              throw new ApiError("Suivi interrompu : l'écran a été quitté pendant la génération.");
            }

            const polled = await fetch(`/api/storybook/generations/${encodeURIComponent(generationId)}`);
            if (!polled.ok) throw await readApiError(polled, `Le suivi a échoué (${polled.status}).`);

            const status = (await polled.json()) as StorybookStatus;
            if (status.status === 'completed') {
              setResult(status);
              return;
            }
            if (status.status === 'failed') {
              throw new ApiError(status.errorMessage ?? 'La génération a échoué chez Gamma.');
            }
          }

          throw new ApiError(
            'La génération dépasse 10 minutes : suivi abandonné sur cet écran. Si le conte échoue chez Gamma, vos points vous seront rendus automatiquement.',
          );
        } finally {
          if (!unmountedRef.current) setIsGenerating(false);
        }
      });
    } catch (caught) {
      if (!unmountedRef.current) setError(toApiError(caught, 'La génération a échoué.'));
    }
  };

  const storyUrl = safeHttpUrl(result?.gammaUrl);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Créer"
        title="Storybook africain"
        description="Des contes illustrés ancrés dans le pays de vos lecteurs, générés avec Gamma à partir de votre brief."
      />

      <Alert variant="warning">
        <AlertTriangle />
        <AlertTitle>Cohérence du personnage non garantie</AlertTitle>
        <AlertDescription>
          Gamma ne permet pas de fixer l’apparence d’un personnage d’une illustration à l’autre : Smart Creator le demande
          explicitement, sans pouvoir l’imposer. Vérifiez chaque page avant de publier.
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
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="story-country">Pays d’ancrage</FieldLabel>
                <Select value={brief.country} onValueChange={(value) => update('country', value)}>
                  <SelectTrigger id="story-country" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKETS.map((market) => (
                      <SelectItem key={market.code} value={market.code}>
                        {market.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  value={brief.pages}
                  onChange={(event) => update('pages', Math.min(20, Math.max(4, Number(event.target.value) || 4)))}
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
                  Gamma reçoit la consigne de n’utiliser comme références culturelles précises que ces éléments, et
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
                Le brief passe le vérificateur de conformité avant l’envoi. Le coût en points s’affiche avant validation ;
                restez sur cet écran pendant la génération.
              </p>
              <Button type="submit" disabled={!canSubmit} className="shrink-0">
                {isGenerating ? <Spinner /> : <Sparkles />}
                {isGenerating ? 'Génération en cours…' : 'Générer le conte'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isGenerating && (
        <Alert variant="info" role="status">
          <Spinner />
          <AlertDescription className="tabular-nums">
            Gamma rédige et illustre le conte : {elapsedSeconds} s écoulées. Comptez en général 1 à 3 minutes.
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

      {result && storyUrl && (
        <Card className="border-success-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
              Votre conte est prêt
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button asChild>
              <a href={storyUrl} target="_blank" rel="noopener noreferrer">
                Ouvrir le conte dans Gamma
                <ExternalLink />
              </a>
            </Button>
            <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              <li>Le texte généré n’a pas été relu par le vérificateur de conformité : relisez-le avant toute diffusion.</li>
              <li>Vérifiez que le personnage reste reconnaissable d’une page à l’autre.</li>
              <li>Toute personne disposant de ce lien peut consulter le conte.</li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
