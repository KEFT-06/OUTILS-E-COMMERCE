import { AlertTriangle, FlaskConical, Info } from 'lucide-react';
import { FALLBACK_DISCLAIMER } from '@/shared/lib/legal';
import type { MarketRate, WebGroundingSource } from '@/shared/types/analysis';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { RateBadge } from '@/shared/components/RateBadge';
import { SourceRefs } from '@/modules/analyse/SourceRefs';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table';

/**
 * Panneau de détail du calcul d'un taux. Il répond à une seule question :
 * « d'où sort ce chiffre ? ».
 *
 * Deux règles tiennent tout le composant :
 *  1. On affiche la trace **telle qu'elle a été persistée**, jamais un recalcul.
 *  2. Sans trace, on le dit. Inventer une ventilation plausible serait pire que
 *     de ne rien afficher.
 *
 * Seuls les rapports produits avec l'ancienne collecte publicitaire portent une trace
 * de calcul ; les taux actuels sont appréciés à partir des sources citées.
 */

interface ScoreTracePanelProps {
  rate: MarketRate | null;
  /** Sources du rapport, pour les renvois d'un taux apprécié à partir de pages web. */
  sources?: readonly WebGroundingSource[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatMeasuredAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ScoreTracePanel({ rate, sources, open, onOpenChange }: ScoreTracePanelProps) {
  if (!rate) return null;

  const trace = rate.trace;

  const facts = trace
    ? [
        { label: 'Score', value: `${trace.score} / 100` },
        { label: 'Mesuré le', value: formatMeasuredAt(trace.measuredAt) },
        { label: 'Échantillon', value: `${trace.sampleSize.toLocaleString('fr-FR')} publicités` },
        { label: 'Méthodologie', value: `v${trace.methodologyVersion}` },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="space-y-1">
              <DialogTitle>{rate.label}</DialogTitle>
              <DialogDescription>{trace ? 'Détail du calcul, critère par critère.' : 'Sur quoi repose ce niveau.'}</DialogDescription>
            </div>
            <RateBadge level={rate.level} size="md" />
          </div>
        </DialogHeader>

        {!trace && rate.basis === 'assessment' ? (
          <div className="space-y-4">
            <Alert variant="info">
              <Info />
              <AlertTitle>Appréciation de l’IA, fondée sur des sources</AlertTitle>
              <AlertDescription>
                <p>{rate.description}</p>
                <p>
                  Ce niveau n’est pas un calcul : il résume ce que disent les pages citées, à relire avant de décider.
                </p>
              </AlertDescription>
            </Alert>
            <SourceRefs ids={rate.sourceIds} sources={sources} className="text-sm" />
          </div>
        ) : !trace && rate.basis === 'unavailable' ? (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>Non évalué</AlertTitle>
            <AlertDescription>
              <p>{rate.description}</p>
              <p>Aucun niveau n’est affiché plutôt qu’un niveau deviné.</p>
            </AlertDescription>
          </Alert>
        ) : !trace ? (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>Taux indicatif</AlertTitle>
            <AlertDescription>
              <p>Ce taux ne porte ni source ni calcul enregistré : aucune ventilation ne peut en être montrée.</p>
              <p>Afficher une ventilation reconstituée donnerait une fausse impression de rigueur.</p>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {facts.map((fact) => (
                <div key={fact.label} className="rounded-lg border bg-muted/50 p-3">
                  <dt className="text-xs font-medium text-muted-foreground">{fact.label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums">{fact.value}</dd>
                </div>
              ))}
            </dl>

            {trace.source === 'demonstration' && (
              <Alert variant="info">
                <FlaskConical />
                <AlertTitle>Jeu de démonstration</AlertTitle>
                <AlertDescription>
                  Les signaux bruts ci-dessous sont fictifs, mais le calcul qui en découle est celui du moteur de
                  production.
                </AlertDescription>
              </Alert>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Critère</TableHead>
                  <TableHead className="text-right">Valeur brute</TableHead>
                  <TableHead className="text-right">Seuil élevé</TableHead>
                  <TableHead className="text-right">Normalisé</TableHead>
                  <TableHead className="text-right">Poids</TableHead>
                  <TableHead className="text-right">Contribution</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trace.breakdown.map((criterion) => (
                  <TableRow key={criterion.key} className="align-top">
                    <TableCell className="min-w-48 whitespace-normal">
                      <span className="block font-medium">{criterion.label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {criterion.explanation}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {criterion.rawValue.toLocaleString('fr-FR')}
                      {criterion.unit}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {criterion.highThreshold.toLocaleString('fr-FR')}
                      {criterion.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{criterion.normalized}/100</TableCell>
                    <TableCell className="text-right tabular-nums">{criterion.weight} %</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{criterion.contribution}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5} className="text-right font-medium">
                    Score final
                  </TableCell>
                  <TableCell className="text-right font-display text-base font-extrabold text-brand-green-text tabular-nums">
                    {trace.score}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>

            <div className="flex items-start gap-2 border-t pt-3">
              <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {FALLBACK_DISCLAIMER}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
