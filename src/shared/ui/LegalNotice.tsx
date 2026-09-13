import React, { useEffect, useState } from 'react';
import { Scale } from 'lucide-react';
import {
  FALLBACK_DISCLAIMER,
  fetchRequiredDisclaimer,
  getCachedDisclaimer,
} from '@/shared/lib/legal';

/**
 * Mention légale obligatoire sur chaque rapport (CdC §9.4).
 *
 * Le texte provient de la table de conformité, via `shared/lib/legal` : le jour
 * où la formulation légale change, elle change partout, sans chasse aux copies
 * dans le code.
 */
interface LegalNoticeProps {
  /** `inline` pour un pied de page discret, `block` pour un encart délimité. */
  variant?: 'inline' | 'block';
  className?: string;
}

export const LegalNotice: React.FC<LegalNoticeProps> = ({ variant = 'inline', className = '' }) => {
  const [disclaimer, setDisclaimer] = useState<string>(
    () => getCachedDisclaimer() ?? FALLBACK_DISCLAIMER,
  );

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
      <div
        className={`flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 ${className}`}
      >
        <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        <p className="text-[11px] leading-relaxed text-slate-500">{disclaimer}</p>
      </div>
    );
  }

  return (
    <p className={`text-[11px] leading-relaxed text-slate-400 ${className}`}>{disclaimer}</p>
  );
};
