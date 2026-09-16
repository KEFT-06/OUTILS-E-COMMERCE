import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { AlertTriangle, ExternalLink, Eye, Scissors, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/shared/components/PageHeader';
import { type ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { cn } from '@/shared/lib/utils';
import type { BlueprintRule, CampaignBlueprintConfig } from '@/shared/types/blueprints';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * Structures de campagnes Meta et TikTok.
 *
 * Les montants affichés ne sont jamais inventés : ils se calculent à partir du
 * budget et du coût d'acquisition cible que l'utilisateur saisit, selon les
 * répartitions de la table de configuration, dont le statut provisoire est
 * affiché. Les noms d'objectifs sont ceux des gestionnaires de publicités, avec
 * leur source et la date de vérification.
 */

const CURRENCIES = ['XOF', 'XAF', 'EUR', 'USD', 'MAD', 'TND', 'DZD', 'CDF', 'GNF', 'MGA'];

const RULE_ICONS: Record<BlueprintRule['kind'], ComponentType<{ className?: string }>> = {
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

export function CampaignBlueprintsView() {
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
  const objectiveName = (objectiveId: string) => platform?.objectives.find((objective) => objective.id === objectiveId);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Vendre"
        title="Structures de campagnes"
        description="Des plans de campagne Meta et TikTok à reproduire dans le gestionnaire de publicités, chiffrés à partir de votre budget."
      />

      {error && (
        <Alert variant="danger">
          <AlertTriangle />
          <AlertTitle>Structures indisponibles</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {!config && !error && (
        <div className="space-y-4" aria-label="Chargement des structures">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      )}

      {config && (
        <>
          {config.valuesStatus && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertDescription>{config.valuesStatus}</AlertDescription>
            </Alert>
          )}

          <Card className="py-5">
            <CardContent className="grid gap-4 sm:grid-cols-4">
              <fieldset className="space-y-2 sm:col-span-4">
                <legend className="mb-2 text-sm font-medium">Plateforme</legend>
                <div className="flex flex-wrap gap-2">
                  {config.platforms.map((candidate) => (
                    <Button
                      key={candidate.id}
                      type="button"
                      size="sm"
                      variant={platformId === candidate.id ? 'secondary' : 'outline'}
                      aria-pressed={platformId === candidate.id}
                      onClick={() => setPlatformId(candidate.id)}
                      className={cn(platformId === candidate.id && 'border-primary/40 text-brand-green-text')}
                    >
                      {candidate.label}
                    </Button>
                  ))}
                </div>
              </fieldset>

              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="blueprint-budget">Budget total de la campagne</FieldLabel>
                <Input
                  id="blueprint-budget"
                  inputMode="decimal"
                  value={budgetInput}
                  onChange={(event) => setBudgetInput(event.target.value)}
                  placeholder="facultatif"
                />
                <FieldDescription>Sert à chiffrer chaque phase.</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="blueprint-cpa">Coût d’acquisition cible</FieldLabel>
                <Input
                  id="blueprint-cpa"
                  inputMode="decimal"
                  value={targetCpaInput}
                  onChange={(event) => setTargetCpaInput(event.target.value)}
                  placeholder="par vente"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="blueprint-currency">Devise</FieldLabel>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="blueprint-currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>

          {platform && (
            <p className="text-xs text-muted-foreground">
              Objectifs : nomenclature officielle {platform.label}, vérifiée le {formatDateFr(platform.objectivesCheckedAt)}.{' '}
              {safeHttpUrl(platform.objectivesSource) && (
                <a
                  href={safeHttpUrl(platform.objectivesSource) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-brand-green-text underline-offset-4 hover:underline"
                >
                  Source
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              )}
            </p>
          )}

          {blueprints.map((blueprint) => (
            <Card key={blueprint.id}>
              <CardHeader>
                <CardTitle>
                  <h2 className="font-display text-lg leading-tight font-extrabold tracking-tight">{blueprint.name}</h2>
                </CardTitle>
                <CardDescription className="leading-relaxed">{blueprint.summary}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {blueprint.prerequisites.length > 0 && (
                  <div className="rounded-lg border bg-muted/40 p-4">
                    <p className="mb-2 text-sm font-semibold">Prérequis</p>
                    <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                      {blueprint.prerequisites.map((prerequisite) => (
                        <li key={prerequisite}>{prerequisite}</li>
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
                      <li key={phase.id} className="space-y-3 rounded-lg border p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-medium text-brand-green-text">
                              Phase {index + 1} · {phase.durationDays} jours
                            </p>
                            <h3 className="font-semibold">{phase.name}</h3>
                          </div>
                          <div className="sm:text-right">
                            <Badge variant="secondary" className="tabular-nums">
                              {phase.budgetSharePercent} % du budget
                            </Badge>
                            {phaseBudget !== null && (
                              <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                                {formatAmount(phaseBudget, currency)} · {formatAmount(phaseBudget / phase.durationDays, currency)} / jour
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg bg-muted/50 p-3">
                            <p className="text-xs text-muted-foreground">Objectif</p>
                            <p className="font-semibold">{objective?.officialName ?? phase.objectiveId}</p>
                            {objective && <p className="text-sm text-muted-foreground">{objective.purpose}</p>}
                            {fallback && phase.fallbackCondition && (
                              <p className="mt-1 text-sm text-warning">
                                {phase.fallbackCondition} → {fallback.officialName}
                              </p>
                            )}
                          </div>
                          <div className="rounded-lg bg-muted/50 p-3">
                            <p className="text-xs text-muted-foreground">Structure</p>
                            <p className="text-sm">
                              {phase.structure.campaigns} campagne · {phase.structure.adSets} ensemble(s) de publicités ·{' '}
                              {phase.structure.adsPerAdSet} publicité(s) par ensemble
                            </p>
                          </div>
                        </div>

                        <p className="text-sm leading-relaxed text-muted-foreground">{phase.guidance}</p>

                        {phase.rules.length > 0 && (
                          <ul className="space-y-2">
                            {phase.rules.map((rule) => {
                              const Icon = RULE_ICONS[rule.kind];
                              return (
                                <li key={rule.description} className="flex items-start gap-2 text-sm leading-relaxed">
                                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                  <span>
                                    {rule.description}
                                    {rule.cpaMultiplier !== undefined &&
                                      (targetCpa !== null
                                        ? ` Seuil : ${formatAmount(targetCpa * rule.cpaMultiplier, currency)}.`
                                        : ` Seuil : ${rule.cpaMultiplier} × votre coût d’acquisition cible.`)}
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
              </CardContent>
            </Card>
          ))}

          <p className="text-xs text-muted-foreground">Table des structures v{config.version}.</p>
        </>
      )}
    </div>
  );
}
