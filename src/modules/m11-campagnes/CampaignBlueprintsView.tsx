import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Eye,
  Loader2,
  Megaphone,
  Scissors,
  TrendingUp,
} from 'lucide-react';
import { ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { BlueprintRule, CampaignBlueprintConfig } from '@/shared/types/blueprints';

/**
 * Structures de campagnes Meta et TikTok — feuille de route 5.4.
 *
 * Les montants affichés ne sont jamais inventés : ils se calculent à partir du
 * budget et du coût d'acquisition cible que l'utilisateur saisit, selon les
 * répartitions de la table de configuration — dont le statut provisoire est
 * affiché. Les noms d'objectifs sont ceux des gestionnaires de publicités, avec
 * leur source et la date de vérification.
 */

const CURRENCIES = ['XOF', 'XAF', 'EUR', 'USD', 'MAD', 'TND', 'DZD', 'CDF', 'GNF', 'MGA'];

const RULE_ICONS: Record<BlueprintRule['kind'], React.ComponentType<{ className?: string }>> = {
  cut: Scissors,
  scale: TrendingUp,
  watch: Eye,
};

function formatAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString('fr-FR')} ${currency}`;
  }
}

/** Nombre positif saisi, ou null : un champ vide ne doit pas produire « 0 FCFA par jour ». */
function positiveNumber(raw: string): number | null {
  const value = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500';

export const CampaignBlueprintsView: React.FC = () => {
  const [config, setConfig] = useState<CampaignBlueprintConfig | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [platformId, setPlatformId] = useState('meta');
  const [budgetInput, setBudgetInput] = useState('');
  const [targetCpaInput, setTargetCpaInput] = useState('');
  const [currency, setCurrency] = useState('XOF');

  useEffect(() => {
    let cancelled = false;

    fetch('/api/campaigns/blueprints')
      .then(async (response) => {
        if (!response.ok) {
          throw await readApiError(response, `Les structures n'ont pas pu être chargées (${response.status}).`);
        }
        return (await response.json()) as CampaignBlueprintConfig;
      })
      .then((payload) => {
        if (!cancelled) setConfig(payload);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, "Les structures n'ont pas pu être chargées."));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const platform = config?.platforms.find((candidate) => candidate.id === platformId);
  const blueprints = useMemo(
    () => config?.blueprints.filter((blueprint) => blueprint.platform === platformId) ?? [],
    [config, platformId],
  );

  const budget = positiveNumber(budgetInput);
  const targetCpa = positiveNumber(targetCpaInput);
  const objectiveName = (objectiveId: string) =>
    platform?.objectives.find((objective) => objective.id === objectiveId);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header>
        <span className="mb-2 inline-block rounded-md border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-700">
          Module 11
        </span>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
          <Megaphone className="h-6 w-6 text-indigo-600" />
          Structures de Campagnes
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Des plans de campagne Meta et TikTok à reproduire dans le gestionnaire de publicités, chiffrés à
          partir de votre budget.
        </p>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <p className="text-xs leading-relaxed text-rose-900">{error.message}</p>
        </div>
      )}

      {!config && !error && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des structures…
        </div>
      )}

      {config && (
        <>
          {config.valuesStatus && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs leading-relaxed text-amber-900">{config.valuesStatus}</p>
            </div>
          )}

          <section className="grid grid-cols-1 gap-3 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs sm:grid-cols-4">
            <fieldset className="sm:col-span-4">
              <legend className={labelClass}>Plateforme</legend>
              <div className="flex gap-2">
                {config.platforms.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    aria-pressed={platformId === candidate.id}
                    onClick={() => setPlatformId(candidate.id)}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                      platformId === candidate.id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {candidate.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="block sm:col-span-2">
              <span className={labelClass}>Budget total de la campagne</span>
              <input
                inputMode="decimal"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder="facultatif"
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Coût d'acquisition cible</span>
              <input
                inputMode="decimal"
                value={targetCpaInput}
                onChange={(e) => setTargetCpaInput(e.target.value)}
                placeholder="par vente"
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Devise</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={fieldClass}>
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {platform && (
            <p className="text-[11px] text-slate-500">
              Objectifs : nomenclature officielle {platform.label}, vérifiée le{' '}
              {formatDateFr(platform.objectivesCheckedAt)}.{' '}
              {safeHttpUrl(platform.objectivesSource) && (
                <a
                  href={safeHttpUrl(platform.objectivesSource) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  source
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
          )}

          {blueprints.map((blueprint) => (
            <section key={blueprint.id} className="space-y-4 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-6">
              <div>
                <h2 className="text-lg font-black tracking-tight text-slate-900">{blueprint.name}</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{blueprint.summary}</p>
              </div>

              {blueprint.prerequisites.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500">Prérequis</p>
                  <ul className="space-y-1">
                    {blueprint.prerequisites.map((prerequisite) => (
                      <li key={prerequisite} className="text-xs leading-relaxed text-slate-700">
                        · {prerequisite}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <ol className="space-y-3">
                {blueprint.phases.map((phase, index) => {
                  const objective = objectiveName(phase.objectiveId);
                  const fallback = phase.fallbackObjectiveId ? objectiveName(phase.fallbackObjectiveId) : undefined;
                  const phaseBudget = budget !== null ? (budget * phase.budgetSharePercent) / 100 : null;

                  return (
                    <li key={phase.id} className="space-y-3 rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-wider text-indigo-600">
                            Phase {index + 1} · {phase.durationDays} jours
                          </p>
                          <h3 className="text-sm font-bold text-slate-900">{phase.name}</h3>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="text-sm font-black text-slate-900">{phase.budgetSharePercent} % du budget</p>
                          {phaseBudget !== null && (
                            <p className="text-[11px] text-slate-500">
                              {formatAmount(phaseBudget, currency)} · {formatAmount(phaseBudget / phase.durationDays, currency)} / jour
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Objectif</p>
                          <p className="text-sm font-bold text-slate-900">{objective?.officialName ?? phase.objectiveId}</p>
                          {objective && <p className="text-[11px] leading-relaxed text-slate-500">{objective.purpose}</p>}
                          {fallback && phase.fallbackCondition && (
                            <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                              {phase.fallbackCondition} → {fallback.officialName}
                            </p>
                          )}
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Structure</p>
                          <p className="text-xs text-slate-700">
                            {phase.structure.campaigns} campagne · {phase.structure.adSets} ensemble(s) de publicités ·{' '}
                            {phase.structure.adsPerAdSet} publicité(s) par ensemble
                          </p>
                        </div>
                      </div>

                      <p className="text-xs leading-relaxed text-slate-600">{phase.guidance}</p>

                      {phase.rules.length > 0 && (
                        <ul className="space-y-1.5">
                          {phase.rules.map((rule) => {
                            const Icon = RULE_ICONS[rule.kind];
                            return (
                              <li key={rule.description} className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-700">
                                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                                <span>
                                  {rule.description}
                                  {rule.cpaMultiplier !== undefined &&
                                    (targetCpa !== null
                                      ? ` Seuil : ${formatAmount(targetCpa * rule.cpaMultiplier, currency)}.`
                                      : ` Seuil : ${rule.cpaMultiplier} × votre coût d'acquisition cible.`)}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          <p className="text-[11px] text-slate-400">Table des structures v{config.version}.</p>
        </>
      )}
    </div>
  );
};
