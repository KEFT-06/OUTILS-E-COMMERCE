import React from 'react';
import { AlertTriangle, PenLine, ShieldAlert, ShieldOff } from 'lucide-react';
import { ReportComplianceVerdict } from '@/shared/types/compliance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

/**
 * Détail d'un export refusé par le vérificateur de conformité (CdC §6.4.1).
 *
 * Ce panneau n'offre **aucun** moyen de forcer l'export : c'est délibéré. Un
 * bouton « exporter quand même » transformerait le veto en suggestion, et la
 * promesse du produit avec lui. L'utilisateur repart avec ce qu'il faut
 * corriger, pas avec une porte de sortie.
 */
interface ComplianceBlockDialogProps {
  verdict: ReportComplianceVerdict | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ComplianceBlockDialog: React.FC<ComplianceBlockDialogProps> = ({
  verdict,
  open,
  onOpenChange,
}) => {
  if (!verdict) return null;

  const blocking = verdict.findings.filter((f) => f.severity === 'block');
  const warnings = verdict.findings.filter((f) => f.severity === 'warn');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-6">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 border border-rose-200">
              <ShieldOff className="h-4.5 w-4.5" />
            </span>
            <div>
              <DialogTitle>Export bloqué</DialogTitle>
              <DialogDescription>
                {verdict.unavailableReason
                  ? "La conformité n'a pas pu être vérifiée."
                  : `${blocking.length} ${blocking.length > 1 ? 'formulations sont' : 'formulation est'} non conforme${blocking.length > 1 ? 's' : ''} aux politiques publicitaires.`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {verdict.unavailableReason ? (
          <div className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-sm font-bold">Vérification impossible</span>
            </div>
            <p className="text-xs leading-relaxed text-amber-900/90">
              {verdict.unavailableReason}
            </p>
            <p className="text-xs leading-relaxed text-amber-900/90">
              L'export reste bloqué tant que le contrôle n'a pas pu s'exécuter. Autoriser un
              téléchargement sans verdict reviendrait à n'avoir aucun contrôle du tout.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {blocking.length > 0 && (
              <div className="space-y-2.5">
                {blocking.map((finding, index) => (
                  <div
                    key={`${finding.ruleId}-${finding.sectionLabel}-${index}`}
                    className="rounded-xl border border-rose-200 bg-rose-50/60 p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-rose-700">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        {finding.category}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {finding.sectionLabel}
                      </span>
                    </div>

                    <p className="text-sm font-semibold text-slate-900">
                      «&nbsp;<span className="bg-rose-200/70 px-1 rounded">{finding.matched}</span>
                      &nbsp;»
                    </p>

                    <div className="mt-2.5 flex items-start gap-1.5 border-t border-rose-200/70 pt-2.5">
                      <PenLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <p className="text-xs leading-relaxed text-slate-700">
                        {finding.rewriteHint}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
                <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-amber-800">
                  {warnings.length} point{warnings.length > 1 ? 's' : ''} de vigilance (non
                  bloquant{warnings.length > 1 ? 's' : ''})
                </p>
                <ul className="space-y-1.5">
                  {warnings.map((finding, index) => (
                    <li
                      key={`${finding.ruleId}-warn-${index}`}
                      className="text-xs leading-relaxed text-amber-900/90"
                    >
                      <span className="font-semibold">{finding.category}</span> — «&nbsp;
                      {finding.matched}&nbsp;» ({finding.sectionLabel})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="border-t border-slate-200 pt-3 text-[11px] text-slate-500">
              Table de règles v{verdict.rulesVersion}. Corrigez les formulations signalées dans le
              rapport, puis relancez l'export.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
