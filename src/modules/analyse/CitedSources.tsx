import { ExternalLink } from 'lucide-react';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { cn } from '@/shared/lib/utils';
import type { WebGroundingSource } from '@/shared/types/analysis';

/**
 * Les pages qui fondent une appréciation, nommées.
 *
 * Les numéros de source ont quitté le corps du rapport : « [2] [5] » n'apprenait rien sans
 * aller voir ailleurs. Là où le lecteur vient justement chercher le fondement d'un chiffre,
 * mieux vaut le titre de la page que son rang dans une liste.
 */
export function CitedSources({
  ids,
  sources,
  className,
}: {
  ids: readonly number[] | undefined;
  sources: readonly WebGroundingSource[] | undefined;
  className?: string;
}) {
  const cited = (ids ?? []).flatMap((id) => {
    const source = sources?.find((candidate) => candidate.id === id);
    return source ? [source] : [];
  });
  if (cited.length === 0) return null;

  return (
    <div className={cn('space-y-1.5', className)}>
      <p className="text-xs font-medium text-muted-foreground">
        {cited.length > 1 ? `Les ${cited.length} pages qui fondent ce niveau` : 'La page qui fonde ce niveau'}
      </p>
      <ul className="space-y-1">
        {cited.map((source) => {
          const url = safeHttpUrl(source.url);
          return (
            <li key={source.id} className="text-sm">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-6 items-start gap-1.5 underline-offset-4 hover:underline"
                >
                  <span className="break-words">{source.title}</span>
                  <ExternalLink className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </a>
              ) : (
                <span className="break-words">{source.title}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
