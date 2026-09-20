import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/AuthContext';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { toApiError } from '@/shared/lib/apiError';
import { EBOOK_PAGES_CEILING, type EbookJob, ebookApi } from '@/shared/lib/writing';
import type { DigitalProductIdea } from '@/shared/types/analysis';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Label } from '@/shared/ui/label';
import { Progress } from '@/shared/ui/progress';
import { Slider } from '@/shared/ui/slider';

/**
 * Rédaction d'un ebook long.
 *
 * Écrire deux cents pages ne tient pas dans une requête : le serveur bâtit d'abord un plan,
 * puis rédige section par section, et ce panneau suit l'avancement. Quitter l'écran
 * n'interrompt rien — le travail est enregistré à chaque lot, et le suivi le reprend.
 *
 * Le curseur s'arrête à la limite du palier : la demander plus haut serait refusée par le
 * serveur, autant ne pas la proposer.
 */

/** Cadence du suivi. C'est aussi lui qui relance la tranche suivante côté serveur. */
const POLL_MS = 4_000;

interface LongformEbookPanelProps {
  product: DigitalProductIdea;
  market: string | null;
  /** Reçoit les chapitres rédigés, pour les verser au brouillon. */
  onWritten: (chapters: { title: string; content: string }[], pages: number) => void;
}

const STEP_LABELS: Record<EbookJob['status'], string> = {
  queued: 'Préparation…',
  outline: 'Construction du plan : chapitres et sections…',
  writing: 'Rédaction en cours, section par section…',
  completed: 'Rédaction terminée.',
  failed: 'La rédaction n’a pas abouti.',
};

export function LongformEbookPanel({ product, market, onWritten }: LongformEbookPanelProps) {
  const { account } = useAuth();
  const { runWithCredits } = useCreditGate();

  const maxPages = Math.min(account?.limits.ebookPages ?? 15, EBOOK_PAGES_CEILING);
  const [targetPages, setTargetPages] = useState(() => Math.min(40, maxPages));
  const [job, setJob] = useState<EbookJob | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // Évite de verser deux fois le même texte si deux suivis se croisent à la fin.
  const collected = useRef<string | null>(null);

  const collect = useCallback(
    async (finished: EbookJob) => {
      if (collected.current === finished.id) return;
      collected.current = finished.id;
      try {
        const result = await ebookApi.result(finished.id);
        onWritten(result.chapters, result.pages);
        toast.success('Ebook rédigé', {
          description: `${result.pages} pages environ, ${result.chapters.length} chapitres. Relisez le brouillon avant l’export.`,
        });
      } catch (error) {
        toast.error('Le texte rédigé n’a pas pu être récupéré', { description: toApiError(error, 'Réessayez dans un moment.').message });
      } finally {
        setJob(null);
      }
    },
    [onWritten],
  );

  // Rédaction lancée avant un rechargement de la page : le suivi reprend tout seul.
  useEffect(() => {
    let cancelled = false;
    void ebookApi
      .active()
      .then(({ job: active }) => {
        if (!cancelled && active && active.productId === product.id) setJob(active);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  // Suivi : chaque passage affiche l'avancement et fait repartir le serveur sur la suite.
  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') return;
    let cancelled = false;

    const timer = setInterval(() => {
      void ebookApi
        .follow(job.id)
        .then((response) => {
          if (cancelled) return;
          const next = response.job;
          if (next.status === 'completed') {
            clearInterval(timer);
            void collect(next);
            return;
          }
          if (next.status === 'failed') {
            clearInterval(timer);
            setJob(null);
            toast.error('La rédaction n’a pas abouti', { description: next.error?.message ?? 'Réessayez dans un moment.', duration: 12_000 });
            return;
          }
          setJob(next);
        })
        .catch(() => {
          // Coupure passagère : la rédaction continue sur le serveur, le suivi réessaie.
        });
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job, collect]);

  const start = async () => {
    setIsStarting(true);
    try {
      const response = await runWithCredits('ebook_longform', () =>
        ebookApi.start({
          productId: product.id,
          title: product.title,
          subtitle: product.subtitle,
          typeName: product.typeName,
          targetAudience: product.targetAudience,
          transformationPromise: product.transformationPromise,
          chapters: product.tableOfContents.map((module) => ({
            title: module.title || `Chapitre ${module.moduleNumber}`,
            details: module.details,
          })),
          market,
          targetPages,
        }),
      );
      if (!response) return;
      collected.current = null;
      setJob(response.job);
    } catch (error) {
      toast.error('La rédaction n’a pas pu être lancée', { description: toApiError(error, 'Réessayez dans un moment.').message });
    } finally {
      setIsStarting(false);
    }
  };

  const isRunning = job !== null && job.status !== 'completed' && job.status !== 'failed';
  const progress = job && job.sectionsTotal > 0 ? Math.round((job.sectionsDone / job.sectionsTotal) * 100) : 0;
  // Un ouvrage long demande plusieurs minutes : le dire évite de croire à un blocage.
  const minutes = Math.max(2, Math.round((targetPages / 10) * 1.5));

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <h3 className="font-medium">Rédiger l’ebook complet</h3>
          <p className="text-sm text-muted-foreground">
            Un plan détaillé est bâti d’abord, puis chaque section est rédigée séparément. C’est ce qui permet d’aller
            bien au-delà de quelques pages sans que le texte se répète.
          </p>
        </div>
      </div>

      {isRunning ? (
        <div className="space-y-3">
          <Alert variant="info" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <AlertDescription>
              {STEP_LABELS[job.status]}
              {job.sectionsTotal > 0 && (
                <>
                  {' '}
                  <span className="tabular-nums">
                    {job.sectionsDone} section{job.sectionsDone > 1 ? 's' : ''} sur {job.sectionsTotal} — environ{' '}
                    {job.pagesWritten} page{job.pagesWritten > 1 ? 's' : ''} écrites.
                  </span>
                </>
              )}
              <br />
              Vous pouvez quitter cet écran : la rédaction continue sur le serveur.
            </AlertDescription>
          </Alert>
          <Progress value={progress} aria-label="Avancement de la rédaction" />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="ebook-pages">Longueur visée</Label>
              <span className="text-sm tabular-nums text-muted-foreground">
                {targetPages} pages — comptez environ {minutes} minutes
              </span>
            </div>
            <Slider
              id="ebook-pages"
              min={5}
              max={maxPages}
              step={5}
              value={[targetPages]}
              onValueChange={([value]) => setTargetPages(value ?? targetPages)}
            />
            <p className="text-xs text-muted-foreground">
              Votre palier {account?.plan.label ?? ''} permet {maxPages} pages au plus.
              {maxPages < EBOOK_PAGES_CEILING && ` Un palier supérieur va jusqu’à ${EBOOK_PAGES_CEILING} pages.`}
            </p>
          </div>

          <Button onClick={() => void start()} disabled={isStarting}>
            {isStarting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BookOpen className="size-4" aria-hidden />}
            Rédiger {targetPages} pages
          </Button>
        </>
      )}
    </div>
  );
}
