import { AlertTriangle, Database, ExternalLink, FlaskConical } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { DataProvenance } from '@/shared/types/provenance';
import { Badge } from '@/shared/ui/badge';

/**
 * Ligne de provenance à apposer sous chaque graphique : source, date de collecte,
 * taille d'échantillon.
 *
 * Quand la provenance est absente, ce composant ne s'efface pas : il le dit. Un
 * graphique dont on a oublié la source se signale au lieu de passer inaperçu.
 */
interface ChartProvenanceProps {
  provenance?: DataProvenance;
  className?: string;
}

function formatCollectedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function ChartProvenance({ provenance, className }: ChartProvenanceProps) {
  if (!provenance) {
    return (
      <p
        className={cn(
          'mt-3 flex items-start gap-1.5 rounded-md border border-warning-border bg-warning-soft px-2.5 py-1.5 text-xs text-foreground/85',
          className,
        )}
      >
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span>
          <strong>Provenance non renseignée.</strong> Ces chiffres sont affichés sans source ni date de collecte : à
          interpréter avec prudence.
        </span>
      </p>
    );
  }

  const Icon = provenance.isDemonstration ? FlaskConical : Database;

  return (
    <p className={cn('mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground', className)}>
      <span className="inline-flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {provenance.isDemonstration && (
          <Badge variant="info" className="px-1.5 py-0 tracking-wide uppercase">
            Démonstration
          </Badge>
        )}
        <span className="font-medium text-foreground/80">{provenance.source}</span>
      </span>
      <span aria-hidden="true">·</span>
      <span>collecté le {formatCollectedAt(provenance.collectedAt)}</span>
      {provenance.sampleSize !== undefined && (
        <>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            échantillon : {provenance.sampleSize.toLocaleString('fr-FR')}
            {provenance.sampleUnit ? ` ${provenance.sampleUnit}` : ''}
          </span>
        </>
      )}
      {provenance.sourceUrl && (
        <a
          href={provenance.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 font-medium text-brand-green-text underline-offset-4 hover:underline"
        >
          source
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      )}
    </p>
  );
}
