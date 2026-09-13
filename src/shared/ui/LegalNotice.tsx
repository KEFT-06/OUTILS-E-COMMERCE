import React, { useEffect, useState } from 'react';
import { Scale } from 'lucide-react';

/**
 * Mention légale obligatoire sur chaque rapport (CdC §9.4).
 *
 * Le texte provient de la table de conformité, source unique : le jour où la
 * formulation légale change, elle change partout, sans chasse aux copies dans
 * le code. Le repli n'est là que pour garantir qu'aucun rapport ne s'affiche
 * sans mention si l'API est momentanément absente.
 */
const FALLBACK_DISCLAIMER =
  'Smart Creator fournit des analyses basées sur des données publiques. ' +
  "Aucun résultat financier n'est garanti.";

let disclaimerCache: string | null = null;

interface LegalNoticeProps {
  /** `inline` pour un pied de page discret, `block` pour un encart délimité. */
  variant?: 'inline' | 'block';
  className?: string;
}

export const LegalNotice: React.FC<LegalNoticeProps> = ({ variant = 'inline', className = '' }) => {
  const [disclaimer, setDisclaimer] = useState<string>(disclaimerCache ?? FALLBACK_DISCLAIMER);

  useEffect(() => {
    if (disclaimerCache) return;

    let cancelled = false;

    fetch('/api/compliance/rules')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { requiredDisclaimer?: string } | null) => {
        if (cancelled || !data?.requiredDisclaimer) return;
        disclaimerCache = data.requiredDisclaimer;
        setDisclaimer(data.requiredDisclaimer);
      })
      .catch(() => undefined);

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
