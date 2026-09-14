import { useEffect, useState } from 'react';
import { AlertTriangle, FlaskConical, Info, Scale } from 'lucide-react';
import { FALLBACK_DISCLAIMER } from '@/shared/lib/legal';
import type { MarketRate } from '@/shared/types/analysis';
import type { MethodologyDoc } from '@/shared/types/scoring';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { RateBadge } from '@/shared/ui/RateBadge';
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
 */

/** La méthodologie publiée ne change qu'au déploiement : un cache de module suffit. */
let methodologyCache: MethodologyDoc | null = null;

interface ScoreTracePanelProps {
  rate: MarketRate | null;
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

export function ScoreTracePanel({ rate, open, onOpenChange }: ScoreTracePanelProps) {
  const [methodology, setMethodology] = useState<MethodologyDoc | null>(methodologyCache);

  useEffect(() => {
    if (!open || methodologyCache) return;

    let cancelled = false;
    // L'API peut être absente (front servi seul) : le panneau reste utile sans
    // elle, on perd seulement le rappel de la règle publiée.
    fetch('/api/scoring/methodology')
      .then((response) => (response.ok ? response.json() : null))
      .then((doc: MethodologyDoc | null) => {
        if (cancelled || !doc) return;
        methodologyCache = doc;
        setMethodology(doc);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!rate) return null;

  const trace = rate.trace;
  const versionDrift = trace && methodology ? methodology.version !== trace.methodologyVersion : false;

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
              <DialogDescription>Détail du calcul, critère par critère.</DialogDescription>
            </div>
            <RateBadge level={rate.level} size="md" />
          </div>
        </DialogHeader>

        {!trace ? (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>Méthodologie pas encore publiée</AlertTitle>
            <AlertDescription>
              <p>
                Ce taux est indicatif : sa méthode de calcul n’est pas encore formalisée, donc aucune ventilation ne peut
                en être montrée. Seul le <strong>taux de saturation concurrentielle</strong> est aujourd’hui produit par
                le moteur de scoring traçable (4 critères pondérés).
              </p>
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

            {versionDrift && methodology && (
              <Alert variant="danger">
                <AlertTriangle />
                <AlertTitle>Méthodologie modifiée depuis cette mesure</AlertTitle>
                <AlertDescription>
                  Le score a été calculé avec la v{trace.methodologyVersion}, le serveur applique aujourd’hui la v
                  {methodology.version}. Ce chiffre n’est pas comparable aux scores récents tant que la niche n’a pas été
                  remesurée.
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

            {methodology && (
              <div className="space-y-1.5 rounded-lg border bg-muted/50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  <Scale className="size-3.5 shrink-0" />
                  Règle de normalisation publiée
                </p>
                <p className="text-sm leading-relaxed">{methodology.normalization}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Paliers : {methodology.levels.map((level) => `${level.label} ${level.from}–${level.to}`).join(' · ')}
                </p>
              </div>
            )}

            <div className="flex items-start gap-2 border-t pt-3">
              <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {methodology?.disclaimer ?? FALLBACK_DISCLAIMER}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
