import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, FilePlus2, ImageIcon, Languages } from 'lucide-react';
import { REVIEW_LEVELS, parseGuideText, wordCount, type GuideSection, type ReviewLevel } from '@server/shared/guides';
import { LANGUAGE_RANKING_SOURCE, TOP_LANGUAGES, languageName } from '@server/shared/languages';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { LevelBadge } from '@/modules/m10-multilingue/GuideBadges';
import { LanguageSelect } from '@/modules/m10-multilingue/LanguagePicker';
import { ReviewerPanel } from '@/modules/m10-multilingue/ReviewerPanel';
import { type Guide, type GuideSummary, guidesApi } from '@/modules/m10-multilingue/guidesApi';
import { PageHeader } from '@/shared/components/PageHeader';
import { ApiError, toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { useCustomProducts } from '@/shared/lib/useCustomProducts';
import { useProductDrafts } from '@/shared/lib/useProductDrafts';
import type { DigitalProductIdea } from '@/shared/types/analysis';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { NoDataState } from '@/shared/ui/NoDataState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { Textarea } from '@/shared/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group';

/**
 * Module 10 — Guides multilingues : écrire un guide une fois, le traduire dans
 * les langues les plus parlées au monde, le faire relire, l'exporter en PDF
 * avec sa couverture.
 */

const newId = () => crypto.randomUUID().slice(0, 12);

function productSections(product: DigitalProductIdea): GuideSection[] {
  return [
    ...(product.transformationPromise.trim() ? [{ id: newId(), heading: 'Promesse', body: product.transformationPromise }] : []),
    ...(product.targetAudience.trim() ? [{ id: newId(), heading: 'Pour qui', body: product.targetAudience }] : []),
    ...product.tableOfContents.map((module) => ({ id: newId(), heading: `Module ${module.moduleNumber} — ${module.title}`, body: module.details })),
  ];
}

function firstIssue(error: ApiError): string {
  const issues = (error.details as { issues?: { message?: string }[] } | undefined)?.issues;
  return issues?.[0]?.message ?? error.message;
}

function CreateGuideDialog({ onCreated }: { onCreated: (guide: Guide) => void }) {
  const { currentReport } = useWorkspace();
  const drafts = useProductDrafts();
  const custom = useCustomProducts();
  const products = [...(currentReport?.digitalProducts ?? []), ...custom.products].map((product) => drafts.effective(product));

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'text' | 'product'>('text');
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('fr');
  const [text, setText] = useState('');
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const product = products.find((candidate) => candidate.id === productId);
  const preview = mode === 'text' ? parseGuideText(text, () => '') : product ? productSections(product) : [];
  const effectiveTitle = (mode === 'product' && !title.trim() ? (product?.title ?? '') : title).trim();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const sections = mode === 'text' ? parseGuideText(text, newId) : product ? productSections(product) : [];
    if (sections.length === 0) {
      setError(mode === 'text' ? 'Collez le texte du guide.' : 'Choisissez un produit du Studio.');
      return;
    }
    setBusy(true);
    try {
      const guide = await guidesApi.create({ title: effectiveTitle, sourceLanguage: language, sections, terms: [] });
      setOpen(false);
      onCreated(guide);
    } catch (caught) {
      setError(firstIssue(toApiError(caught, 'Le guide n’a pas pu être créé.')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FilePlus2 />
          Nouveau guide
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nouveau guide</DialogTitle>
            <DialogDescription>Collez le texte d’un guide ou d’un ebook, ou partez d’un produit du Studio.</DialogDescription>
          </DialogHeader>

          <ToggleGroup
            type="single"
            variant="outline"
            value={mode}
            onValueChange={(value) => value && setMode(value as 'text' | 'product')}
            aria-label="Point de départ"
            className="flex-wrap"
          >
            <ToggleGroupItem value="text">Coller un texte</ToggleGroupItem>
            <ToggleGroupItem value="product" disabled={products.length === 0}>
              Depuis le Studio
            </ToggleGroupItem>
          </ToggleGroup>
          {products.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Pour partir d’un produit, analysez une niche ou créez votre produit dans le Studio.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="guide-title">Titre</Label>
              <Input
                id="guide-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                placeholder={mode === 'product' && product ? product.title : 'Ex. Élever des poulets en ville'}
                required={mode === 'text'}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guide-language">Langue du texte</Label>
              <LanguageSelect id="guide-language" value={language} onChange={setLanguage} />
            </div>
          </div>

          {mode === 'text' ? (
            <div className="space-y-1.5">
              <Label htmlFor="guide-text">Texte du guide</Label>
              <Textarea
                id="guide-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={12}
                maxLength={120_000}
                placeholder={'# Budget\nPrévoir 150 000 FCFA pour 50 poussins…\n\n# Alimentation\nDeux repas par jour…'}
              />
              <p className="text-xs text-muted-foreground">
                Chaque ligne qui commence par # ouvre une section.
                {preview.length > 0 && ` ${preview.length} section${preview.length > 1 ? 's' : ''}, ${wordCount(preview).toLocaleString('fr-FR')} mots.`}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="guide-product">Produit du Studio</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger id="guide-product" className="w-full">
                  <SelectValue placeholder="Choisissez un produit" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {product && (
                <p className="text-xs text-muted-foreground">
                  Promesse, public et {product.tableOfContents.length} modules repris, soit {preview.length} sections à compléter ensuite.
                </p>
              )}
            </div>
          )}

          {error && (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy || effectiveTitle.length < 2}>
              {busy && <Spinner />}
              Créer le guide
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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

function GuideList({ onCreated }: { onCreated: (guide: Guide) => void }) {
  const { account } = useAuth();
  const [data, setData] = useState<{ limits: { languages: number | null }; guides: GuideSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    guidesApi
      .list()
      .then((loaded) => {
        if (!cancelled) setData(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'Les guides n’ont pas pu être chargés.').message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-2" role="status" aria-label="Chargement des guides">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
    );
  }

  const limit = data.limits.languages;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {limit === null
          ? `Traductions illimitées avec le palier ${account?.plan.label ?? ''}.`
          : `${limit} langue${limit > 1 ? 's' : ''} par guide avec le palier ${account?.plan.label ?? ''}.`}
      </p>
      {data.guides.length === 0 ? (
        <NoDataState
          icon={BookOpen}
          title="Aucun guide pour l’instant"
          reason="Collez le texte d’un guide ou d’un ebook, ou partez d’un produit du Studio : vous le traduirez ensuite."
        >
          <CreateGuideDialog onCreated={onCreated} />
        </NoDataState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.guides.map((guide) => (
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
                  {guide.translations.length === 0 ? (
                    <span className="text-xs text-muted-foreground">Pas encore traduit</span>
                  ) : (
                    guide.translations.map((translation) => (
                      <Badge key={translation.language} variant={translation.outdated ? 'warning' : translation.level === 'A' ? 'success' : 'outline'}>
                        {languageName(translation.language)} · {translation.level}
                      </Badge>
                    ))
                  )}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Modifié le {formatDateFr(guide.updatedAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MultilingualGuidesView() {
  const { account } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canReview = account?.permissions.includes('guides.review') ?? false;
  const tab = canReview && params.get('onglet') === 'relectures' ? 'relectures' : 'guides';
  const openGuide = (guide: Guide) => navigate(`/app/multilingue/${guide.id}`);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Créer"
        title="Guides multilingues"
        description="Écrivez un guide une fois, traduisez-le dans les langues les plus parlées au monde, faites-le relire, puis exportez-le en PDF avec sa couverture."
        actions={<CreateGuideDialog onCreated={openGuide} />}
      />

      <TopLanguagesCard />

      {canReview ? (
        <Tabs value={tab} onValueChange={(value) => setParams(value === 'relectures' ? { onglet: 'relectures' } : {}, { replace: true })} className="gap-4">
          <TabsList>
            <TabsTrigger value="guides">Mes guides</TabsTrigger>
            <TabsTrigger value="relectures">Relectures</TabsTrigger>
          </TabsList>
          <TabsContent value="guides" className="space-y-6">
            <GuideList onCreated={openGuide} />
            <LevelsCard />
          </TabsContent>
          <TabsContent value="relectures">
            <ReviewerPanel />
          </TabsContent>
        </Tabs>
      ) : (
        <>
          <GuideList onCreated={openGuide} />
          <LevelsCard />
        </>
      )}
    </div>
  );
}
