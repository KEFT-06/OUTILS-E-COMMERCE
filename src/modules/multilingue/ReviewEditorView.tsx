import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Save, Send, Undo2 } from 'lucide-react';
import { languageName } from '@server/shared/languages';
import { type ReviewDetail, reviewsApi } from '@/modules/multilingue/guidesApi';
import { CheckList, SideBySideEditor, type TextDocument } from '@/modules/multilingue/SideBySideEditor';
import { PageHeader } from '@/shared/components/PageHeader';
import { toApiError } from '@/shared/lib/apiError';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog';
import { Label } from '@/shared/ui/label';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/** Relecture native d'une traduction confiée : corriger, puis rendre. */

const QUEUE_PATH = '/app/multilingue?onglet=relectures';

export function ReviewEditorView() {
  const { translationId = '' } = useParams();
  const navigate = useNavigate();
  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TextDocument | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);

  const adopt = (next: ReviewDetail) => {
    setReview(next);
    setDraft({ title: next.translation.title, sections: next.translation.sections });
  };

  useEffect(() => {
    let cancelled = false;
    reviewsApi
      .get(translationId)
      .then((loaded) => {
        if (!cancelled) adopt(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'La relecture n’a pas pu être chargée.').message);
      });
    return () => {
      cancelled = true;
    };
  }, [translationId]);

  const dirty = Boolean(
    review &&
      draft &&
      (draft.title !== review.translation.title || JSON.stringify(draft.sections) !== JSON.stringify(review.translation.sections)),
  );

  const save = async () => {
    if (!draft) return null;
    const saved = await reviewsApi.save(translationId, draft);
    adopt(saved);
    return saved;
  };

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } catch (caught) {
      toast.error('Action impossible', { description: toApiError(caught, 'L’action a échoué.').message });
    } finally {
      setBusy(null);
    }
  };

  const backLink = (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <Link to={QUEUE_PATH}>
        <ArrowLeft />
        Relectures
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
  if (!review || !draft) {
    return (
      <div className="space-y-4" role="status" aria-label="Chargement de la relecture">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const errors = review.translation.checks.filter((check) => check.severity === 'error').length;

  return (
    <div className="space-y-6 pb-28 md:pb-20">
      {backLink}
      <PageHeader
        eyebrow="Relecture native"
        title={`Relecture en ${languageName(review.to).toLowerCase()}`}
        description={`« ${review.guideTitle} », traduit depuis le ${languageName(review.from).toLowerCase()}. Corrigez tournures, ton et références culturelles, sans changer le sens.`}
      />

      {review.note && (
        <Alert variant="info">
          <AlertTitle>Consignes de l’auteur</AlertTitle>
          <AlertDescription>{review.note}</AlertDescription>
        </Alert>
      )}

      {review.source.terms.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Noms à garder tels quels :</span>
          {review.source.terms.map((term) => (
            <Badge key={term} variant="outline">
              {term}
            </Badge>
          ))}
        </div>
      )}

      <CheckList checks={review.translation.checks.filter((check) => !check.sectionId)} />

      <h2 className="sr-only">Texte à relire</h2>
      <SideBySideEditor
        sourceLanguage={review.from}
        targetLanguage={review.to}
        source={review.source}
        value={draft}
        onChange={setDraft}
        checks={review.translation.checks}
        disabled={busy !== null}
      />

      <div className="sticky bottom-24 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur md:bottom-4">
        <p className="mr-auto text-sm text-muted-foreground" aria-live="polite">
          {dirty ? 'Modifications non enregistrées.' : 'Tout est enregistré.'}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            void run('release', async () => {
              await reviewsApi.release(translationId);
              toast.success('Demande remise dans la file');
              navigate(QUEUE_PATH);
            })
          }
        >
          {busy === 'release' ? <Spinner /> : <Undo2 />}
          Libérer
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!dirty || busy !== null}
          onClick={() =>
            void run('save', async () => {
              await save();
              toast.success('Relecture enregistrée');
            })
          }
        >
          {busy === 'save' ? <Spinner /> : <Save />}
          Enregistrer
        </Button>
        <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={busy !== null || errors > 0}>
              <Send />
              Rendre la relecture
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Rendre la relecture</DialogTitle>
              <DialogDescription>
                La traduction passe au niveau A, « relue par un locuteur natif ». Vous n’y aurez plus accès ensuite.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="review-comment">Mot pour l’auteur (facultatif)</Label>
              <Textarea
                id="review-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Ex. tutoiement remplacé par le vouvoiement, exemples adaptés au marché local"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => setCompleteOpen(false)}>
                Annuler
              </Button>
              <Button
                disabled={busy !== null}
                onClick={() =>
                  void run('complete', async () => {
                    if (dirty) await save();
                    await reviewsApi.complete(translationId, comment);
                    setCompleteOpen(false);
                    toast.success('Relecture rendue, merci !');
                    navigate(QUEUE_PATH);
                  })
                }
              >
                {busy === 'complete' && <Spinner />}
                Rendre
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
