import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart3, BookImage, BookOpen, ImageIcon, Languages } from 'lucide-react';
import { toast } from 'sonner';
import { REVIEW_LEVELS, type GuideSection, type ReviewLevel } from '@server/shared/guides';
import { detectLanguage } from '@server/shared/languageDetect';
import { LANGUAGE_RANKING_SOURCE, TOP_LANGUAGES, languageName } from '@server/shared/languages';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { LevelBadge } from '@/modules/multilingue/GuideBadges';
import { ReviewerPanel } from '@/modules/multilingue/ReviewerPanel';
import { type GuideSummary, guidesApi } from '@/modules/multilingue/guidesApi';
import { WORK_LABELS, type WorkKind, productSections, reportSections, storybookSections, textOf } from '@/modules/multilingue/sources';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { useAccountProducts } from '@/shared/stores/useAccountProducts';
import { useProductDrafts } from '@/shared/stores/useProductDrafts';
import type { MarketAnalysisReport, ReportDocument } from '@/shared/types/analysis';
import type { StorybookEntry } from '@/shared/types/storybook';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';

/**
 * Module 10 — Guides multilingues : traduire ce que l'on a déjà créé.
 *
 * Demande du propriétaire, 11/10/2026 : « on ne crée pas de guide, on traduit les rapports
 * disponibles, les ebooks disponibles, les storybooks disponibles », et « le bouton de traduction
 * ne fonctionne pas ». Reproduit le même jour avec le vrai service : la traduction aboutissait —
 * mais « Traduire » ouvrait un formulaire « Nouveau guide », il fallait « Créer le guide », puis
 * trouver « Ajouter des langues » sur l'écran suivant. Trois gestes avant le premier mot traduit,
 * dont aucun ne s'appelait traduire.
 *
 * L'écran liste maintenant ce qui existe — ouvrages, rapports, contes — et « Traduire » ouvre
 * directement le choix des langues. Le « guide » reste, en coulisse, ce qui tient le texte et
 * ses traductions ; on ne le crée plus à la main.
 */

interface Work {
  kind: WorkKind;
  id: string;
  title: string;
  /** Ce qui situe l'œuvre : son type, sa date. */
  detail: string;
}

const ICONS: Record<WorkKind, typeof BookOpen> = { product: BookOpen, report: BarChart3, storybook: BookImage };
const keyOf = (kind: WorkKind, id: string) => `${kind}:${id}`;

function LevelsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Trois niveaux de relecture</h2>
        </CardTitle>
        <CardDescription>Chaque traduction indique le sien, jusque dans ses exports.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-4 md:grid-cols-3">
          {(['C', 'B', 'A'] as ReviewLevel[]).map((level) => (
            <li key={level} className="space-y-2 rounded-lg border p-4">
              <LevelBadge level={level} compact />
              <p className="text-sm font-medium">{REVIEW_LEVELS[level].short}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{REVIEW_LEVELS[level].description}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TopLanguagesCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <Languages className="size-4 text-brand-green-text" aria-hidden="true" />
            Les 10 langues les plus parlées au monde
          </h2>
        </CardTitle>
        <CardDescription>{LANGUAGE_RANKING_SOURCE} D’autres langues, dont plusieurs langues africaines, sont aussi disponibles.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {TOP_LANGUAGES.map((language) => (
            <li key={language.code} className="flex items-center gap-2 rounded-lg bg-muted/50 p-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background text-xs font-bold tabular-nums" aria-hidden="true">
                {language.rank}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{language.fr}</span>
                <span className="block truncate text-xs text-muted-foreground" lang={language.code} dir={language.direction}>
                  {language.native}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** Langues déjà obtenues pour une œuvre, ou ce qui manque encore. */
function TranslationBadges({ guide }: { guide: GuideSummary | undefined }) {
  if (!guide || guide.translations.length === 0) return <span className="text-xs text-muted-foreground">Pas encore traduit</span>;
  return (
    <>
      {guide.translations.map((translation) => (
        <Badge key={translation.language} variant={translation.outdated ? 'warning' : translation.level === 'A' ? 'success' : 'outline'}>
          {languageName(translation.language)} · {translation.level}
        </Badge>
      ))}
    </>
  );
}

/** Une famille d'œuvres à traduire : ouvrages, rapports ou contes. */
function WorksCard({
  kind,
  works,
  loading,
  guides,
  busy,
  onTranslate,
}: {
  kind: WorkKind;
  works: Work[];
  loading: boolean;
  guides: Map<string, GuideSummary>;
  busy: string | null;
  onTranslate: (work: Work) => void;
}) {
  const Icon = ICONS[kind];
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <Icon className="size-4 text-brand-green-text" aria-hidden="true" />
            {WORK_LABELS[kind].many}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && works.length === 0 ? (
          <Skeleton className="h-20 rounded-lg" />
        ) : works.length === 0 ? (
          <p className="text-sm text-muted-foreground">{WORK_LABELS[kind].empty}</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {works.map((work) => {
              const guide = guides.get(keyOf(work.kind, work.id));
              const enCours = busy === keyOf(work.kind, work.id);
              return (
                <li key={work.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-medium" title={work.title}>
                      {work.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{work.detail}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TranslationBadges guide={guide} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => onTranslate(work)} disabled={busy !== null} aria-label={`Traduire « ${work.title} »`}>
                      {enCours ? <Spinner /> : <Languages />}
                      Traduire
                    </Button>
                    {guide && guide.translations.length > 0 && (
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/app/multilingue/${guide.id}`}>Voir les traductions</Link>
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Textes traduits autrefois à partir d'un texte collé : ils restent accessibles, on n'en crée plus. */
function OtherGuides({ guides }: { guides: GuideSummary[] }) {
  if (guides.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Autres textes traduits</h2>
        </CardTitle>
        <CardDescription>Des textes que vous aviez collés ici : leurs traductions restent à vous.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-4 md:grid-cols-2">
          {guides.map((guide) => (
            <li key={guide.id}>
              <Link
                to={`/app/multilingue/${guide.id}`}
                className="block h-full rounded-xl border bg-card p-5 transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <p className="font-display text-lg leading-snug font-bold">{guide.title}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                  <span>{languageName(guide.sourceLanguage)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{guide.words.toLocaleString('fr-FR')} mots</span>
                  {guide.hasCover && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <ImageIcon className="size-3.5" aria-hidden="true" />
                        couverture
                      </span>
                    </>
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <TranslationBadges guide={guide} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Modifié le {formatDateFr(guide.updatedAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Translations() {
  const { account } = useAuth();
  const navigate = useNavigate();
  const { currentReport, reports } = useWorkspace();
  const drafts = useProductDrafts();
  const mine = useAccountProducts(currentReport);
  const [data, setData, keepData] = useCachedState<{ limits: { languages: number | null }; guides: GuideSummary[] }>('/api/guides');
  const [storybooks, setStorybooks] = useCachedState<StorybookEntry[]>('/api/storybook/books');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    guidesApi
      .list()
      .then((loaded) => {
        // Retenue même si l'écran a été quitté entre-temps : elle servira à sa prochaine ouverture.
        keepData(loaded);
        if (!cancelled) setData(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'Vos traductions n’ont pas pu être chargées.').message);
      });
    apiRequest<{ storybooks: StorybookEntry[] }>('/api/storybook/books')
      .then(({ storybooks: loaded }) => setStorybooks(loaded))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setData, keepData, setStorybooks]);

  const products = useMemo(() => mine.all.map((product) => drafts.effective(product)), [mine, drafts]);
  const works = useMemo<Record<WorkKind, Work[]>>(
    () => ({
      product: products.map((product) => ({ kind: 'product', id: product.id, title: product.title, detail: `${product.typeName} · ${product.tableOfContents.length} modules` })),
      report: reports.map((report) => ({ kind: 'report', id: report.id, title: report.nicheName, detail: `Analysé le ${formatDateFr(report.createdAt)}` })),
      // Un conte encore en cours d'écriture n'a pas son texte définitif : il se traduira une fois prêt.
      storybook: (storybooks ?? [])
        .filter((entry) => entry.status === 'completed')
        .map((entry) => ({ kind: 'storybook', id: entry.id, title: entry.title, detail: `${entry.pages} pages · créé le ${formatDateFr(entry.createdAt)}` })),
    }),
    [products, reports, storybooks],
  );
  const guides = useMemo(() => new Map((data?.guides ?? []).flatMap((guide) => (guide.source ? [[keyOf(guide.source.kind, guide.source.id), guide] as const] : []))), [data]);

  /** Le texte qui part à la traduction, lu à l'instant : c'est l'œuvre telle qu'elle est aujourd'hui. */
  const sectionsOf = useCallback(
    async (work: Work): Promise<{ sections: GuideSection[]; language: string | null }> => {
      if (work.kind === 'product') {
        const product = products.find((candidate) => candidate.id === work.id);
        return { sections: product ? productSections(product) : [], language: null };
      }
      if (work.kind === 'storybook') {
        const entry = (storybooks ?? []).find((candidate) => candidate.id === work.id);
        return { sections: entry ? storybookSections(entry) : [], language: entry?.language ?? null };
      }
      const [{ report }, written] = await Promise.all([
        apiRequest<{ report: MarketAnalysisReport }>(`/api/reports/${encodeURIComponent(work.id)}`),
        apiRequest<{ document: ReportDocument | null }>(`/api/reports/${encodeURIComponent(work.id)}/document`).catch(() => ({ document: null })),
      ]);
      return { sections: reportSections(report, written.document), language: null };
    },
    [products, storybooks],
  );

  const translate = useCallback(
    async (work: Work) => {
      setBusy(keyOf(work.kind, work.id));
      try {
        const { sections, language } = await sectionsOf(work);
        if (sections.length === 0) {
          toast.error('Rien à traduire pour l’instant', { description: `« ${work.title} » n’a pas encore de texte : rédigez-le, puis revenez le traduire.` });
          return;
        }
        const guide = await guidesApi.create({
          title: work.title,
          sourceLanguage: language ?? detectLanguage(textOf(sections))?.code ?? 'fr',
          sections,
          terms: [],
          source: { kind: work.kind, id: work.id },
        });
        // Le choix des langues s'ouvre tout de suite : « Traduire » traduit.
        void navigate(`/app/multilingue/${guide.id}`, { state: { traduire: true } });
      } catch (caught) {
        toast.error('Traduction impossible', { description: toApiError(caught, 'Cette œuvre n’a pas pu être préparée pour la traduction.').message });
      } finally {
        setBusy(null);
      }
    },
    [sectionsOf, navigate],
  );

  /*
    « Traduire », depuis Mes créations : on arrive avec l'œuvre désignée, et le choix des langues
    s'ouvre sans rien demander de plus. La demande s'applique dès que l'œuvre est là, une seule fois.
  */
  const state = useLocation().state as { produit?: unknown; rapport?: unknown; conte?: unknown } | null;
  const asked = useMemo<Work | null>(() => {
    const find = (kind: WorkKind, id: unknown) => (typeof id === 'string' ? (works[kind].find((work) => work.id === id) ?? null) : null);
    return find('product', state?.produit) ?? find('report', state?.rapport) ?? find('storybook', state?.conte);
  }, [state, works]);
  const applied = useRef(false);
  useEffect(() => {
    if (!asked || applied.current) return;
    applied.current = true;
    void translate(asked);
  }, [asked, translate]);

  const limit = data?.limits.languages;
  const others = (data?.guides ?? []).filter((guide) => !guide.source);

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {limit !== undefined && (
        <p className="text-sm text-muted-foreground">
          {limit === null
            ? `Traductions illimitées avec le palier ${account?.plan.label ?? ''}.`
            : `${limit} langue${limit > 1 ? 's' : ''} par œuvre avec le palier ${account?.plan.label ?? ''}.`}
        </p>
      )}
      {(['product', 'report', 'storybook'] as WorkKind[]).map((kind) => (
        <WorksCard key={kind} kind={kind} works={works[kind]} loading={kind === 'storybook' ? storybooks === null : false} guides={guides} busy={busy} onTranslate={(work) => void translate(work)} />
      ))}
      <OtherGuides guides={others} />
    </div>
  );
}

export function MultilingualGuidesView() {
  const { account } = useAuth();
  const [params, setParams] = useSearchParams();
  const canReview = account?.permissions.includes('guides.review') ?? false;
  const tab = canReview && params.get('onglet') === 'relectures' ? 'relectures' : 'guides';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Créer"
        title="Guides multilingues"
        description="Traduisez ce que vous avez déjà créé — vos ebooks, vos rapports d’analyse, vos contes illustrés — dans les langues les plus parlées au monde, puis faites relire et exportez."
      />

      {canReview ? (
        <Tabs value={tab} onValueChange={(value) => setParams(value === 'relectures' ? { onglet: 'relectures' } : {}, { replace: true })} className="gap-4">
          <TabsList>
            <TabsTrigger value="guides">Mes traductions</TabsTrigger>
            <TabsTrigger value="relectures">Relectures</TabsTrigger>
          </TabsList>
          <TabsContent value="guides" className="space-y-6">
            <Translations />
            <TopLanguagesCard />
            <LevelsCard />
          </TabsContent>
          <TabsContent value="relectures">
            <ReviewerPanel />
          </TabsContent>
        </Tabs>
      ) : (
        <>
          <Translations />
          <TopLanguagesCard />
          <LevelsCard />
        </>
      )}
    </div>
  );
}
