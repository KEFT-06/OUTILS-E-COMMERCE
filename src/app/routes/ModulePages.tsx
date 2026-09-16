import { lazy, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Compass, PenSquare, Sparkles } from 'lucide-react';
import { ACCOUNT_PATH, pathOf, type ModuleId } from '@/app/navigation';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { AccountView } from '@/features/account/AccountView';
import { PageHeader } from '@/shared/components/PageHeader';
import { useCustomProducts } from '@/shared/stores/useCustomProducts';
import type { DigitalProductIdea, MarketAnalysisReport } from '@/shared/types/analysis';
import { Button } from '@/shared/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * Un composant par route. Chaque page lit la niche active dans l'espace de
 * travail et traduit ses liens internes en adresses.
 *
 * Les écrans sont chargés à la demande : un créateur qui ouvre le Cockpit sur
 * une connexion mobile ne télécharge pas le studio vidéo ni le générateur de pages.
 */

const CockpitDashboard = lazy(() =>
  import('@/modules/cockpit/CockpitDashboard').then((module) => ({ default: module.CockpitDashboard })),
);
const NichesView = lazy(() => import('@/modules/niches/NichesView').then((module) => ({ default: module.NichesView })));
const ReportPDFView = lazy(() =>
  import('@/modules/analyse/ReportPDFView').then((module) => ({ default: module.ReportPDFView })),
);
const StrategicAnalysisView = lazy(() =>
  import('@/modules/analyse/StrategicAnalysisView').then((module) => ({ default: module.StrategicAnalysisView })),
);
const DigitalProductsView = lazy(() =>
  import('@/modules/studio/DigitalProductsView').then((module) => ({ default: module.DigitalProductsView })),
);
const CreativeGeneratorPanel = lazy(() =>
  import('@/modules/creatifs/CreativeGeneratorPanel').then((module) => ({ default: module.CreativeGeneratorPanel })),
);
const MetaVideoStudioView = lazy(() =>
  import('@/modules/creatifs/MetaVideoStudioView').then((module) => ({ default: module.MetaVideoStudioView })),
);
const LaunchKitView = lazy(() =>
  import('@/modules/kit-lancement/LaunchKitView').then((module) => ({ default: module.LaunchKitView })),
);
const DistributionView = lazy(() =>
  import('@/modules/distribution/DistributionView').then((module) => ({ default: module.DistributionView })),
);
const AffiliationView = lazy(() =>
  import('@/modules/affiliation/AffiliationView').then((module) => ({ default: module.AffiliationView })),
);
const StorybookView = lazy(() =>
  import('@/modules/storybook/StorybookView').then((module) => ({ default: module.StorybookView })),
);
const ProductPageBuilderView = lazy(() =>
  import('@/modules/pages-produits/ProductPageBuilderView').then((module) => ({ default: module.ProductPageBuilderView })),
);
const CampaignBlueprintsView = lazy(() =>
  import('@/modules/campagnes/CampaignBlueprintsView').then((module) => ({ default: module.CampaignBlueprintsView })),
);
const MultilingualGuidesView = lazy(() =>
  import('@/modules/multilingue/MultilingualGuidesView').then((module) => ({ default: module.MultilingualGuidesView })),
);
const GuideWorkspaceView = lazy(() =>
  import('@/modules/multilingue/GuideWorkspaceView').then((module) => ({ default: module.GuideWorkspaceView })),
);
const TranslationEditorView = lazy(() =>
  import('@/modules/multilingue/TranslationEditorView').then((module) => ({ default: module.TranslationEditorView })),
);
const ReviewEditorView = lazy(() =>
  import('@/modules/multilingue/ReviewEditorView').then((module) => ({ default: module.ReviewEditorView })),
);
/** Page d'impression d'un guide, hors de la mise en page de l'espace de travail. */
export const GuidePrintPage = lazy(() =>
  import('@/modules/multilingue/GuidePrintView').then((module) => ({ default: module.GuidePrintView })),
);

function useGoTo() {
  const navigate = useNavigate();
  return (id: ModuleId) => navigate(pathOf(id));
}

function LoadingWorkspace() {
  return (
    <div className="space-y-6" role="status" aria-label="Chargement">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

/**
 * Écrans construits sur un produit : ceux de la niche analysée et ceux créés dans
 * le Studio (à la main ou depuis une vidéo). Sans aucun produit, ils le disent et
 * proposent d'en obtenir un.
 */
function RequireProducts({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: (products: DigitalProductIdea[], report: MarketAnalysisReport | null) => ReactNode;
}) {
  const { currentReport, isLoadingReport, setAnalysisDialogOpen } = useWorkspace();
  const custom = useCustomProducts();
  const products = [...(currentReport?.digitalProducts ?? []), ...custom.products];

  if (products.length > 0) return <>{children(products, currentReport)}</>;
  if (isLoadingReport || custom.status === 'loading') return <LoadingWorkspace />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <Empty className="border border-dashed py-12">
        <EmptyHeader>
          <EmptyTitle>Aucun produit pour l’instant</EmptyTitle>
          <EmptyDescription>
            Cet écran part d’un produit : analysez une niche, ou créez votre produit dans le Studio, à la main ou depuis une
            vidéo.
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to={pathOf('studio')}>
              <PenSquare />
              Ouvrir le Studio
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setAnalysisDialogOpen(true)}>
            <Sparkles />
            Analyser une niche
          </Button>
        </div>
      </Empty>
    </div>
  );
}

/**
 * Écrans construits sur le rapport d'une niche. Sans rapport, ils le disent et
 * proposent d'en obtenir un : aucun rapport d'exemple n'est affiché à la place.
 */
function RequireReport({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: (report: MarketAnalysisReport) => ReactNode;
}) {
  const { currentReport, isLoadingReport, setAnalysisDialogOpen } = useWorkspace();
  if (currentReport) return <>{children(currentReport)}</>;
  if (isLoadingReport) return <LoadingWorkspace />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <Empty className="border border-dashed py-12">
        <EmptyHeader>
          <EmptyTitle>Aucune niche analysée pour l’instant</EmptyTitle>
          <EmptyDescription>
            Cet écran se remplit à partir de l’analyse d’une niche. Choisissez-en une dans le catalogue, ou lancez l’analyse
            de la vôtre.
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to={pathOf('niches')}>
              <Compass />
              Parcourir les niches
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setAnalysisDialogOpen(true)}>
            <Sparkles />
            Analyser une niche
          </Button>
        </div>
      </Empty>
    </div>
  );
}

export function CockpitPage() {
  const { currentReport } = useWorkspace();
  const goTo = useGoTo();
  const navigate = useNavigate();
  return (
    <CockpitDashboard report={currentReport} onNavigateToModule={goTo} onOpenBilling={() => navigate(ACCOUNT_PATH)} />
  );
}

export function NichesPage() {
  return <NichesView />;
}

export function AnalysePage() {
  const goTo = useGoTo();
  const { deleteReport } = useWorkspace();
  return (
    <RequireReport
      eyebrow="Voir"
      title="Analyse stratégique"
      description="Les 5 taux, la concurrence et le plan d’action de la niche analysée."
    >
      {(report) => (
        <StrategicAnalysisView
          report={report}
          onNavigateToProducts={() => goTo('studio')}
          onNavigateToMetaAds={() => goTo('creatifs')}
          onDelete={() => deleteReport(report.id)}
        />
      )}
    </RequireReport>
  );
}

export function DossierPdfPage() {
  return (
    <RequireReport eyebrow="Voir" title="Dossier PDF" description="Le rapport A4 de la niche analysée, à télécharger.">
      {(report) => <ReportPDFView report={report} />}
    </RequireReport>
  );
}

export function StudioPage() {
  const goTo = useGoTo();
  const { currentReport, isLoadingReport, setAnalysisDialogOpen } = useWorkspace();
  if (isLoadingReport && !currentReport) return <LoadingWorkspace />;
  return (
    <DigitalProductsView
      report={currentReport}
      onSelectProductForAd={() => goTo('creatifs')}
      onAnalyzeNiche={() => setAnalysisDialogOpen(true)}
    />
  );
}

export function CreatifsPage() {
  const { currentReport } = useWorkspace();
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Créer"
        title="Créatifs publicitaires"
        description="Générez une vidéo ou un visuel publicitaire structuré par une méthode (AIDA, PAS…), puis travaillez les scripts vidéo de la niche analysée."
      />
      <CreativeGeneratorPanel />
      <MetaVideoStudioView
        campaigns={currentReport?.adCampaigns ?? []}
        provenance={currentReport?.dataProvenance?.adCampaigns}
      />
    </div>
  );
}

export function StorybookPage() {
  return <StorybookView />;
}

export function PagesProduitsPage() {
  return (
    <RequireProducts eyebrow="Créer" title="Pages produits" description="Pages de vente en 7 sections, à partir de vos produits.">
      {(products) => <ProductPageBuilderView products={products} />}
    </RequireProducts>
  );
}

export function KitLancementPage() {
  return (
    <RequireProducts
      eyebrow="Vendre"
      title="Kit de lancement"
      description="Textes publicitaires, scripts et boutons d’appel à l’action par marché, pour l’un de vos produits."
    >
      {(products, report) => <LaunchKitView products={products} market={report?.market ?? null} />}
    </RequireProducts>
  );
}

export function CampagnesPage() {
  return <CampaignBlueprintsView />;
}

export function DistributionPage() {
  return <DistributionView />;
}

export function AffiliationPage() {
  return <AffiliationView />;
}

export function MultilinguePage() {
  return <MultilingualGuidesView />;
}

export function GuidePage() {
  return <GuideWorkspaceView />;
}

export function GuideTranslationPage() {
  return <TranslationEditorView />;
}

export function GuideReviewPage() {
  return <ReviewEditorView />;
}

export function AccountPage() {
  const { analyzeNiche } = useWorkspace();
  return <AccountView onSelectSavedNiche={(niche) => void analyzeNiche(niche)} />;
}
