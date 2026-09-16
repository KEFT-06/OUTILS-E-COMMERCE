import { AlertTriangle, Fingerprint, ShieldCheck, ShieldOff } from 'lucide-react';
import type { ProductExportVerdict } from '@/modules/studio/export/productExport';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { ComplianceFindingsList } from '@/shared/components/ComplianceFindingsList';
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

const sectionTitle = 'flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase';

export function ProductExportGateDialog({ verdict, open, onOpenChange }: ProductExportGateDialogProps) {
  if (!verdict) return null;

  const { compliance, originality } = verdict;

  const reasons: string[] = [];
  if (!compliance.exportAllowed) {
    reasons.push(
      compliance.unavailableReason ? "la conformité n'a pas pu être vérifiée" : 'des formulations sont non conformes',
    );
  }
  if (!originality) {
    reasons.push("l'originalité n'a pas pu être vérifiée");
  } else if (originality.blocking) {
    reasons.push(`l'originalité est sous le seuil de ${originality.threshold} %`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-6">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-danger-border bg-danger-soft text-danger">
              <ShieldOff className="size-4" />
            </span>
            <div className="space-y-1">
              <DialogTitle>Export du produit bloqué</DialogTitle>
              <DialogDescription>Motif : {reasons.join(' ; ')}.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className={sectionTitle}>
            {compliance.exportAllowed ? (
              <ShieldCheck className="size-3.5 text-success" />
            ) : (
              <ShieldOff className="size-3.5 text-danger" />
            )}
            Conformité publicitaire
          </h3>

          {compliance.unavailableReason ? (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Vérification impossible</AlertTitle>
              <AlertDescription>
                {compliance.unavailableReason} L’export reste bloqué tant que le contrôle n’a pas pu s’exécuter.
              </AlertDescription>
            </Alert>
          ) : compliance.findings.length > 0 ? (
            <ComplianceFindingsList findings={compliance.findings} />
          ) : (
            <p className="text-sm text-success">Aucune formulation bloquante ni point de vigilance.</p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className={sectionTitle}>
            <Fingerprint className="size-3.5" />
            Originalité
          </h3>

          {!originality ? (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Vérification impossible</AlertTitle>
              <AlertDescription>
                {verdict.originalityUnavailableReason} L’export reste bloqué tant que le contrôle n’a pas pu
                s’exécuter.
              </AlertDescription>
            </Alert>
          ) : !originality.measurable ? (
            <div className="rounded-lg border bg-muted p-3.5 text-sm">
              <strong>Non mesurée.</strong> {originality.unmeasurableReason} Ce contrôle ne bloque pas l’export tant
              qu’aucune mesure n’est possible.
            </div>
          ) : (
            <>
              <div
                className={cn(
                  'rounded-lg border p-3.5',
                  originality.blocking ? 'border-danger-border bg-danger-soft' : 'border-success-border bg-success-soft',
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">Originalité mesurée</span>
                  <span
                    className={cn(
                      'font-display text-2xl font-extrabold tabular-nums',
                      originality.blocking ? 'text-danger' : 'text-success',
                    )}
                  >
                    {(originality.originalityPercent ?? 0).toLocaleString('fr-FR')} %
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Seuil bloquant : {originality.threshold} % · {originality.wordCount.toLocaleString('fr-FR')} mots
                  analysés
                </p>
              </div>

              {originality.matches.map((match, index) => (
                <div key={`${match.label}-${index}`} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold">{match.label}</span>
                    <span className="shrink-0 font-semibold text-danger tabular-nums">
                      {match.overlapPercent.toLocaleString('fr-FR')} % repris
                    </span>
                  </div>
                  {match.passages.map((passage, passageIndex) => (
                    <p key={passageIndex} className="mt-1.5 text-sm leading-relaxed text-muted-foreground italic">
                      « {passage} »
                    </p>
                  ))}
                </div>
              ))}
            </>
          )}

          {originality && <p className="text-xs leading-relaxed text-muted-foreground">{originality.scopeNotice}</p>}
        </section>

        <p className="border-t pt-3 text-xs text-muted-foreground">
          Corrigez les passages signalés, puis relancez l’export.
        </p>
      </DialogContent>
    </Dialog>
  );
}
