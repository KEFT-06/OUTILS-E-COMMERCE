import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleCheck, CircleDashed, Layers, Target, Zap } from 'lucide-react';
import { pathOf, type ModuleId } from '@/app/navigation';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { PageHeader } from '@/shared/components/PageHeader';
import { cn } from '@/shared/lib/utils';
import type { MarketAnalysisReport } from '@/shared/types/analysis';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { NoDataState } from '@/shared/components/NoDataState';
import { RadarDigestCard } from '@/modules/cockpit/RadarDigestCard';
import { Progress } from '@/shared/ui/progress';
import { RateBadge } from '@/shared/components/RateBadge';
import { SalesSummaryCard } from '@/shared/components/SalesSummaryCard';
import { Skeleton } from '@/shared/ui/skeleton';

interface CockpitDashboardProps {
  /** null : aucune niche analysée pour l’instant. */
  report: MarketAnalysisReport | null;
  onNavigateToModule: (module: ModuleId) => void;
  onOpenBilling: () => void;
}

/** Libellés des fournisseurs remontés par /api/health. */
const SERVICE_LABELS: Record<string, string> = {
  text: 'Analyse et rédaction IA',
  video: 'Visuels et vidéos',
  storybook: 'Storybook illustré',
  webSearch: 'Recherche web des analyses',
};

/** Parcours conseillé : c'est une vraie séquence, d'où la numérotation. */
const GETTING_STARTED: { module: ModuleId; title: string; text: string }[] = [
  { module: 'niches', title: 'Choisir une niche', text: 'Parcourez toutes les niches, enregistrez les vôtres et lancez leur analyse.' },
  { module: 'analyse', title: 'Lire l’analyse de la niche', text: 'Les 5 taux, la concurrence et le plan d’action.' },
  { module: 'studio', title: 'Structurer votre produit', text: 'Modules, promesse et simulation de rentabilité.' },
  { module: 'kit-lancement', title: 'Préparer le lancement', text: 'Textes, scripts vidéo et boutons par marché.' },
];

/**
 * État réel des fournisseurs, lu sur /api/health. Remplace l'ancienne pastille
 * « Système en ligne » qui clignotait sans rien mesurer.
 */
function useProviderStatus() {
  const [providers, setProviders] = useState<Record<string, boolean> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { providers?: Record<string, boolean> }) => {
        if (!cancelled) setProviders(data.providers ?? {});
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { providers, failed };
}

export function CockpitDashboard({ report, onNavigateToModule, onOpenBilling }: CockpitDashboardProps) {
  const { account } = useAuth();
  const { costTable } = useCreditGate();
  const { providers, failed } = useProviderStatus();

  // Le solde vient du serveur, source unique partagée avec la page Compte.
  const credits = account?.credits;
  const creditsRemaining = credits?.total ?? 0;
  const creditPercentage = credits?.unlimited
    ? 100
    : credits?.allowance
      ? Math.min(100, (credits.plan / credits.allowance) * 100)
      : 0;

  // Seul le taux de saturation porte une trace de calcul vérifiable : c'est
  // donc le seul affiché comme indicateur de tension.
  const saturation = report?.rates.saturation;

  const serviceEntries = providers ? Object.entries(providers) : [];
  const connectedCount = serviceEntries.filter(([, connected]) => connected).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voir"
        title="Cockpit"
        description="Votre solde, vos ventes et la niche en cours d’analyse, au même endroit."
      />

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Points de recherche</CardTitle>
            <CardDescription>Palier {account?.plan.label}</CardDescription>
            <CardAction>
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand-orange/15 text-brand-orange-text">
                <Zap className="size-4" aria-hidden="true" />
              </span>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-extrabold tabular-nums">
                {credits?.unlimited ? '∞' : creditsRemaining}
              </span>
              <span className="text-sm text-muted-foreground">
                {credits?.unlimited
                  ? 'points illimités'
                  : `pts disponibles${credits?.allowance ? ` · quota de ${credits.allowance} par mois` : ''}`}
              </span>
            </p>
            <Progress value={creditPercentage} aria-label="Quota mensuel restant" />
            {/*
              L'équivalent monétaire vient de la grille tarifaire servie par l'API,
              jamais d'une constante du bundle. Sans grille, aucun montant.
            */}
            <p className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Équivalent estimé</span>
              {credits?.unlimited ? (
                <span className="font-semibold">Illimité</span>
              ) : costTable ? (
                <span className="font-semibold tabular-nums">
                  ≈ {(creditsRemaining * costTable.pointValue).toLocaleString('fr-FR')} {costTable.currency}
                </span>
              ) : (
                <span className="text-muted-foreground">grille indisponible</span>
              )}
            </p>
            <Button variant="outline" className="w-full" onClick={onOpenBilling}>
              Gérer mon compte
            </Button>
          </CardContent>
        </Card>

        {/*
          Ce bloc affichait autrefois 485k FCFA de revenus, 124 ventes et un ROI de
          3,2x, inventés. Il n'affiche plus que des ventes remontées par un
          connecteur, ou l'aveu qu'aucun n'est branché.
        */}
        <Card className="lg:col-span-8">
          <CardContent>
            <SalesSummaryCard />
          </CardContent>
        </Card>

        {/*
          Juste après le solde et les ventes, avant les blocs de parcours : c'est la seule
          information de cet écran qui a changé pendant la nuit, donc la seule qui mérite d'être
          lue en premier. Le bloc s'efface complètement quand il n'y a rien à dire.
        */}
        <RadarDigestCard />

        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="size-4 text-brand-green-text" aria-hidden="true" />
              Niche active
            </CardTitle>
            <CardDescription>Concurrence de la dernière niche analysée</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => onNavigateToModule('niches')}>
                Niches
                <ArrowUpRight />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            {report && saturation ? (
            <div className="rounded-lg border border-primary/30 bg-accent/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold">{report.nicheName}</p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <RateBadge level={saturation.level} size="sm" />
                {saturation.score !== null && (
                  <>
                    <span className="text-muted-foreground tabular-nums">{saturation.score} / 100</span>
                    <span className="text-muted-foreground">·</span>
                  </>
                )}
                {saturation.trace ? (
                  <span className="text-muted-foreground">méthode v{saturation.trace.methodologyVersion}</span>
                ) : saturation.basis === 'unavailable' ? (
                  <span className="text-muted-foreground">non évalué faute de source</span>
                ) : (
                  <span className="text-muted-foreground">appréciation fondée sur des sources</span>
                )}
              </div>
            </div>
            ) : (
              <NoDataState
                icon={Target}
                title="Aucune niche analysée"
                reason="Choisissez une niche dans le catalogue ou lancez une analyse : son niveau de concurrence s’affichera ici."
              />
            )}

            {(account?.savedNiches ?? []).slice(0, 3).map((niche) => (
              <div key={niche} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
                <p className="text-sm font-medium">{niche}</p>
                <span className="shrink-0 text-xs text-muted-foreground">Pas encore analysée</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4 text-brand-green-text" aria-hidden="true" />
              Plan d’action recommandé
            </CardTitle>
            <CardDescription>Tel que porté par le rapport de la niche active</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => onNavigateToModule('analyse')}>
                Analyse
                <ArrowUpRight />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!report || report.strategicActionPlan.length === 0 ? (
              <NoDataState
                icon={Layers}
                title={report ? 'Aucun plan d’action dans ce rapport' : 'Aucun plan d’action pour l’instant'}
                reason={
                  report
                    ? 'Le rapport analysé ne contient pas encore de plan d’action structuré.'
                    : 'Le plan d’action apparaît après l’analyse d’une niche.'
                }
              />
            ) : (
              <ol className="space-y-4">
                {report.strategicActionPlan.map((phase, index) => (
                  <li key={phase.phase} className="flex gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">{phase.phase}</p>
                      <p className="font-semibold">{phase.title}</p>
                      <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
                        {phase.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>Par où commencer</CardTitle>
            <CardDescription>Le parcours conseillé, de la lecture du marché au lancement.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="divide-y">
              {GETTING_STARTED.map((step, index) => (
                <li key={step.module} className="py-3 first:pt-0 last:pb-0">
                  <Link to={pathOf(step.module)} className="group flex items-center gap-4 rounded-md">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums group-hover:border-primary group-hover:text-brand-green-text">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium group-hover:text-brand-green-text">{step.title}</span>
                      <span className="block text-sm text-muted-foreground">{step.text}</span>
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground group-hover:text-brand-green-text" />
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle>Services connectés</CardTitle>
            <CardDescription>
              {providers
                ? `${connectedCount} sur ${serviceEntries.length} configurés sur le serveur`
                : failed
                  ? 'État indisponible : le serveur ne répond pas'
                  : 'Vérification en cours…'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!providers && !failed ? (
              <div className="space-y-2">
                <Skeleton className="h-6" />
                <Skeleton className="h-6" />
                <Skeleton className="h-6" />
              </div>
            ) : (
              <ul className="space-y-2.5">
                {serviceEntries.map(([key, connected]) => (
                  <li key={key} className="flex items-center justify-between gap-3 text-sm">
                    <span>{SERVICE_LABELS[key] ?? key}</span>
                    <span className={cn('inline-flex items-center gap-1.5', connected ? 'text-success' : 'text-muted-foreground')}>
                      {connected ? (
                        <CircleCheck className="size-4" aria-hidden="true" />
                      ) : (
                        <CircleDashed className="size-4" aria-hidden="true" />
                      )}
                      {connected ? 'Connecté' : 'Non configuré'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {providers && connectedCount < serviceEntries.length && (
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Les fonctions qui dépendent d’un service non configuré l’indiquent à l’écran au lieu d’afficher un résultat
                inventé.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
