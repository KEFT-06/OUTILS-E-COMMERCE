import { AlertTriangle, ShieldOff } from 'lucide-react';
import type { ReportComplianceVerdict } from '@/shared/types/compliance';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { ComplianceFindingsList } from '@/shared/ui/ComplianceFindingsList';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

/**
 * Détail d'un export refusé par le vérificateur de conformité.
 *
 * Ce panneau n'offre **aucun** moyen de forcer l'export : un bouton « exporter
 * quand même » transformerait le veto en suggestion. L'utilisateur repart avec
 * ce qu'il faut corriger, pas avec une porte de sortie.
 */
interface ComplianceBlockDialogProps {
  verdict: ReportComplianceVerdict | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ComplianceBlockDialog({ verdict, open, onOpenChange }: ComplianceBlockDialogProps) {
  if (!verdict) return null;

  const blockingCount = verdict.findings.filter((finding) => finding.severity === 'block').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-6">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-danger-border bg-danger-soft text-danger">
              <ShieldOff className="size-4" />
            </span>
            <div className="space-y-1">
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
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>Vérification impossible</AlertTitle>
            <AlertDescription>
              <p>{verdict.unavailableReason}</p>
              <p>
                L’export reste bloqué tant que le contrôle n’a pas pu s’exécuter : autoriser un téléchargement sans verdict
                reviendrait à n’avoir aucun contrôle.
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <ComplianceFindingsList findings={verdict.findings} />
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Table de règles v{verdict.rulesVersion}. Corrigez les formulations signalées dans le rapport, puis relancez
              l’export.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
