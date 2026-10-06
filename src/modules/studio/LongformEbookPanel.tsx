import { useState } from 'react';
import { BookOpen, Loader2, X } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import type { EbookJobFollow } from '@/modules/studio/useEbookJob';
import { EBOOK_PAGES_CEILING, type EbookJob } from '@/shared/lib/writing';
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
 *
 * Le suivi lui-même vit dans le Studio (useEbookJob) : la rédaction du contenu d'un produit
 * (« Génératif ») passe par le même moteur, et son avancement s'affiche ici aussi.
 */

interface LongformEbookPanelProps {
  product: DigitalProductIdea;
  market: string | null;
  /** Rédaction en cours pour ce produit, et les gestes pour la lancer ou y renoncer. */
  writing: EbookJobFollow;
}

const STEP_LABELS: Record<EbookJob['status'], string> = {
  queued: 'Préparation…',
  outline: 'Construction du plan : chapitres et sections…',
  writing: 'Rédaction en cours, section par section…',
  completed: 'Rédaction terminée.',
  failed: 'La rédaction n’a pas abouti.',
};

export function LongformEbookPanel({ product, market, writing }: LongformEbookPanelProps) {
  const { account } = useAuth();
  const { job, isStarting, isRunning } = writing;

  const maxPages = Math.min(account?.limits.ebookPages ?? 15, EBOOK_PAGES_CEILING);
  const [targetPages, setTargetPages] = useState(() => Math.min(40, maxPages));

  const start = () =>
    writing.start(
      'ebook_longform',
      {
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
      },
      targetPages,
    );

  const progress = job && job.sectionsTotal > 0 ? Math.round((job.sectionsDone / job.sectionsTotal) * 100) : 0;
  // Un ouvrage long demande plusieurs minutes : le dire évite de croire à un blocage.
  const minutes = Math.max(2, Math.round((targetPages / 10) * 1.5));
  const isProduct = job?.kind === 'product';

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <h3 className="font-medium">{isRunning && isProduct ? 'Rédaction du contenu' : 'Rédiger l’ebook complet'}</h3>
        </div>
      </div>

      {isRunning && job ? (
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
              {job.notice ? job.notice.message : 'Vous pouvez quitter cet écran : la rédaction continue.'}
            </AlertDescription>
          </Alert>
          <Progress value={progress} aria-label="Avancement de la rédaction" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{isProduct ? 'Plan à revoir avant de rédiger ?' : 'Longueur mal choisie, ou titre à revoir ?'}</p>
            <Button variant="outline" size="sm" onClick={() => void writing.cancel()}>
              <X />
              Annuler la rédaction
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
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
