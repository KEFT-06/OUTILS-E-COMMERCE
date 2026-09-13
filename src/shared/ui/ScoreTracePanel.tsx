import React, { useEffect, useState } from 'react';
import { AlertTriangle, FlaskConical, Info, Scale } from 'lucide-react';
import { FALLBACK_DISCLAIMER } from '@/shared/lib/legal';
import { MarketRate } from '@/shared/types/analysis';
import { MethodologyDoc } from '@/shared/types/scoring';
import { RateBadge } from '@/shared/ui/RateBadge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

/**
 * Panneau de détail du calcul d'un taux — différenciateur n°1 du cahier des
 * charges (§6.1). Il répond à une seule question : « d'où sort ce chiffre ? ».
 *
 * Deux règles tiennent tout le composant :
 *  1. On affiche la trace **telle qu'elle a été persistée**, jamais un recalcul.
 *  2. Sans trace, on le dit. Inventer une ventilation plausible serait pire que
 *     de ne rien afficher : ce serait l'opacité du concurrent, en plus crédible.
 */

/**
 * La méthodologie publiée ne change qu'au déploiement : un cache de module
 * évite de la redemander à chaque ouverture du panneau.
 */
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

export const ScoreTracePanel: React.FC<ScoreTracePanelProps> = ({ rate, open, onOpenChange }) => {
  const [methodology, setMethodology] = useState<MethodologyDoc | null>(methodologyCache);

  useEffect(() => {
    if (!open || methodologyCache) return;

    let cancelled = false;
    // L'API peut être absente (front servi seul) : le panneau doit rester utile
    // sans elle, on perd seulement le rappel de la règle publiée.
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
  const versionDrift =
    trace && methodology ? methodology.version !== trace.methodologyVersion : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <div>
              <DialogTitle>{rate.label}</DialogTitle>
              <DialogDescription>Détail du calcul, critère par critère.</DialogDescription>
            </div>
            <RateBadge level={rate.level} size="md" />
          </div>
        </DialogHeader>

        {!trace ? (
          /* État vide explicite — exigé par le CdC §9.4. */
          <div className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-sm font-bold">Méthodologie non encore publiée</span>
            </div>
            <p className="text-xs leading-relaxed text-amber-900/90">
              Ce taux est affiché à titre indicatif : sa méthode de calcul n'est pas encore
              formalisée, donc aucune ventilation ne peut en être montrée. Seul le{' '}
              <strong>taux de saturation concurrentielle</strong> est aujourd'hui produit par le
              moteur de scoring traçable (4 critères pondérés, CdC §6.1).
            </p>
            <p className="text-xs leading-relaxed text-amber-900/90">
              Afficher ici une ventilation reconstituée donnerait une fausse impression de
              rigueur. Tant que la règle n'est pas écrite, ce panneau reste vide.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Provenance — un score sans provenance n'est pas interprétable. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Score
                </div>
                <div className="text-xl font-black text-slate-900">
                  {trace.score}
                  <span className="text-[11px] font-medium text-slate-400"> / 100</span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Mesuré le
                </div>
                <div className="text-xs font-semibold text-slate-800 leading-snug">
                  {formatMeasuredAt(trace.measuredAt)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Échantillon
                </div>
                <div className="text-xs font-semibold text-slate-800">
                  {trace.sampleSize.toLocaleString('fr-FR')} publicités
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Méthodologie
                </div>
                <div className="text-xs font-semibold text-slate-800">
                  v{trace.methodologyVersion}
                </div>
              </div>
            </div>

            {trace.source === 'demonstration' && (
              <div className="flex items-center gap-2 rounded-xl border border-indigo-300/70 bg-indigo-50 px-3 py-2">
                <FlaskConical className="h-4 w-4 shrink-0 text-indigo-700" />
                <p className="text-xs leading-relaxed text-indigo-900">
                  <strong>Jeu de démonstration.</strong> Les signaux bruts ci-dessous sont fictifs,
                  mais le calcul qui en découle est celui du moteur de production.
                </p>
              </div>
            )}

            {versionDrift && methodology && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-300/70 bg-rose-50 px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-700 mt-0.5" />
                <p className="text-xs leading-relaxed text-rose-900">
                  <strong>Méthodologie modifiée depuis cette mesure.</strong> Le score a été calculé
                  avec la v{trace.methodologyVersion}, le serveur applique aujourd'hui la v
                  {methodology.version}. Ce chiffre n'est pas comparable aux scores récents tant que
                  la niche n'a pas été remesurée.
                </p>
              </div>
            )}

            {/* Ventilation par critère. */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-2 pr-3 font-bold uppercase tracking-wider text-[10px] text-slate-500">
                      Critère
                    </th>
                    <th className="py-2 px-2 font-bold uppercase tracking-wider text-[10px] text-slate-500 text-right whitespace-nowrap">
                      Valeur brute
                    </th>
                    <th className="py-2 px-2 font-bold uppercase tracking-wider text-[10px] text-slate-500 text-right whitespace-nowrap">
                      Seuil élevé
                    </th>
                    <th className="py-2 px-2 font-bold uppercase tracking-wider text-[10px] text-slate-500 text-right">
                      Normalisé
                    </th>
                    <th className="py-2 px-2 font-bold uppercase tracking-wider text-[10px] text-slate-500 text-right">
                      Poids
                    </th>
                    <th className="py-2 pl-2 font-bold uppercase tracking-wider text-[10px] text-slate-500 text-right">
                      Contribution
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trace.breakdown.map((criterion) => (
                    <tr key={criterion.key} className="border-b border-slate-100 align-top">
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-slate-800">{criterion.label}</div>
                        <div className="text-[11px] text-slate-500 leading-relaxed mt-0.5">
                          {criterion.explanation}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-semibold text-slate-900 whitespace-nowrap">
                        {criterion.rawValue.toLocaleString('fr-FR')}
                        {criterion.unit}
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-500 whitespace-nowrap">
                        {criterion.highThreshold.toLocaleString('fr-FR')}
                        {criterion.unit}
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-700">
                        {criterion.normalized}/100
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-700">{criterion.weight} %</td>
                      <td className="py-2.5 pl-2 text-right font-black text-slate-900">
                        {criterion.contribution}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="py-2.5 pr-3 text-right font-bold text-slate-700">
                      Score final
                    </td>
                    <td className="py-2.5 pl-2 text-right text-base font-black text-indigo-700">
                      {trace.score}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {methodology && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-700">
                  <Scale className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    Règle de normalisation publiée
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-600">
                  {methodology.normalization}
                </p>
                <p className="text-[11px] leading-relaxed text-slate-600">
                  Paliers :{' '}
                  {methodology.levels
                    .map((level) => `${level.label} ${level.from}–${level.to}`)
                    .join(' · ')}
                </p>
              </div>
            )}

            {/* Mention légale obligatoire (CdC §9.4). */}
            <div className="flex items-start gap-2 border-t border-slate-200 pt-3">
              <Info className="h-3.5 w-3.5 shrink-0 text-slate-400 mt-0.5" />
              <p className="text-[11px] leading-relaxed text-slate-500">
                {methodology?.disclaimer ?? FALLBACK_DISCLAIMER}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
