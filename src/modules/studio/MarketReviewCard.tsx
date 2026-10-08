import { ArrowRight, Check, Compass, Plus } from 'lucide-react';
import type { AnalysisSubject, DigitalProductIdea, MissingChapter, ProductMarketReview } from '@/shared/types/analysis';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';

/**
 * « Votre ouvrage face au marché » : ce que l'étude dit du produit que l'auteur a écrit lui-même.
 *
 * Un ouvrage collé arrivait dans le Studio avec ses chapitres et rien d'autre : ni prix pratiqués,
 * ni concurrents, ni verdict — tout ce qu'une niche analysée apporte. L'étude part désormais de
 * son texte, et son résultat se range ici, avec lui.
 */

/** Fiche de l'ouvrage envoyée avec l'étude : quelques lignes, jamais son texte. */
export function subjectOf(product: DigitalProductIdea): AnalysisSubject {
  const court = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max);
  return {
    productId: product.id,
    title: court(product.title, 200),
    ...(product.subtitle.trim() ? { subtitle: court(product.subtitle, 300) } : {}),
    ...(product.targetAudience.trim() ? { audience: court(product.targetAudience, 600) } : {}),
    ...(product.transformationPromise.trim() ? { promise: court(product.transformationPromise, 600) } : {}),
    chapters: product.tableOfContents.slice(0, 40).map((module) => court(module.title, 160)),
  };
}

export function MarketReviewCard({
  review,
  pendingStep,
  onAddChapter,
  onOpenReport,
  onStudy,
}: {
  /** Étude rendue ; absente : pas encore menée. */
  review?: ProductMarketReview;
  /** Étude en cours : l'étape où elle en est. */
  pendingStep?: string | null;
  onAddChapter?: (chapter: MissingChapter) => void;
  onOpenReport?: () => void;
  /** Lancer l'étude (produit qui n'en a pas). Absent : le bouton n'est pas proposé. */
  onStudy?: () => void;
}) {
  if (!review && pendingStep) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-accent/40 p-4" role="status">
        <Spinner className="mt-0.5 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">Étude du marché de votre ouvrage en cours</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {pendingStep} Verdict, concurrents, prix pratiqués et public viendront se ranger ici : continuez à relire votre ouvrage.
          </p>
        </div>
      </div>
    );
  }

  if (!review) {
    if (!onStudy) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Compass className="size-4 text-brand-green-text" aria-hidden="true" />
            Votre ouvrage face au marché
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Sa niche est lue dans sa fiche : obtenez le verdict, les concurrents, les prix pratiqués et les chapitres que les acheteurs attendent.
          </p>
        </div>
        <Button variant="outline" onClick={onStudy}>
          <Compass />
          Étudier son marché
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-primary/30 bg-accent/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Compass className="size-4 text-brand-green-text" aria-hidden="true" />
          Votre ouvrage face au marché
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="max-w-full truncate">
            {review.nicheName}
          </Badge>
          {review.verdict && <Badge variant="brand">{review.verdict}</Badge>}
        </div>
      </div>

      {review.positioning ? (
        <p className="text-sm leading-relaxed">{review.positioning}</p>
      ) : (
        review.strengths.length === 0 &&
        review.missingChapters.length === 0 && (
          <p className="text-sm leading-relaxed text-muted-foreground">L’étude de sa niche est prête : verdict, concurrents, prix pratiqués, public et plan de lancement.</p>
        )
      )}

      {review.strengths.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">Ce qui joue pour lui</p>
          <ul className="space-y-1">
            {review.strengths.map((strength) => (
              <li key={strength} className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-green-text" aria-hidden="true" />
                <span className="min-w-0">{strength}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.missingChapters.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Ce que les acheteurs attendent en plus</p>
          <ul className="space-y-2">
            {review.missingChapters.map((chapter) => (
              <li key={chapter.title} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-medium">{chapter.title}</p>
                  {chapter.why && <p className="text-sm leading-relaxed text-muted-foreground">{chapter.why}</p>}
                </div>
                {onAddChapter && (
                  <Button size="sm" variant="outline" onClick={() => onAddChapter(chapter)}>
                    <Plus />
                    Ajouter ce chapitre
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {onOpenReport && (
        <Button variant="link" className="h-auto p-0" onClick={onOpenReport}>
          Voir l’étude complète
          <ArrowRight />
        </Button>
      )}
    </div>
  );
}
