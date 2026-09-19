import { useEffect, useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { countryName } from '@server/shared/countries';
import type { AnalysisJob } from '@/shared/types/analysis';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Avancement de l'analyse en cours : étude Perplexity, rédaction Gemini, vérification. L'analyse
 * tourne sur le serveur : quitter la page ne l'interrompt pas.
 */

const STEPS = [
  { title: 'Étude de marché sur le web', detail: 'Perplexity cherche et lit les pages sur la niche : comptez 1 à 3 minutes.' },
  { title: 'Rédaction du rapport', detail: 'Gemini rédige à partir des seules sources citées par l’étude.' },
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
  const { analysisJob } = useWorkspace();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!analysisJob) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [analysisJob]);

  if (!analysisJob) return null;
  const current = activeStep(analysisJob.status);

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
      </CardContent>
    </Card>
  );
}
