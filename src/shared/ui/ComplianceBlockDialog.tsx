import React from 'react';
import { AlertTriangle, ShieldOff } from 'lucide-react';
import { ReportComplianceVerdict } from '@/shared/types/compliance';
import { ComplianceFindingsList } from '@/shared/ui/ComplianceFindingsList';
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

  const blockingCount = verdict.findings.filter((finding) => finding.severity === 'block').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-6">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600">
              <ShieldOff className="h-4.5 w-4.5" />
            </span>
            <div>
              <DialogTitle>Export bloqué</DialogTitle>
              <DialogDescription>
                {verdict.unavailableReason
                  ? "La conformité n'a pas pu être vérifiée."
                  : `${blockingCount} ${blockingCount > 1 ? 'formulations sont' : 'formulation est'} non conforme${blockingCount > 1 ? 's' : ''} aux politiques publicitaires.`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {verdict.unavailableReason ? (
          <div className="space-y-2 rounded-xl border border-amber-300/70 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-sm font-bold">Vérification impossible</span>
            </div>
            <p className="text-xs leading-relaxed text-amber-900/90">{verdict.unavailableReason}</p>
            <p className="text-xs leading-relaxed text-amber-900/90">
              L'export reste bloqué tant que le contrôle n'a pas pu s'exécuter. Autoriser un
              téléchargement sans verdict reviendrait à n'avoir aucun contrôle du tout.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <ComplianceFindingsList findings={verdict.findings} />
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
