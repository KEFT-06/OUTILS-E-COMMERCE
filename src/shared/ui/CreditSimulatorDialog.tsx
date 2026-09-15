import { AlertTriangle, ArrowRight, Info, Wallet, Zap } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { CreditQuote } from '@/shared/types/credits';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

/**
 * Simulateur de crédits : les quatre informations exigées avant toute action
 * consommant des points — le coût, son équivalent monétaire, le solde avant et
 * le solde après.
 *
 * La validation est un geste explicite : l'utilisateur doit pouvoir répondre
 * « non » sans avoir déjà payé.
 */
interface CreditSimulatorDialogProps {
  quote: CreditQuote | null;
  /** Renseigné quand la grille tarifaire n'a pas pu être chargée. */
  unavailableReason: string | null;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CreditSimulatorDialog({ quote, unavailableReason, open, onConfirm, onCancel }: CreditSimulatorDialogProps) {
  // Fermer la fenêtre équivaut à refuser : l'action ne part que sur « Confirmer ».
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-6">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-warning-border bg-warning-soft text-warning">
              <Zap className="size-4" />
            </span>
            <div className="space-y-1">
              <DialogTitle>Confirmer la dépense</DialogTitle>
              <DialogDescription>
                {unavailableReason ? 'Le coût de cette action ne peut pas être calculé.' : quote?.action.label}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {unavailableReason || !quote ? (
          <>
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Grille tarifaire indisponible</AlertTitle>
              <AlertDescription>
                <p>{unavailableReason ?? 'Coût inconnu.'}</p>
                <p>L’action est annulée : lancer une dépense sans pouvoir en annoncer le montant reviendrait à débiter à l’aveugle.</p>
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button onClick={onCancel} className="w-full sm:w-auto">
                Fermer
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-muted-foreground">{quote.action.description}</p>

            <dl className="divide-y rounded-lg border bg-muted/40 px-4">
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="text-sm text-muted-foreground">Coût de l’action</dt>
                <dd className="font-display text-2xl font-extrabold tabular-nums">
                  {quote.cost}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">pts</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="text-sm text-muted-foreground">Équivalent</dt>
                <dd className="text-sm font-semibold tabular-nums">
                  ≈ {quote.monetaryEquivalent.toLocaleString('fr-FR')} {quote.currency}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Wallet className="size-3.5" aria-hidden="true" />
                  Solde
                </dt>
                <dd className="inline-flex items-center gap-2 text-sm font-semibold tabular-nums">
                  {quote.unlimited ? (
                    <span>Palier illimité : aucun point prélevé</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">{quote.balanceBefore} pts</span>
                      <ArrowRight className="size-3.5 text-muted-foreground" aria-label="après l’action" />
                      <span className={cn(!quote.sufficient && 'text-danger')}>{quote.balanceAfter} pts</span>
                    </>
                  )}
                </dd>
              </div>
            </dl>

            {!quote.sufficient && (
              <Alert variant="danger">
                <AlertTriangle />
                <AlertTitle>Solde insuffisant</AlertTitle>
                <AlertDescription>
                  Il vous manque {quote.cost - quote.balanceBefore} point{quote.cost - quote.balanceBefore > 1 ? 's' : ''}{' '}
                  pour lancer cette action.
                </AlertDescription>
              </Alert>
            )}

            {quote.pointValueStatus && (
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {quote.pointValueStatus}
              </p>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={onCancel}>
                Annuler
              </Button>
              <Button onClick={onConfirm} disabled={!quote.sufficient}>
                {quote.unlimited ? 'Confirmer' : `Confirmer — ${quote.cost} pts`}
              </Button>
            </DialogFooter>

            <p className="text-center text-xs text-muted-foreground">Grille tarifaire v{quote.tableVersion}</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
