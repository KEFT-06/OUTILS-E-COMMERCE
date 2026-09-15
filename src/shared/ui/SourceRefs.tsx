import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { cn } from '@/shared/lib/utils';
import type { WebGroundingSource } from '@/shared/types/analysis';

/**
 * Renvois vers les sources qui fondent un fait du rapport : « Sources : [2] [5] ».
 * Chaque numéro ouvre la page citée ; un numéro sans source connue n'est pas affiché.
 */
export function SourceRefs({
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
    <p className={cn('flex flex-wrap items-center gap-1 text-xs text-muted-foreground', className)}>
      <span>{cited.length > 1 ? 'Sources :' : 'Source :'}</span>
      {cited.map((source) => {
        const url = safeHttpUrl(source.url);
        const label = `[${source.id}]`;
        return url ? (
          <a
            key={source.id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.title}
            aria-label={`Source ${source.id} : ${source.title} (nouvel onglet)`}
            className="rounded border px-1.5 py-0.5 font-medium text-foreground tabular-nums hover:bg-accent"
          >
            {label}
          </a>
        ) : (
          <span key={source.id} className="tabular-nums">
            {label}
          </span>
        );
      })}
    </p>
  );
}
