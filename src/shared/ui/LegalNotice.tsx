import { useEffect, useState } from 'react';
import { Scale } from 'lucide-react';
import { FALLBACK_DISCLAIMER, fetchRequiredDisclaimer, getCachedDisclaimer } from '@/shared/lib/legal';
import { cn } from '@/shared/lib/utils';

/**
 * Mention légale obligatoire sur chaque rapport.
 *
 * Le texte provient de la table de conformité, via `shared/lib/legal` : le jour
 * où la formulation légale change, elle change partout.
 */
interface LegalNoticeProps {
  /** `inline` pour un pied de page discret, `block` pour un encart délimité. */
  variant?: 'inline' | 'block';
  className?: string;
}

export function LegalNotice({ variant = 'inline', className }: LegalNoticeProps) {
  const [disclaimer, setDisclaimer] = useState<string>(() => getCachedDisclaimer() ?? FALLBACK_DISCLAIMER);

  useEffect(() => {
    let cancelled = false;
    fetchRequiredDisclaimer().then((text) => {
      if (!cancelled) setDisclaimer(text);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (variant === 'block') {
    return (
      <div className={cn('flex items-start gap-2 rounded-lg border bg-muted/50 px-3.5 py-2.5', className)}>
        <Scale className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-muted-foreground">{disclaimer}</p>
      </div>
    );
  }

  return <p className={cn('text-xs leading-relaxed text-muted-foreground', className)}>{disclaimer}</p>;
}
