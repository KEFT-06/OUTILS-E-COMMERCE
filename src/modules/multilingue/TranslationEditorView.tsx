import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, BadgeCheck, Check, Lock, RefreshCw, Save, UserRoundCheck } from 'lucide-react';
import { REVIEW_LEVELS } from '@server/shared/guides';
import { findLanguage } from '@server/shared/languages';
import { ACCOUNT_PATH } from '@/app/navigation';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { ExportMenu, LevelBadge, StatusBadge } from '@/modules/multilingue/GuideBadges';
import { type Guide, guidesApi } from '@/modules/multilingue/guidesApi';
import { CheckList, SideBySideEditor, type TextDocument } from '@/modules/multilingue/SideBySideEditor';
import { useProviders } from '@/shared/hooks/useProviders';
import { PageHeader } from '@/shared/components/PageHeader';
import { toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Checkbox } from '@/shared/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog';
import { Label } from '@/shared/ui/label';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/** Relecture d'une traduction par son auteur : original et traduction côte à côte, niveaux C → B → A. */

function ReviewRequestDialog({ disabled, onConfirm }: { disabled: boolean; onConfirm: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <UserRoundCheck />
          Demander une relecture native
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Relecture par un locuteur natif</DialogTitle>
          <DialogDescription>
            Un relecteur dont c’est la langue maternelle corrige tournures, ton et références culturelles. Vos points sont rendus si
            vous annulez avant qu’il prenne la demande en charge.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="review-note">Consignes pour le relecteur (facultatif)</Label>
          <Textarea
            id="review-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Ex. public du Nigeria, ton chaleureux, vocabulaire simple"
          />
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id="review-consent" checked={consent} onCheckedChange={(value) => setConsent(value === true)} className="mt-0.5" />
          <Label htmlFor="review-consent" className="text-sm leading-relaxed font-normal">
            J’accepte qu’un relecteur de Smart Creator lise ce guide et sa traduction pour les corriger. Il n’y a plus accès une fois
            la relecture rendue.
          </Label>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button
            disabled={!consent}
            onClick={() => {
              setOpen(false);
              onConfirm(note);
            }}
          >
            Continuer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
          done ? 'border-success bg-success text-white' : 'text-muted-foreground',
        )}
        aria-hidden="true"
      >
        {done ? <Check className="size-3.5" /> : null}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium">
          {title}
          <span className="sr-only">{done ? ' : atteint' : ' : pas encore atteint'}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

export function TranslationEditorView() {
  const { guideId = '', language = '' } = useParams();
  const { account, refresh } = useAuth();
  const { runWithCredits } = useCreditGate();
  const providers = useProviders();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TextDocument | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const adopt = (next: Guide) => {
    setGuide(next);
    const current = next.translations.find((candidate) => candidate.language === language);
    setDraft(current ? { title: current.title, sections: current.sections } : null);
  };

  useEffect(() => {
    let cancelled = false;
    guidesApi
      .get(guideId)
      .then((loaded) => {
        if (!cancelled) adopt(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'La traduction n’a pas pu être chargée.').message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideId, language]);

  const translation = guide?.translations.find((candidate) => candidate.language === language) ?? null;
  const target = findLanguage(language);
  const dirty = Boolean(
    translation && draft && (draft.title !== translation.title || JSON.stringify(draft.sections) !== JSON.stringify(translation.sections)),
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const act = async (key: string, work: () => Promise<Guide | null>, success: string) => {
    setBusy(key);
    try {
      const next = await work();
      if (next) {
        adopt(next);
        toast.success(success);
      }
    } catch (caught) {
      toast.error('Action impossible', { description: toApiError(caught, 'L’action a échoué.').message });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const backLink = (
    <Button variant="ghost" size="sm" asChild className="-ml-2 max-w-full">
      <Link to={guide ? `/app/multilingue/${guide.id}` : '/app/multilingue'}>
        <ArrowLeft />
        <span className="truncate">{guide?.title ?? 'Guides multilingues'}</span>
      </Link>
    </Button>
  );

  if (error || (guide && (!translation || !draft))) {
    return (
      <div className="space-y-4">
        {backLink}
        <Alert variant="danger">
          <AlertDescription>{error ?? 'Ce guide n’a pas de traduction dans cette langue.'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!guide || !translation || !draft) {
    return (
      <div className="space-y-4" role="status" aria-label="Chargement de la traduction">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const editable = translation.status === 'ready';
  const errors = translation.checks.filter((check) => check.severity === 'error').length;
  const warnings = translation.checks.length - errors;
  const canNativeReview = account?.features.native_review ?? false;
  const languageLabel = target?.fr.toLowerCase() ?? language;

  return (
    <div className="space-y-6 pb-28 md:pb-20">
      {backLink}
      <PageHeader
        eyebrow="Guides multilingues"
        title={`Traduction en ${languageLabel}`}
        description="L’original à gauche, la traduction à droite. Corrigez ce qui sonne faux, puis validez : la traduction passe au niveau B."
        actions={<ExportMenu guide={guide} language={language} />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <LevelBadge level={translation.level} />
        <StatusBadge status={translation.status} />
        {translation.outdated && <Badge variant="warning">Guide modifié depuis</Badge>}
        <span className="text-sm text-muted-foreground tabular-nums">{translation.words.toLocaleString('fr-FR')} mots</span>
      </div>

      {translation.outdated && editable && (
        <Alert variant="warning">
          <AlertTitle>Le guide a changé depuis cette traduction</AlertTitle>
          <AlertDescription>
            <p>Retraduisez-le, ou mettez la traduction à jour vous-même puis validez-la.</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={busy !== null || providers?.text === false}
              onClick={() =>
                void act('retranslate', () => runWithCredits('guide_translation', () => guidesApi.retranslate(guide.id, language)), 'Traduction mise à jour')
              }
            >
              {busy === 'retranslate' ? <Spinner /> : <RefreshCw />}
              Retraduire
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {translation.status === 'review_requested' && (
        <Alert variant="info">
          <AlertTitle>Relecture native demandée le {formatDateFr(translation.reviewRequestedAt ?? translation.updatedAt)}</AlertTitle>
          <AlertDescription>
            <p>En attente d’un relecteur. Vous pouvez annuler tant que personne ne l’a prise en charge : vos points seront rendus.</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={busy !== null}
              onClick={() => void act('cancel', () => guidesApi.cancelReview(guide.id, language), 'Demande annulée, points rendus')}
            >
              {busy === 'cancel' && <Spinner />}
              Annuler la demande
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {translation.status === 'in_review' && (
        <Alert variant="info">
          <Lock />
          <AlertTitle>Un relecteur natif travaille sur cette traduction</AlertTitle>
          <AlertDescription>
            Prise en charge le {formatDateFr(translation.reviewClaimedAt ?? translation.updatedAt)}. Le texte reste en lecture seule jusqu’à
            la fin de sa relecture.
          </AlertDescription>
        </Alert>
      )}

      {translation.level === 'A' && translation.reviewedAt && (
        <Alert variant="success">
          <BadgeCheck />
          <AlertTitle>Relue par un locuteur natif le {formatDateFr(translation.reviewedAt)}</AlertTitle>
          {translation.reviewerComment && <AlertDescription>« {translation.reviewerComment} »</AlertDescription>}
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Niveau de relecture</h2>
          </CardTitle>
          <CardDescription>Chaque export indique le niveau atteint.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            <Step done title={`${REVIEW_LEVELS.C.name} · ${REVIEW_LEVELS.C.short}`}>
              <p className="text-xs text-muted-foreground">
                {errors === 0 && warnings === 0
                  ? 'Contrôles automatiques : rien à signaler.'
                  : `Contrôles automatiques : ${errors} erreur${errors > 1 ? 's' : ''}, ${warnings} point${warnings > 1 ? 's' : ''} à vérifier.`}
              </p>
            </Step>
            <Step done={Boolean(translation.authorValidatedAt) || translation.level === 'A'} title={`${REVIEW_LEVELS.B.name} · ${REVIEW_LEVELS.B.short}`}>
              {translation.authorValidatedAt ? (
                <p className="text-xs text-muted-foreground">Validée le {formatDateFr(translation.authorValidatedAt)}.</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{REVIEW_LEVELS.B.description}</p>
                  <Button
                    size="sm"
                    disabled={!editable || dirty || errors > 0 || busy !== null}
                    onClick={() => void act('validate', () => guidesApi.validate(guide.id, language), 'Traduction validée : niveau B')}
                  >
                    {busy === 'validate' ? <Spinner /> : <Check />}
                    Valider la traduction
                  </Button>
                  {dirty && <p className="text-xs text-muted-foreground">Enregistrez d’abord vos modifications.</p>}
                  {errors > 0 && <p className="text-xs text-danger">Corrigez d’abord les erreurs signalées.</p>}
                </>
              )}
            </Step>
            <Step done={translation.level === 'A'} title={`${REVIEW_LEVELS.A.name} · ${REVIEW_LEVELS.A.short}`}>
              <p className="text-xs text-muted-foreground">{REVIEW_LEVELS.A.description}</p>
              {translation.level !== 'A' &&
                translation.status === 'ready' &&
                (canNativeReview ? (
                  <ReviewRequestDialog
                    disabled={dirty || errors > 0 || translation.outdated || busy !== null}
                    onConfirm={(note) =>
                      void act(
                        'review',
                        () => runWithCredits('native_review', () => guidesApi.requestReview(guide.id, language, note)),
                        'Relecture native demandée',
                      )
                    }
                  />
                ) : (
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5" aria-hidden="true" />
                    Pas incluse dans votre palier.
                    <Link to={`${ACCOUNT_PATH}#paliers`} className="font-medium text-foreground underline underline-offset-2">
                      Voir les paliers
                    </Link>
                  </p>
                ))}
            </Step>
          </ol>
        </CardContent>
      </Card>

      <CheckList checks={translation.checks.filter((check) => !check.sectionId)} />

      <SideBySideEditor
        sourceLanguage={guide.sourceLanguage}
        targetLanguage={language}
        source={{ title: guide.title, sections: guide.sections }}
        value={draft}
        onChange={setDraft}
        checks={translation.checks}
        disabled={!editable || busy !== null}
      />

      {editable && (
        <div className="sticky bottom-24 z-10 flex flex-wrap items-center justify-end gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur md:bottom-4">
          <p className="mr-auto text-sm text-muted-foreground" aria-live="polite">
            {dirty
              ? translation.level === 'C'
                ? 'Modifications non enregistrées.'
                : 'Modifications non enregistrées. Enregistrer remet la traduction au niveau C : validez-la ensuite.'
              : 'Tout est enregistré.'}
          </p>
          <Button variant="ghost" size="sm" disabled={!dirty || busy !== null} onClick={() => setDraft({ title: translation.title, sections: translation.sections })}>
            Annuler
          </Button>
          <Button
            size="sm"
            disabled={!dirty || busy !== null}
            onClick={() => void act('save', () => guidesApi.editTranslation(guide.id, language, draft), 'Traduction enregistrée')}
          >
            {busy === 'save' ? <Spinner /> : <Save />}
            Enregistrer
          </Button>
        </div>
      )}
    </div>
  );
}
