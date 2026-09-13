import React from 'react';
import { PenLine, ShieldAlert } from 'lucide-react';
import { LocatedFinding } from '@/shared/types/compliance';

/**
 * Constats de conformité : formulations bloquantes avec leur reformulation,
 * puis points de vigilance. Partagé par les refus d'export du rapport et du
 * produit, pour qu'un même constat s'affiche partout de la même façon.
 */
export const ComplianceFindingsList: React.FC<{ findings: LocatedFinding[] }> = ({ findings }) => {
  const blocking = findings.filter((finding) => finding.severity === 'block');
  const warnings = findings.filter((finding) => finding.severity === 'warn');

  return (
    <div className="space-y-4">
      {blocking.length > 0 && (
        <div className="space-y-2.5">
          {blocking.map((finding, index) => (
            <div
              key={`${finding.ruleId}-${finding.sectionLabel}-${index}`}
              className="rounded-xl border border-rose-200 bg-rose-50/60 p-3.5"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-rose-700">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {finding.category}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {finding.sectionLabel}
                </span>
              </div>

              <p className="text-sm font-semibold text-slate-900">
                «&nbsp;<span className="rounded bg-rose-200/70 px-1">{finding.matched}</span>&nbsp;»
              </p>

              <div className="mt-2.5 flex items-start gap-1.5 border-t border-rose-200/70 pt-2.5">
                <PenLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                <p className="text-xs leading-relaxed text-slate-700">{finding.rewriteHint}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
          <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-amber-800">
            {warnings.length} point{warnings.length > 1 ? 's' : ''} de vigilance (non bloquant
            {warnings.length > 1 ? 's' : ''})
          </p>
          <ul className="space-y-1.5">
            {warnings.map((finding, index) => (
              <li key={`${finding.ruleId}-warn-${index}`} className="text-xs leading-relaxed text-amber-900/90">
                <span className="font-semibold">{finding.category}</span> — «&nbsp;{finding.matched}&nbsp;» (
                {finding.sectionLabel})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
