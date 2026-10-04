import { Fragment, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { BookOpenText, ChevronDown, Download, ExternalLink, FileText, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { ComplianceBlockedError, exportReportDocumentPDF } from '@/shared/lib/complianceGate';
import { type InlineSegment, type MarkdownBlock, parseInline, parseMarkdown } from '@/shared/lib/markdownBlocks';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import type { ReportComplianceVerdict } from '@/shared/types/compliance';
import type { ReportDocument } from '@/shared/types/analysis';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { Progress } from '@/shared/ui/progress';
import { Slider } from '@/shared/ui/slider';
import { cn } from '@/shared/lib/utils';

// Liseré animé pendant la rédaction seulement : sa bibliothèque ne se charge qu'à ce moment-là.
const BorderBeam = lazy(() => import('@/shared/ui/magicui/border-beam').then((module) => ({ default: module.BorderBeam })));

/**
 * Rapport rédigé, à la demande, après l'analyse.
 *
 * L'analyse produit la fiche ; l'utilisateur la lit, puis clique sur « Rédiger le rapport ».
 * Le plan est choisi par le rédacteur selon la niche, les taux de la fiche n'y figurent pas, et
 * l'annexe liste les sites consultés — les numéros [n] du texte y renvoient.
 */

const POLL_MS = 3_000;
/** Durée typique d'une rédaction, pour une barre d'attente qui avance sans mentir. */
/** Durée typique selon la longueur : un appel jusqu'à 6 pages, puis un plan et des parties en parallèle. */
const typicalMs = (pages: number) => {
  if (pages <= 6) return 60_000;
  // Plan, puis les parties cinq par cinq (environ 45 s par vague), comme le serveur.
  const parts = Math.min(100, Math.max(3, Math.round(pages / 2.5)));
  return 45_000 + Math.ceil(parts / 5) * 45_000;
};
/** Bornes du serveur (server/services/analysis/document.ts, REPORT_PAGES). */
const PAGES = { min: 1, max: 250, default: 10 } as const;
/** Longueurs proposées d'un geste ; le curseur permet toutes les autres. */
const QUICK_PAGES = [5, 10, 25, 50, 100, 250];

const STEPS = ['Relecture de l’étude du marché…', 'Choix du plan le mieux adapté à la niche…', 'Rédaction des parties…', 'Vérification des renvois vers les sources…', 'Contrôle de conformité…'];

const documentPath = (reportId: string) => `/api/reports/${encodeURIComponent(reportId)}/document`;

interface WrittenReportPanelProps {
  reportId: string;
  nicheName: string;
}

export function WrittenReportPanel({ reportId, nicheName }: WrittenReportPanelProps) {
  const { runWithCredits, costTable } = useCreditGate();
  const { account } = useAuth();
  const [pages, setPages] = useState<number>(PAGES.default);
  const [rewriting, setRewriting] = useState(false);
  const [document, setDocument] = useState<ReportDocument | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [blocked, setBlocked] = useState<ReportComplianceVerdict | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Rapport déjà rédigé, ou rédaction lancée avant un rechargement : on le retrouve.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setDocument(null);
    setExpanded(false);
    setBlocked(null);
    void apiRequest<{ document: ReportDocument | null }>(documentPath(reportId))
      .then(({ document: found }) => {
        if (!cancelled) setDocument(found);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const writing = document?.status === 'writing';

  useEffect(() => {
    if (!writing) return;
    let cancelled = false;
    const poll = setInterval(() => {
      void apiRequest<{ document: ReportDocument | null }>(documentPath(reportId))
        .then(({ document: next }) => {
          if (cancelled || !next) return;
          setDocument(next);
          if (next.status === 'ready') toast.success('Rapport rédigé', { description: 'Il est prêt à être lu et téléchargé en PDF.' });
          if (next.status === 'failed') toast.error('Le rapport n’a pas abouti', { description: next.error?.message, duration: 12_000 });
        })
        .catch(() => {
          // Coupure passagère : la rédaction continue sur le serveur.
        });
    }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [writing, reportId]);

  const start = async () => {
    setIsStarting(true);
    try {
      const response = await runWithCredits(
        'market_report_write',
        () => apiRequest<{ document: ReportDocument }>(documentPath(reportId), { method: 'POST', body: { pages: Math.min(pages, maxPages) } }),
        Math.min(pages, maxPages),
      );
      if (!response) return;
      setBlocked(null);
      setExpanded(false);
      setRewriting(false);
      setNow(Date.now());
      setDocument(response.document);
    } catch (error) {
      toast.error('Le rapport n’a pas pu être lancé', { description: toApiError(error, 'Réessayez dans un moment.').message });
    } finally {
      setIsStarting(false);
    }
  };

  const exportPdf = async () => {
    if (!document || document.status !== 'ready') return;
    setIsExporting(true);
    try {
      const verdict = await exportReportDocumentPDF(document, {
        nicheName,
        dateLabel: new Date(document.completedAt ?? document.startedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
      });
      setBlocked(null);
      const warnings = verdict.findings.filter((finding) => finding.severity === 'warn').length;
      toast.success('Rapport PDF téléchargé', warnings > 0 ? { description: `${warnings} point(s) de vigilance signalé(s) dans le document.` } : undefined);
    } catch (error) {
      if (error instanceof ComplianceBlockedError) {
        setBlocked(error.verdict);
        return;
      }
      toast.error('Le PDF n’a pas pu être généré', { description: 'Réessayez dans un moment.' });
    } finally {
      setIsExporting(false);
    }
  };

  const elapsed = document ? Math.max(0, now - new Date(document.startedAt).getTime()) : 0;
  const typical = typicalMs(document?.targetPages ?? pages);
  const step = STEPS[Math.min(STEPS.length - 1, Math.floor((elapsed / typical) * STEPS.length))]!;
  // Avancement réel quand le serveur le connaît (parties rédigées), sinon estimé au temps écoulé.
  const serverProgress = document?.progress && document.progress.total > 0 ? document.progress : null;
  const progress = serverProgress
    ? Math.max(5, Math.min(97, Math.round((serverProgress.done / serverProgress.total) * 100)))
    : Math.min(95, Math.round((elapsed / typical) * 100));
  // Plafond du palier : le même que pour les ebooks.
  const maxPages = Math.min(PAGES.max, account?.limits.ebookPages ?? PAGES.max);
  const action = costTable?.actions.find((candidate) => candidate.id === 'market_report_write');
  const cost = action ? (action.perUnit ? action.cost * Math.max(1, Math.ceil(pages / action.perUnit)) : action.cost) : null;
  const selector = (
    <PageSelector pages={Math.min(pages, maxPages)} max={maxPages} planLabel={account?.plan.label ?? null} onChange={setPages} cost={cost} minutes={Math.max(1, Math.round(typicalMs(pages) / 60_000))} />
  );

  return (
    <Card id="rediger" className="relative scroll-mt-24 overflow-hidden">
      {writing && (
        <Suspense fallback={null}>
          <BorderBeam size={120} duration={6} />
        </Suspense>
      )}
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpenText className="size-4 text-primary" aria-hidden />
          Rédiger le rapport
        </CardTitle>
        <CardDescription>
          Le rapport complet de cette analyse, à la longueur de votre choix, avec ses sources en annexe.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* Apparitions en CSS : la bibliothèque d'animation pesait 43 Ko pour quatre fondus. */}
        {!loaded ? (
          <div key="chargement" className="space-y-2" aria-busy>
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : writing ? (
          <div key="redaction" className="animate-in space-y-3 duration-300 fade-in-0 slide-in-from-bottom-1" role="status">
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
              <p key={step} className="animate-in text-sm font-medium duration-300 fade-in-0 slide-in-from-right-2">
                {step}
              </p>
            </div>
            <Progress value={progress} aria-label="Avancement de la rédaction" />
            <p className="text-xs text-muted-foreground">
              {serverProgress ? `${serverProgress.done} partie${serverProgress.done > 1 ? 's' : ''} sur ${serverProgress.total} rédigée${serverProgress.done > 1 ? 's' : ''}. ` : ''}
              Rapport de {document?.targetPages ?? pages} pages : comptez environ {Math.max(1, Math.round(typical / 60_000))} minute{typical >= 90_000 ? 's' : ''}. Vous pouvez quitter cette page : la rédaction continue et le rapport vous attendra ici.
            </p>
          </div>
        ) : document?.status === 'ready' && document.markdown ? (
          <div key="pret" className="animate-in space-y-5 duration-300 fade-in-0 slide-in-from-bottom-2">
            <ReadyToolbar document={document} isExporting={isExporting} isStarting={isStarting} onExport={() => void exportPdf()} onRewrite={() => setRewriting((open) => !open)} />

            {rewriting && (
              <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                {selector}
                <Button onClick={() => void start()} disabled={isStarting}>
                  {isStarting ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
                  Réécrire en {Math.min(pages, maxPages)} page{Math.min(pages, maxPages) > 1 ? 's' : ''}
                </Button>
              </div>
            )}

            {blocked && <BlockedNotice verdict={blocked} />}

            <div className="relative">
              <article
                className={cn('space-y-4 text-[0.95rem] leading-relaxed text-foreground/90', !expanded && 'max-h-[34rem] overflow-hidden')}
                aria-label={document.title ?? 'Rapport rédigé'}
                // Un renvoi [n] mène à l'annexe : replié, le rapport la cacherait.
                onClickCapture={(event) => {
                  if (!expanded && (event.target as HTMLElement).closest('a[href^="#source-"]')) setExpanded(true);
                }}
              >
                <MarkdownView markdown={document.markdown} />
                <Bibliography document={document} />
              </article>
              {!expanded && (
                <div className="absolute inset-x-0 bottom-0 flex h-40 items-end justify-center bg-gradient-to-t from-card via-card/90 to-transparent pb-2">
                  <Button variant="outline" onClick={() => setExpanded(true)}>
                    <ChevronDown />
                    Lire tout le rapport
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div key="a-rediger" className="animate-in space-y-3 duration-300 fade-in-0 slide-in-from-bottom-1">
            {document?.status === 'failed' && (
              <Alert variant="danger">
                <AlertTitle>La rédaction précédente n’a pas abouti</AlertTitle>
                <AlertDescription>{document.error?.message ?? 'Vos points ont été rendus. Relancez la rédaction ci-dessous.'}</AlertDescription>
              </Alert>
            )}
            {selector}
            <Button size="lg" onClick={() => void start()} disabled={isStarting}>
              {isStarting ? <Loader2 className="animate-spin" aria-hidden /> : <FileText aria-hidden />}
              {document?.status === 'failed' ? 'Relancer la rédaction' : `Rédiger le rapport de ${Math.min(pages, maxPages)} page${Math.min(pages, maxPages) > 1 ? 's' : ''}`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReadyToolbar(props: { document: ReportDocument; isExporting: boolean; isStarting: boolean; onExport: () => void; onRewrite: () => void }) {
  const { document } = props;
  const cited = document.bibliography.filter((source) => source.cited).length;
  const written = document.completedAt
    ? new Date(document.completedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {written && <span>Rédigé le {written}</span>}
        <Badge variant="secondary" className="font-normal">
          {document.bibliography.length} site{document.bibliography.length > 1 ? 's' : ''} en annexe
          {cited > 0 ? ` · ${cited} cité${cited > 1 ? 's' : ''}` : ''}
        </Badge>
        {document.compliance?.exportAllowed && (
          <Badge variant="secondary" className="gap-1 font-normal">
            <ShieldCheck className="size-3 text-success" aria-hidden />
            Conformité vérifiée
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={props.onRewrite} disabled={props.isStarting}>
          {props.isStarting ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          Réécrire
        </Button>
        <Button size="sm" onClick={props.onExport} disabled={props.isExporting}>
          {props.isExporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
          Télécharger en PDF
        </Button>
      </div>
    </div>
  );
}

function BlockedNotice({ verdict }: { verdict: ReportComplianceVerdict }) {
  const blocking = verdict.findings.filter((finding) => finding.severity === 'block');
  return (
    <Alert variant="danger">
      <AlertTitle>Export bloqué par le contrôle de conformité</AlertTitle>
      <AlertDescription>
        {verdict.unavailableReason ? (
          <p>{verdict.unavailableReason}</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {blocking.map((finding, index) => (
              <li key={`${finding.ruleId}-${index}`}>
                « {finding.matched} » ({finding.sectionLabel}) — {finding.rewriteHint}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2">Réécrivez le rapport : le nouveau texte sera contrôlé à son tour.</p>
      </AlertDescription>
    </Alert>
  );
}

function Inline({ text }: { text: string }) {
  const segments = useMemo<InlineSegment[]>(() => parseInline(text), [text]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.type === 'citation' ? (
          <a
            key={index}
            href={`#source-${segment.id}`}
            className="mx-px align-super text-[0.7em] font-semibold text-primary no-underline hover:underline"
            aria-label={`Source ${segment.id}`}
          >
            [{segment.id}]
          </a>
        ) : segment.bold ? (
          <strong key={index} className="font-semibold text-foreground">
            {segment.text}
          </strong>
        ) : segment.italic ? (
          <em key={index}>{segment.text}</em>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.type) {
    case 'heading':
      if (block.level === 1) return <h3 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl"><Inline text={block.text} /></h3>;
      if (block.level === 2) return <h4 className="border-b pb-1 pt-3 text-lg font-semibold text-foreground"><Inline text={block.text} /></h4>;
      return <h5 className="pt-1 text-base font-semibold text-foreground"><Inline text={block.text} /></h5>;
    case 'paragraph':
      return <p><Inline text={block.text} /></p>;
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List className={cn('space-y-1.5 pl-5', block.ordered ? 'list-decimal' : 'list-disc marker:text-primary')}>
          {block.items.map((item, index) => (
            <li key={index}><Inline text={item} /></li>
          ))}
        </List>
      );
    }
    case 'quote':
      return <blockquote className="border-l-4 border-primary/60 pl-4 italic text-muted-foreground"><Inline text={block.text} /></blockquote>;
    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-muted/60">
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} className="px-3 py-2 font-semibold"><Inline text={cell} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t">
                  {block.header.map((_, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 align-top"><Inline text={row[cellIndex] ?? ''} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr className="border-border" />;
  }
}

function MarkdownView({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);
  return (
    <>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </>
  );
}

function Bibliography({ document }: { document: ReportDocument }) {
  if (document.bibliography.length === 0) return null;
  return (
    <section className="space-y-3 border-t pt-5" aria-labelledby="annexe-bibliographie">
      <h4 id="annexe-bibliographie" className="text-lg font-semibold text-foreground">
        Annexe — Bibliographie des sites consultés
      </h4>
      <p className="text-xs text-muted-foreground">Les numéros entre crochets dans le texte renvoient à ces pages.</p>
      <ol className="space-y-2">
        {document.bibliography.map((source) => {
          const href = safeHttpUrl(source.url);
          return (
            <li key={source.id} id={`source-${source.id}`} className="scroll-mt-24 rounded-md border p-3 text-sm target:border-primary target:bg-primary/5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="font-medium text-foreground">
                  <span className="mr-1.5 tabular-nums text-primary">[{source.id}]</span>
                  {source.title}
                </span>
                <Badge variant={source.cited ? 'secondary' : 'outline'} className="font-normal">
                  {source.cited ? 'cité' : 'consulté'}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{source.site}</span>
                {source.publishedAt && <span>publié le {source.publishedAt}</span>}
                {href && (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    Ouvrir la page
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Longueur du rapport : curseur en pages et raccourcis, coût et durée annoncés avant de lancer. */
function PageSelector({
  pages,
  max,
  planLabel,
  onChange,
  cost,
  minutes,
}: {
  pages: number;
  max: number;
  planLabel: string | null;
  onChange: (pages: number) => void;
  cost: number | null;
  minutes: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label htmlFor="rapport-pages" className="text-sm font-semibold">
          Taille du rapport
        </Label>
        <span className="text-sm tabular-nums text-muted-foreground">
          <strong className="font-display text-lg text-foreground">{pages}</strong> page{pages > 1 ? 's' : ''}
          {cost !== null ? ` · ${cost} point${cost > 1 ? 's' : ''}` : ''} · environ {minutes} min
        </span>
      </div>
      <Slider id="rapport-pages" min={PAGES.min} max={max} step={1} value={[pages]} onValueChange={([value]) => onChange(value ?? pages)} />
      <div className="flex flex-wrap gap-2">
        {QUICK_PAGES.filter((value) => value <= max).map((value) => (
          <Button key={value} type="button" size="sm" variant={value === pages ? 'default' : 'outline'} className="h-9 min-w-12 tabular-nums" onClick={() => onChange(value)}>
            {value}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        De 1 à {max} pages{planLabel && max < PAGES.max ? ` avec votre palier ${planLabel}` : ''}. Au-delà de 40 pages, le rapport s’organise en chapitres.
      </p>
    </div>
  );
}
