import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/AuthContext';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { toApiError } from '@/shared/lib/apiError';
import { MARKET_REPORT_PAGES_CEILING, type EbookJob, ebookApi } from '@/shared/lib/writing';
import { triggerDownload } from '@/shared/lib/download';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { Progress } from '@/shared/ui/progress';
import { Slider } from '@/shared/ui/slider';

/**
 * Dossier stratégique : développe le rapport d'analyse en un document long.
 *
 * Ce que ce dossier apporte n'est pas « plus de faits » — l'étude n'en a pas trouvé
 * davantage — mais leur déploiement : lecture détaillée de chaque constat, options
 * ouvertes, méthode de mise en œuvre, suivi. Le texte distingue explicitement ce que
 * les sources établissent de ce qui relève de la recommandation.
 */

const POLL_MS = 4_000;

const STEP_LABELS: Record<EbookJob['status'], string> = {
  queued: 'Préparation…',
  outline: 'Construction du plan du dossier…',
  writing: 'Rédaction en cours, section par section…',
  completed: 'Dossier terminé.',
  failed: 'La rédaction n’a pas abouti.',
};

interface MarketReportPanelProps {
  reportId: string;
  nicheName: string;
}

export function MarketReportPanel({ reportId, nicheName }: MarketReportPanelProps) {
  const { account } = useAuth();
  const { runWithCredits } = useCreditGate();

  const maxPages = Math.min(account?.limits.ebookPages ?? 15, MARKET_REPORT_PAGES_CEILING);
  const [targetPages, setTargetPages] = useState(() => Math.min(30, maxPages));
  const [job, setJob] = useState<EbookJob | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const collected = useRef<string | null>(null);

  const collect = useCallback(
    async (finished: EbookJob) => {
      if (collected.current === finished.id) return;
      collected.current = finished.id;
      try {
        const result = await ebookApi.result(finished.id);
        const text = [
          result.title,
          '',
          ...result.chapters.flatMap((chapter) => [chapter.title, '', chapter.content, '']),
        ].join('\n');
        triggerDownload(
          new Blob([text], { type: 'text/plain;charset=utf-8' }),
          `dossier-${nicheName.toLowerCase().replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.txt`,
        );
        toast.success('Dossier stratégique prêt', {
          description: `${result.pages} pages environ, ${result.chapters.length} chapitres. Le fichier vient d’être téléchargé.`,
        });
      } catch (error) {
        toast.error('Le dossier n’a pas pu être récupéré', { description: toApiError(error, 'Réessayez dans un moment.').message });
      } finally {
        setJob(null);
      }
    },
    [nicheName],
  );

  // Rédaction lancée avant un rechargement : le suivi la retrouve et reprend.
  useEffect(() => {
    let cancelled = false;
    void ebookApi
      .active()
      .then(({ job: active }) => {
        if (!cancelled && active && active.kind === 'market_report' && active.productId === reportId) setJob(active);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reportId]);

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
            toast.error('Le dossier n’a pas abouti', { description: next.error?.message ?? 'Réessayez dans un moment.', duration: 12_000 });
            return;
          }
          setJob(next);
        })
        .catch(() => {
          // Coupure passagère : la rédaction continue sur le serveur.
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
      const response = await runWithCredits('ebook_longform', () => ebookApi.startMarketReport({ reportId, targetPages }));
      if (!response) return;
      collected.current = null;
      setJob(response.job);
    } catch (error) {
      toast.error('Le dossier n’a pas pu être lancé', { description: toApiError(error, 'Réessayez dans un moment.').message });
    } finally {
      setIsStarting(false);
    }
  };

  const isRunning = job !== null && job.status !== 'completed' && job.status !== 'failed';
  const progress = job && job.sectionsTotal > 0 ? Math.round((job.sectionsDone / job.sectionsTotal) * 100) : 0;
  const minutes = Math.max(2, Math.round((targetPages / 10) * 1.5));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dossier stratégique approfondi</CardTitle>
        <CardDescription>
          Le rapport ci-dessus tient en quelques pages parce qu’il ne dit que ce que les sources établissent. Le dossier
          développe ces mêmes constats : lecture détaillée, options ouvertes, mise en œuvre et suivi. Il distingue
          toujours ce qui est établi de ce qui est recommandé.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
                Vous pouvez quitter cette page : la rédaction continue sur le serveur.
              </AlertDescription>
            </Alert>
            <Progress value={progress} aria-label="Avancement du dossier" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="dossier-pages">Longueur visée</Label>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {targetPages} pages — comptez environ {minutes} minutes
                </span>
              </div>
              <Slider
                id="dossier-pages"
                min={5}
                max={maxPages}
                step={5}
                value={[targetPages]}
                onValueChange={([value]) => setTargetPages(value ?? targetPages)}
              />
              <p className="text-xs text-muted-foreground">
                Jusqu’à {maxPages} pages avec votre palier {account?.plan.label ?? ''}. Un dossier ne dépasse pas{' '}
                {MARKET_REPORT_PAGES_CEILING} pages : au-delà, il se répéterait faute de matière.
              </p>
            </div>

            <Button onClick={() => void start()} disabled={isStarting}>
              {isStarting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileText className="size-4" aria-hidden />}
              Rédiger un dossier de {targetPages} pages
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
