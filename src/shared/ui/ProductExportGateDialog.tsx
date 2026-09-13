import React from 'react';
import { AlertTriangle, Fingerprint, ShieldCheck, ShieldOff } from 'lucide-react';
import type { ProductExportVerdict } from '@/shared/lib/productExport';
import { ComplianceFindingsList } from '@/shared/ui/ComplianceFindingsList';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

/**
 * Refus d'export d'un produit : conformité et originalité, avec les passages en
 * cause. Comme pour le rapport, aucun bouton ne permet de passer outre.
 */
interface ProductExportGateDialogProps {
  verdict: ProductExportVerdict | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ProductExportGateDialog: React.FC<ProductExportGateDialogProps> = ({
  verdict,
  open,
  onOpenChange,
}) => {
  if (!verdict) return null;

  const { compliance, originality } = verdict;

  const reasons: string[] = [];
  if (!compliance.exportAllowed) {
    reasons.push(
      compliance.unavailableReason
        ? "la conformité n'a pas pu être vérifiée"
        : 'des formulations sont non conformes',
    );
  }
  if (!originality) {
    reasons.push("l'originalité n'a pas pu être vérifiée");
  } else if (originality.blocking) {
    reasons.push(`l'originalité est sous le seuil de ${originality.threshold} %`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-6">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600">
              <ShieldOff className="h-4.5 w-4.5" />
            </span>
            <div>
              <DialogTitle>Export du produit bloqué</DialogTitle>
              <DialogDescription>Motif : {reasons.join(' ; ')}.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500">
            {compliance.exportAllowed ? (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <ShieldOff className="h-3.5 w-3.5 text-rose-600" />
            )}
            Conformité publicitaire
          </h3>

          {compliance.unavailableReason ? (
            <div className="rounded-xl border border-amber-300/70 bg-amber-50 p-3.5">
              <p className="text-xs leading-relaxed text-amber-900">
                <strong>Vérification impossible.</strong> {compliance.unavailableReason} L'export reste
                bloqué tant que le contrôle n'a pas pu s'exécuter.
              </p>
            </div>
          ) : compliance.findings.length > 0 ? (
            <ComplianceFindingsList findings={compliance.findings} />
          ) : (
            <p className="text-xs text-emerald-700">Aucune formulation bloquante ni point de vigilance.</p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500">
            <Fingerprint className="h-3.5 w-3.5" />
            Originalité
          </h3>

          {!originality ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 p-3.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs leading-relaxed text-amber-900">
                <strong>Vérification impossible.</strong> {verdict.originalityUnavailableReason} L'export
                reste bloqué tant que le contrôle n'a pas pu s'exécuter.
              </p>
            </div>
          ) : !originality.measurable ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="text-xs leading-relaxed text-slate-700">
                <strong>Non mesurée.</strong> {originality.unmeasurableReason} Ce contrôle ne bloque pas
                l'export tant qu'aucune mesure n'est possible.
              </p>
            </div>
          ) : (
            <>
              <div
                className={`rounded-xl border p-3.5 ${
                  originality.blocking ? 'border-rose-200 bg-rose-50/60' : 'border-emerald-200 bg-emerald-50/60'
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-semibold text-slate-600">Originalité mesurée</span>
                  <span
                    className={`text-2xl font-black ${originality.blocking ? 'text-rose-700' : 'text-emerald-700'}`}
                  >
                    {(originality.originalityPercent ?? 0).toLocaleString('fr-FR')} %
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Seuil bloquant : {originality.threshold} % · {originality.wordCount.toLocaleString('fr-FR')}{' '}
                  mots analysés
                </p>
              </div>

              {originality.matches.map((match, index) => (
                <div key={`${match.label}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-bold text-slate-700">{match.label}</span>
                    <span className="shrink-0 font-bold text-rose-700">
                      {match.overlapPercent.toLocaleString('fr-FR')} % repris
                    </span>
                  </div>
                  {match.passages.map((passage, passageIndex) => (
                    <p key={passageIndex} className="mt-1.5 text-xs italic leading-relaxed text-slate-600">
                      « {passage} »
                    </p>
                  ))}
                </div>
              ))}
            </>
          )}

          {originality && <p className="text-[11px] leading-relaxed text-slate-400">{originality.scopeNotice}</p>}
        </section>

        <p className="border-t border-slate-200 pt-3 text-[11px] text-slate-500">
          Corrigez les passages signalés, puis relancez l'export.
        </p>
      </DialogContent>
    </Dialog>
  );
};
