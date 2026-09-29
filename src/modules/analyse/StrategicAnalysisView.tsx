import { useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CreditCard,
  FileText,
  Lightbulb,
  Megaphone,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  UserRound,
} from 'lucide-react';
import { countryName } from '@server/shared/countries';
import { LegalNotice } from '@/modules/analyse/LegalNotice';
import { cn } from '@/shared/lib/utils';
import type { MarketAnalysisReport, OverallVerdict } from '@/shared/types/analysis';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Analyse stratégique : ce que l'étude a établi, présenté pour décider.
 *
 * Refonte du 29/09/2026 : les onglets de détail (taux, mots-clés, concurrence, plan, sources)
 * vivent désormais dans le Dossier PDF, où se rédige aussi le rapport. Cet écran donne le
 * verdict, la synthèse et les réponses de l'étude — constats, acheteur, prix, canaux, risques
 * et leur parade —, jamais une liste de « points à vérifier » laissée à l'auteur.
 */

interface StrategicAnalysisViewProps {
  report: MarketAnalysisReport;
  onNavigateToProducts: () => void;
  onNavigateToMetaAds: () => void;
  /** Supprime le rapport du compte. */
  onDelete?: () => Promise<void>;
}

const VERDICT_VARIANT: Record<OverallVerdict, 'success' | 'info' | 'warning' | 'danger'> = {
  'Opportunité Exceptionnelle': 'success',
  'Opportunité Forte': 'info',
  'Marché Compétitif': 'warning',
  'Niche Risquée': 'danger',
};

function Section({ icon: Icon, title, children, className }: { icon: ComponentType<{ className?: string }>; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-4 rounded-3xl border bg-card p-5 shadow-sm sm:p-6', className)}>
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <span className="flex size-8 items-center justify-center rounded-xl bg-brand-green/15 text-brand-green-text">
          <Icon className="size-4" />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Bullets({ items, tone = 'default' }: { items: string[]; tone?: 'default' | 'good' }) {
  return (
    <ul className="space-y-2 text-sm leading-relaxed">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className={cn('mt-2 size-1.5 shrink-0 rounded-full', tone === 'good' ? 'bg-brand-green' : 'bg-muted-foreground/60')} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function StrategicAnalysisView({ report, onNavigateToProducts, onNavigateToMetaAds, onDelete }: StrategicAnalysisViewProps) {
  const isExampleReport = report.dataProvenance?.rates?.isDemonstration ?? false;
  const findings = report.keyFindings ?? [];
  const risks = report.risks ?? [];
  const channels = report.channels ?? [];
  const audience = report.audience ?? null;
  const pricing = report.pricing ?? null;
  // Fiches antérieures au 29/09/2026 : pas de rubriques détaillées, les concurrents et le plan en tiennent lieu.
  const legacy = findings.length === 0 && !audience && !pricing && risks.length === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold tracking-wider text-brand-green-text uppercase">Voir</span>
                {isExampleReport && <Badge variant="info">Rapport d’exemple</Badge>}
                {report.market && <Badge variant="outline">{countryName(report.market)}</Badge>}
                <span className="text-xs text-muted-foreground">Édition : {report.dateCreated}</span>
              </div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{report.nicheName}</h1>
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                <Search className="size-4" aria-hidden="true" />
                Requête analysée : <span className="font-medium text-foreground">« {report.query} »</span>
              </p>
            </div>
            <div className="shrink-0 space-y-1.5 rounded-lg border bg-muted/40 p-4 lg:max-w-xs">
              <p className="text-xs text-muted-foreground">Verdict de l’analyse</p>
              {report.overallVerdict ? (
                <Badge variant={VERDICT_VARIANT[report.overallVerdict]} className="px-2.5 py-1 text-sm">
                  {report.overallVerdict}
                </Badge>
              ) : (
                <Badge variant="secondary" className="px-2.5 py-1 text-sm">
                  Non établi
                </Badge>
              )}
              {report.verdictRationale && <p className="text-xs leading-relaxed text-muted-foreground">{report.verdictRationale}</p>}
            </div>
          </div>

          <p className="max-w-4xl text-base leading-relaxed sm:text-lg">{report.executiveSummary}</p>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button variant="outline" onClick={onNavigateToProducts}>
              Idées de produits ({report.digitalProducts.length})
              <ArrowRight />
            </Button>
            <Button onClick={onNavigateToMetaAds}>
              Préparer les créatifs
              <ArrowRight />
            </Button>
            {onDelete && (
              <span className="sm:ml-auto">
                <DeleteReportButton nicheName={report.nicheName} onDelete={onDelete} />
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {findings.length > 0 && (
        <Section icon={Lightbulb} title="Ce qu’il faut retenir">
          <div className="grid gap-3 md:grid-cols-2">
            {findings.map((finding) => (
              <article key={finding.title} className="rounded-2xl border bg-muted/30 p-4">
                <p className="font-semibold">{finding.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{finding.detail}</p>
              </article>
            ))}
          </div>
        </Section>
      )}

      {(audience || pricing) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {audience && (
            <Section icon={UserRound} title="Votre acheteur">
              <p className="text-sm leading-relaxed">{audience.profile}</p>
              {audience.pains.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Ce qui le bloque</p>
                  <Bullets items={audience.pains} />
                </div>
              )}
              {audience.motivations.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Pourquoi il achète</p>
                  <Bullets items={audience.motivations} tone="good" />
                </div>
              )}
              {audience.objections.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Ses freins, et quoi lui répondre</p>
                  <Bullets items={audience.objections} />
                </div>
              )}
            </Section>
          )}
          {pricing && (
            <Section icon={CreditCard} title="Prix et paiement">
              {pricing.observed && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Prix constatés</p>
                  <p className="text-sm leading-relaxed">{pricing.observed}</p>
                </div>
              )}
              {pricing.recommendation && (
                <div className="space-y-1 rounded-2xl bg-brand-green/10 p-4">
                  <p className="text-xs font-semibold tracking-wide text-brand-green-text uppercase">Notre recommandation</p>
                  <p className="text-sm leading-relaxed font-medium">{pricing.recommendation}</p>
                </div>
              )}
              {pricing.paymentMethods.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pricing.paymentMethods.map((method) => (
                    <Badge key={method} variant="secondary" className="font-normal">
                      {method}
                    </Badge>
                  ))}
                </div>
              )}
            </Section>
          )}
        </div>
      )}

      {channels.length > 0 && (
        <Section icon={Megaphone} title="Où vendre et se faire connaître">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {channels.map((channel) => (
              <article key={channel.channel} className="rounded-2xl border p-4">
                <p className="font-semibold">{channel.channel}</p>
                <p className="mt-1 text-sm text-muted-foreground">{channel.why}</p>
              </article>
            ))}
          </div>
        </Section>
      )}

      {risks.length > 0 && (
        <Section icon={ShieldCheck} title="Risques et parades">
          <ul className="space-y-3">
            {risks.map((risk) => (
              <li key={risk.risk} className="grid gap-2 rounded-2xl border p-4 sm:grid-cols-2 sm:gap-6">
                <p className="text-sm">
                  <span className="font-semibold">Risque : </span>
                  {risk.risk}
                </p>
                <p className="text-sm">
                  <span className="font-semibold text-brand-green-text">Parade : </span>
                  {risk.mitigation}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {legacy && report.strategicActionPlan.length > 0 && (
        <Section icon={Target} title="Plan d’action">
          <ol className="grid gap-3 md:grid-cols-3">
            {report.strategicActionPlan.map((phase, index) => (
              <li key={`${phase.phase}-${index}`} className="rounded-2xl border p-4">
                <p className="text-xs font-semibold tracking-wide text-brand-green-text uppercase">{phase.phase}</p>
                <p className="mt-1 font-semibold">{phase.title}</p>
                <Bullets items={phase.steps} />
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Détail complet et rédaction du rapport : dans le Dossier PDF (décision du 29/09/2026). */}
      <div className="flex flex-col gap-4 rounded-3xl border bg-gradient-to-br from-brand-green/10 via-card to-card p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-display text-lg font-bold">
            <Sparkles className="size-4 text-brand-green-text" aria-hidden />
            Le rapport complet de cette niche
          </p>
          <p className="text-sm text-muted-foreground">
            Taux en image, concurrents, idées de produits, scripts vidéo et sources dans le Dossier PDF — et la rédaction du
            rapport, de 1 à 250 pages, à la taille que vous choisissez.
          </p>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link to="/app/dossier-pdf#rediger">
            <FileText aria-hidden />
            Rédiger un rapport
          </Link>
        </Button>
      </div>

      <LegalNotice variant="block" />
    </div>
  );
}

function DeleteReportButton({ nicheName, onDelete }: { nicheName: string; onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onDelete();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="text-muted-foreground">
          <Trash2 />
          Supprimer le rapport
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Supprimer ce rapport ?</DialogTitle>
          <DialogDescription>
            Le rapport « {nicheName} » sera effacé de votre compte. Les points de l’analyse ne sont pas rendus.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose asChild>
            <Button variant="outline">Annuler</Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy && <Spinner />}
            Supprimer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
