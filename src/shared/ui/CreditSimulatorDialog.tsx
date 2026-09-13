import React from 'react';
import { AlertTriangle, ArrowRight, Info, Wallet, Zap } from 'lucide-react';
import { CreditQuote } from '@/shared/types/credits';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

/**
 * Simulateur de crédits — module 8 du cahier des charges.
 *
 * Affiche les quatre informations exigées avant toute action consommant des
 * points : le coût, son équivalent monétaire, le solde avant et le solde après.
 *
 * La validation est un geste explicite. Un solde qui baisse sans confirmation
 * préalable est la première cause de défiance sur ce type d'outil : l'utilisateur
 * doit pouvoir répondre « non » sans avoir déjà payé.
 */
interface CreditSimulatorDialogProps {
  quote: CreditQuote | null;
  /** Renseigné quand la grille tarifaire n'a pas pu être chargée. */
  unavailableReason: string | null;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const CreditSimulatorDialog: React.FC<CreditSimulatorDialogProps> = ({
  quote,
  unavailableReason,
  open,
  onConfirm,
  onCancel,
}) => {
  const handleOpenChange = (isOpen: boolean) => {
    // Fermer la fenêtre équivaut à refuser : on ne déclenche jamais l'action
    // sur autre chose qu'un clic explicite sur « Confirmer ».
    if (!isOpen) onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-6">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
              <Zap className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>Confirmer la dépense</DialogTitle>
              <DialogDescription>
                {unavailableReason
                  ? 'Le coût de cette action ne peut pas être calculé.'
                  : quote?.action.label}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {unavailableReason || !quote ? (
          <>
            <div className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="text-sm font-bold">Grille tarifaire indisponible</span>
              </div>
              <p className="text-xs leading-relaxed text-amber-900/90">
                {unavailableReason ?? 'Coût inconnu.'}
              </p>
              <p className="text-xs leading-relaxed text-amber-900/90">
                L'action est annulée. Déclencher une dépense sans pouvoir en annoncer le montant
                reviendrait à débiter à l'aveugle.
              </p>
            </div>

            <button
              type="button"
              onClick={onCancel}
              className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white transition-colors hover:bg-slate-800"
            >
              Fermer
            </button>
          </>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-slate-600">{quote.action.description}</p>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-500">Coût de l'action</span>
                <span className="font-display text-2xl font-black text-slate-900">
                  {quote.cost}
                  <span className="ml-1 text-xs font-semibold text-slate-500">pts</span>
                </span>
              </div>

              <div className="flex items-baseline justify-between border-t border-slate-200 pt-3">
                <span className="text-xs font-semibold text-slate-500">Équivalent</span>
                <span className="text-sm font-bold text-slate-900">
                  ≈ {quote.monetaryEquivalent.toLocaleString('fr-FR')} {quote.currency}
                </span>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                  <Wallet className="h-3.5 w-3.5" />
                  Solde
                </span>
                <span className="inline-flex items-center gap-2 text-sm font-bold">
                  <span className="text-slate-500">{quote.balanceBefore} pts</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                  <span className={quote.sufficient ? 'text-slate-900' : 'text-rose-600'}>
                    {quote.balanceAfter} pts
                  </span>
                </span>
              </div>
            </div>

            {!quote.sufficient && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-300/70 bg-rose-50 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
                <p className="text-xs leading-relaxed text-rose-900">
                  <strong>Solde insuffisant.</strong> Il vous manque{' '}
                  {quote.cost - quote.balanceBefore} point
                  {quote.cost - quote.balanceBefore > 1 ? 's' : ''} pour lancer cette action.
                </p>
              </div>
            )}

            {quote.pointValueStatus && (
              <div className="flex items-start gap-1.5">
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                <p className="text-[11px] leading-relaxed text-slate-500">
                  {quote.pointValueStatus}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 transition-colors hover:border-slate-300"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!quote.sufficient}
                className="flex-1 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Confirmer — {quote.cost} pts
              </button>
            </div>

            <p className="text-center text-[10px] text-slate-400">
              Grille tarifaire v{quote.tableVersion}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
