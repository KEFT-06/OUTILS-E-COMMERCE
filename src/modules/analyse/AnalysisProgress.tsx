import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, ExternalLink, X } from 'lucide-react';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { countryName } from '@server/shared/countries';
import type { AnalysisJob } from '@/shared/types/analysis';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Avancement de l'analyse en cours : étude du web, rédaction, vérification. L'analyse
 * tourne sur le serveur : quitter la page ne l'interrompt pas.
 *
 * Les moteurs employés ne sont jamais nommés devant l'utilisateur : ils peuvent changer
 * sans que rien ne bouge à l'écran.
 */

const STEPS = [
  { title: 'Étude de marché sur le web', detail: 'Les pages publiées sur la niche sont cherchées et lues : comptez 1 à 3 minutes.' },
  { title: 'Rédaction du rapport', detail: 'Le rapport est rédigé à partir des seules sources citées par l’étude.' },
  { title: 'Vérification et enregistrement', detail: 'Tout fait sans source existante est écarté avant l’enregistrement.' },
] as const;

function activeStep(status: AnalysisJob['status']): number {
  if (status === 'queued' || status === 'research') return 0;
  if (status === 'writing') return 1;
  return 2;
}

function elapsedLabel(since: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${String(seconds % 60).padStart(2, '0')} s` : `${seconds} s`;
}

export function AnalysisProgress() {
  const { analysisJob, cancelAnalysis } = useWorkspace();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!analysisJob) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [analysisJob]);

  if (!analysisJob) return null;
  const current = activeStep(analysisJob.status);
  const sources = analysisJob.sources ?? [];

  return (
    <Card role="status" aria-live="polite" className="border-primary/30">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Spinner className="text-brand-green-text" />
          <CardTitle className="text-base">Analyse de « {analysisJob.query} » en cours</CardTitle>
          {analysisJob.market && <Badge variant="outline">{countryName(analysisJob.market)}</Badge>}
        </div>
        <CardDescription className="tabular-nums">
          Lancée il y a {elapsedLabel(analysisJob.createdAt, now)}. Vous pouvez quitter cette page : l’analyse continue sur le serveur et le
          rapport s’ouvrira dès qu’il sera prêt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, index) => {
            const done = index < current;
            const active = index === current;
            return (
              <li
                key={step.title}
                className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${active ? 'border-primary/40 bg-accent/50' : 'bg-muted/30'}`}
                aria-current={active ? 'step' : undefined}
              >
                {done ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : active ? (
                  <Spinner className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="space-y-0.5">
                  <span className="block font-medium">{step.title}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">{step.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>

        {/*
          L'étude est le temps long ; la rédaction qui suit en prend encore une bonne partie.
          Montrer dès maintenant les pages retenues occupe cette attente avec la matière même
          du rapport, au lieu d'une barre qui avance sans rien dire.
        */}
        {sources.length > 0 && (
          <section className="mt-4 space-y-2 rounded-lg border bg-muted/30 p-3">
            <h3 className="text-sm font-medium">
              {sources.length} page{sources.length > 1 ? 's' : ''} retenue{sources.length > 1 ? 's' : ''} par l’étude
              <span className="ml-1.5 font-normal text-muted-foreground">— le rapport est en cours de rédaction à partir d’elles.</span>
            </h3>
            <ul className="space-y-1">
              {sources.slice(0, 8).map((source) => {
                const url = safeHttpUrl(source.url);
                return (
                  <li key={source.url} className="truncate text-xs">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-6 items-center gap-1.5 underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate">{source.title}</span>
                      </a>
                    ) : (
                      <span className="truncate text-muted-foreground">{source.title}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {sources.length > 8 && (
              <p className="text-xs text-muted-foreground">
                et {sources.length - 8} autre{sources.length - 8 > 1 ? 's' : ''}, toutes listées dans l’onglet Sources du rapport.
              </p>
            )}
          </section>
        )}

        {/*
          Sortie de secours : une seule analyse tourne par compte, et elle dure plusieurs
          minutes. Sans ce bouton, une niche mal saisie obligeait à attendre la fin d'un
          rapport dont on ne voulait plus.
        */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Vous vous êtes trompé de niche ou de marché ?</p>
          <Button variant="outline" size="sm" onClick={() => void cancelAnalysis()}>
            <X />
            Annuler l’analyse
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
