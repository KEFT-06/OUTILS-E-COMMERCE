import { PenLine, ShieldAlert } from 'lucide-react';
import type { LocatedFinding } from '@/shared/types/compliance';

/**
 * Constats de conformité : formulations bloquantes avec leur reformulation, puis
 * points de vigilance. Partagé par les refus d'export du rapport et du produit,
 * pour qu'un même constat s'affiche partout de la même façon.
 */
export function ComplianceFindingsList({ findings }: { findings: LocatedFinding[] }) {
  const blocking = findings.filter((finding) => finding.severity === 'block');
  const warnings = findings.filter((finding) => finding.severity === 'warn');

  return (
    <div className="space-y-4">
      {blocking.length > 0 && (
        <ul className="space-y-2.5">
          {blocking.map((finding, index) => (
            <li
              key={`${finding.ruleId}-${finding.sectionLabel}-${index}`}
              className="rounded-lg border border-danger-border bg-danger-soft p-3.5"
            >
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-danger uppercase">
                  <ShieldAlert className="size-3.5" aria-hidden="true" />
                  {finding.category}
                </span>
                <span className="text-xs font-medium text-muted-foreground">{finding.sectionLabel}</span>
              </div>

              <p className="text-sm font-semibold">
                «&nbsp;<mark className="rounded bg-danger/15 px-1 text-foreground">{finding.matched}</mark>&nbsp;»
              </p>

              <div className="mt-2.5 flex items-start gap-1.5 border-t border-danger-border pt-2.5">
                <PenLine className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm leading-relaxed text-foreground/85">{finding.rewriteHint}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg border border-warning-border bg-warning-soft p-3.5">
          <p className="mb-2 text-xs font-semibold tracking-wider text-warning uppercase">
            {warnings.length} point{warnings.length > 1 ? 's' : ''} de vigilance (non bloquant
            {warnings.length > 1 ? 's' : ''})
          </p>
          <ul className="space-y-1.5">
            {warnings.map((finding, index) => (
              <li key={`${finding.ruleId}-warn-${index}`} className="text-sm leading-relaxed text-foreground/85">
                <span className="font-semibold">{finding.category}</span> — «&nbsp;{finding.matched}&nbsp;» (
                {finding.sectionLabel})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
