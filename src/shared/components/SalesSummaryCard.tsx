import { useEffect, useState } from 'react';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { ConnectChariowLink } from '@/shared/components/ConnectChariowLink';
import { type ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import type { SalesSummaryResponse } from '@/shared/types/marketplaces';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { ChartProvenance } from '@/shared/components/ChartProvenance';
import { NoDataState } from '@/shared/components/NoDataState';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * Ventes encaissées sur les marketplaces connectées.
 *
 * Soit des ventes réelles, soit l'aveu qu'aucune source n'est branchée. Aucun
 * chiffre estimé, aucun ROI : les dépenses publicitaires ne sont connues
 * d'aucune source.
 */

const PERIOD_DAYS = 30;

export function SalesSummaryCard() {
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
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <TrendingUp className="size-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold">Ventes encaissées</h2>
          <p className="text-xs text-muted-foreground">
            {data
              ? `${PERIOD_DAYS} derniers jours · ${data.summaries.map((summary) => summary.source).join(', ')}`
              : 'Sur vos marketplaces connectées'}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3" aria-label="Chargement des ventes">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : error ? (
        error.code === 'NO_SALES_SOURCE' ? (
          <NoDataState
            title="Vos ventes s’afficheront ici"
            reason="Aucune boutique n’est reliée à votre compte. Ajoutez votre clé API Chariow dans Mon compte : vos ventes réelles apparaîtront ici, jamais une estimation."
          >
            <ConnectChariowLink />
          </NoDataState>
        ) : (
          <Alert variant="danger">
            <AlertTriangle />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )
      ) : (
        data?.summaries.map((summary) => (
          <div key={summary.source} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/40 p-4">
                <p className="text-sm text-muted-foreground">Ventes encaissées</p>
                <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">
                  {summary.completedSales.toLocaleString('fr-FR')}
                  {summary.truncated ? '+' : ''}
                </p>
              </div>

              {summary.totalsByCurrency.length === 0 ? (
                <div className="rounded-lg border bg-muted/40 p-4 sm:col-span-2">
                  <p className="text-sm text-muted-foreground">Aucune vente encaissée sur la période.</p>
                </div>
              ) : (
                summary.totalsByCurrency.map((total) => (
                  <div key={total.currency} className="rounded-lg border bg-muted/40 p-4">
                    <p className="text-sm text-muted-foreground">Chiffre d’affaires ({total.currency})</p>
                    <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{total.formatted}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {total.salesCount.toLocaleString('fr-FR')} vente(s)
                    </p>
                  </div>
                ))
              )}
            </div>

            {summary.truncated && (
              <p className="text-xs text-warning">
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
            <p className="text-xs leading-relaxed text-muted-foreground">
              Du {formatDateFr(summary.from)} au {formatDateFr(summary.to)} · ventes payées (statuts « completed » et
              « settled »). Une ligne par devise : des devises différentes ne s’additionnent pas.
            </p>
          </div>
        ))
      )}
    </div>
  );
}
