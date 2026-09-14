import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, TrendingUp } from 'lucide-react';
import { ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { SalesSummaryResponse } from '@/shared/types/marketplaces';
import { ChartProvenance } from '@/shared/ui/ChartProvenance';
import { NoDataState } from '@/shared/ui/NoDataState';

/**
 * Ventes encaissées sur les marketplaces connectées — feuille de route 5.2.
 *
 * Remplace l'état vide posé en 1.5, et en garde la règle : soit des ventes
 * réelles, soit l'aveu qu'aucune source n'est branchée. Aucun chiffre estimé,
 * aucun ROI : les dépenses publicitaires ne sont connues d'aucune source.
 */

const PERIOD_DAYS = 30;

export const SalesSummaryCard: React.FC = () => {
  const [data, setData] = useState<SalesSummaryResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/marketplaces/sales-summary?days=${PERIOD_DAYS}`)
      .then(async (response) => {
        if (!response.ok) {
          throw await readApiError(response, `Les ventes n'ont pas pu être chargées (${response.status}).`);
        }
        return (await response.json()) as SalesSummaryResponse;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, "Les ventes n'ont pas pu être chargées."));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
          <TrendingUp className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900">Performance des Ventes</h2>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {data
              ? `${PERIOD_DAYS} derniers jours · ${data.summaries.map((summary) => summary.source).join(', ')}`
              : 'Ventes encaissées sur vos marketplaces'}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des ventes…
        </div>
      ) : error ? (
        error.code === 'NO_SALES_SOURCE' ? (
          <NoDataState
            title="Vos ventes s'afficheront ici"
            reason="Aucune marketplace capable de remonter des ventes n'est connectée. Une fois la clé API Chariow configurée sur le serveur, ce tableau affichera vos ventes réelles — jamais une estimation."
            milestone="Lot 5 — connecteur Chariow"
          />
        ) : (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <p className="text-xs leading-relaxed text-rose-900">{error.message}</p>
          </div>
        )
      ) : (
        data?.summaries.map((summary) => (
          <div key={summary.source} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <p className="mb-1 text-xs font-semibold text-slate-500">Ventes encaissées</p>
                <p className="text-2xl font-black tracking-tight text-slate-900">
                  {summary.completedSales.toLocaleString('fr-FR')}
                  {summary.truncated ? '+' : ''}
                </p>
              </div>

              {summary.totalsByCurrency.length === 0 ? (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:col-span-2">
                  <p className="text-xs text-slate-500">Aucune vente encaissée sur la période.</p>
                </div>
              ) : (
                summary.totalsByCurrency.map((total) => (
                  <div key={total.currency} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <p className="mb-1 text-xs font-semibold text-slate-500">Chiffre d'affaires ({total.currency})</p>
                    <p className="text-2xl font-black tracking-tight text-slate-900">{total.formatted}</p>
                    <p className="text-[11px] text-slate-400">{total.salesCount.toLocaleString('fr-FR')} vente(s)</p>
                  </div>
                ))
              )}
            </div>

            {summary.truncated && (
              <p className="text-[11px] text-amber-700">
                Volume trop important pour être lu en entier : ces chiffres sont des minima.
              </p>
            )}

            <ChartProvenance
              provenance={{
                source: summary.source,
                collectedAt: summary.collectedAt,
                sampleSize: summary.completedSales,
                sampleUnit: 'ventes encaissées',
                isDemonstration: false,
              }}
            />
            <p className="text-[11px] leading-relaxed text-slate-400">
              Du {formatDateFr(summary.from)} au {formatDateFr(summary.to)} · ventes payées (statuts
              « completed » et « settled »). Une ligne par devise : des devises différentes ne s'additionnent pas.
            </p>
          </div>
        ))
      )}
    </div>
  );
};
