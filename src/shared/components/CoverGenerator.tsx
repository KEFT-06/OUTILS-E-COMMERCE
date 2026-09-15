import { useEffect, useState } from 'react';
import { ImageIcon, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { type CoverView, coversApi } from '@/shared/lib/covers';
import { toApiError } from '@/shared/lib/apiError';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group';

/**
 * Image de couverture générée par IA, pour le PDF d'un guide ou d'un ebook.
 *
 * L'image ne contient aucun texte : le titre est posé par la mise en page, dans
 * la langue de chaque export. Elle est conservée sur le compte, pas chez le
 * fournisseur, qui efface ses fichiers après quelques jours.
 */

const STYLES = [
  { value: 'illustration', label: 'Illustration' },
  { value: 'photo', label: 'Photo' },
  { value: 'minimal', label: 'Minimaliste' },
] as const;

type Style = (typeof STYLES)[number]['value'];

const POLL_MS = 5_000;

export function CoverGenerator({
  subject,
  subjectId,
  title,
  subtitle,
  onChange,
  className,
}: {
  subject: 'guide' | 'product';
  subjectId: string;
  title: string;
  subtitle?: string;
  onChange?: (cover: CoverView | null) => void;
  className?: string;
}) {
  const { runWithCredits } = useCreditGate();
  const [cover, setCover] = useState<CoverView | null>(null);
  const [loading, setLoading] = useState(true);
  const [style, setStyle] = useState<Style>('illustration');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (next: CoverView | null) => {
    setCover(next);
    onChange?.(next);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    coversApi
      .latest(subject, subjectId)
      .then((found) => {
        if (!cancelled) apply(found);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, subjectId]);

  const pendingId = cover?.status === 'pending' ? cover.id : null;
  useEffect(() => {
    if (!pendingId) return;
    const timer = window.setInterval(() => {
      coversApi
        .refresh(pendingId)
        .then((next) => {
          if (next.status !== 'pending') apply(next);
          if (next.status === 'failed') setError('La génération a échoué : vos points ont été rendus. Essayez un autre style ou une autre description.');
        })
        .catch((caught: unknown) => {
          setError(toApiError(caught, 'Le suivi de la couverture a échoué.').message);
          window.clearInterval(timer);
        });
    }, POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await runWithCredits('cover_generation', () =>
        coversApi.create({
          subject,
          subjectId,
          title,
          ...(subtitle?.trim() ? { subtitle: subtitle.trim().slice(0, 300) } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          style,
        }),
      );
      if (created) apply(created.status === 'failed' ? cover : created);
    } catch (caught) {
      setError(toApiError(caught, 'La couverture n’a pas pu être lancée.').message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!cover) return;
    setBusy(true);
    setError(null);
    try {
      await coversApi.remove(cover.id);
      apply(null);
    } catch (caught) {
      setError(toApiError(caught, 'La couverture n’a pas pu être retirée.').message);
    } finally {
      setBusy(false);
    }
  };

  const ready = cover?.status === 'ready';
  const pending = cover?.status === 'pending';

  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row', className)}>
      <div
        className="relative flex aspect-[9/16] w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted sm:w-36"
        aria-busy={pending || loading}
      >
        {ready ? (
          <img src={coversApi.imageUrl(cover)} alt={`Couverture de « ${title} »`} className="size-full object-cover" />
        ) : pending ? (
          <div className="flex flex-col items-center gap-2 p-2 text-center text-xs text-muted-foreground" role="status">
            <Spinner />
            Génération en cours, environ une minute
          </div>
        ) : loading ? (
          <Spinner />
        ) : (
          <ImageIcon className="size-8 text-muted-foreground/60" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1.5">
          <Label id={`cover-style-${subjectId}`}>Style</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={style}
            onValueChange={(value) => value && setStyle(value as Style)}
            aria-labelledby={`cover-style-${subjectId}`}
            className="flex-wrap"
          >
            {STYLES.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`cover-description-${subjectId}`}>Ce que l’image doit montrer (facultatif)</Label>
          <Textarea
            id={`cover-description-${subjectId}`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Ex. une jeune éleveuse dans une cour ensoleillée, avec quelques poules"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void generate()} disabled={busy || pending || title.trim().length < 2}>
            {busy ? <Spinner /> : ready ? <RefreshCw /> : <Sparkles />}
            {ready ? 'Régénérer' : 'Générer la couverture'}
          </Button>
          {cover && !pending && (
            <Button type="button" size="sm" variant="ghost" onClick={() => void remove()} disabled={busy}>
              <Trash2 />
              Retirer
            </Button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Image sans texte : le titre est posé par la mise en page, dans la langue de chaque export. Elle reste sur votre compte.
        </p>
        {error && (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
