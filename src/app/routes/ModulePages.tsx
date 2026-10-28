import { lazy, Suspense, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Compass, PenSquare, Sparkles } from 'lucide-react';
import { ACCOUNT_PATH, pathOf, type ModuleId } from '@/app/navigation';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { AccountView } from '@/features/account/AccountView';
import { AnalysisProgress } from '@/modules/analyse/AnalysisProgress';
import { PageHeader } from '@/shared/components/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { useCustomProducts } from '@/shared/stores/useCustomProducts';
import { useAccountProducts } from '@/shared/stores/useAccountProducts';
import type { DigitalProductIdea, MarketAnalysisReport } from '@/shared/types/analysis';
import { Button } from '@/shared/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty';
import { Skeleton } from '@/shared/ui/skeleton';
import { useScreenMemory } from '@/shared/lib/apiCache';

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
const RadarView = lazy(() => import('@/modules/radar/RadarView').then((module) => ({ default: module.RadarView })));
const AlertesView = lazy(() => import('@/modules/alertes/AlertesView').then((module) => ({ default: module.AlertesView })));
const EspionnageView = lazy(() =>
  import('@/modules/espionnage/EspionnageView').then((module) => ({ default: module.EspionnageView })),
);
const MarketBenchmarkPanel = lazy(() =>
  import('@/modules/analyse/MarketBenchmarkPanel').then((module) => ({ default: module.MarketBenchmarkPanel })),
);
const RadarMeasuredPanel = lazy(() =>
  import('@/modules/radar/RadarMeasuredPanel').then((module) => ({ default: module.RadarMeasuredPanel })),
);
const ReportPDFView = lazy(() =>
  import('@/modules/analyse/ReportPDFView').then((module) => ({ default: module.ReportPDFView })),
);
const StrategicAnalysisView = lazy(() =>
  import('@/modules/analyse/StrategicAnalysisView').then((module) => ({ default: module.StrategicAnalysisView })),
);
const DigitalProductsView = lazy(() =>
  import('@/modules/studio/DigitalProductsView').then((module) => ({ default: module.DigitalProductsView })),
);
const MetaVideoStudioView = lazy(() =>
  import('@/modules/campagnes/MetaVideoStudioView').then((module) => ({ default: module.MetaVideoStudioView })),
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
const CreationsView = lazy(() => import('@/modules/creations/CreationsView').then((module) => ({ default: module.CreationsView })));
const ReferralPanel = lazy(() => import('@/modules/affiliation/ReferralPanel').then((module) => ({ default: module.ReferralPanel })));

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
  const products = useAccountProducts(currentReport).all;

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
  const { currentReport, isLoadingReport } = useWorkspace();
  const goTo = useGoTo();
  const navigate = useNavigate();
  return (
    <CockpitDashboard
      report={currentReport}
      reportPending={isLoadingReport}
      onNavigateToModule={goTo}
      onOpenBilling={() => navigate(ACCOUNT_PATH)}
    />
  );
}

export function NichesPage() {
  return <NichesView />;
}

export function RadarPage() {
  return <RadarView />;
}

export function EspionnagePage() {
  return <EspionnageView />;
}

export function AlertesPage() {
  return <AlertesView />;
}

export function AnalysePage() {
  const goTo = useGoTo();
  const { deleteReport } = useWorkspace();
  return (
    <div className="space-y-6">
      <AnalysisProgress />
      {/* Les mesures du radar se posent à côté du rapport, jamais dedans : un rapport est
          un document daté, et ces chiffres changent chaque nuit. */}
      <Suspense fallback={null}>
        <RadarMeasuredPanel />
      </Suspense>
      <RequireReport
        eyebrow="Voir"
        title="Analyse stratégique"
        description="Les 5 taux, la concurrence et le plan d’action de la niche analysée."
      >
        {(report) => (
          <div className="space-y-6">
            {/* Comptage sur un marché international : combien d'offres existent déjà sur cette
                niche. À côté du rapport comme les mesures du radar, et pour la même raison. */}
            <Suspense fallback={null}>
              <MarketBenchmarkPanel niche={report.nicheName || report.query} />
            </Suspense>
            <StrategicAnalysisView
              report={report}
              onNavigateToProducts={() => goTo('studio')}
              onNavigateToLaunch={() => goTo('kit-lancement')}
              onDelete={() => deleteReport(report.id)}
            />
          </div>
        )}
      </RequireReport>
    </div>
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
      onPrepareLaunch={() => goTo('kit-lancement')}
      onAnalyzeNiche={() => setAnalysisDialogOpen(true)}
    />
  );
}

export function StorybookPage() {
  return <StorybookView />;
}

export function PagesProduitsPage() {
  return (
    <RequireProducts eyebrow="Créer" title="Pages produits" description="Pages de vente en 7 sections, à partir de vos produits.">
      {(products, report) => <ProductPageBuilderView products={products} report={report} />}
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
      {(products, report) => <LaunchKitView products={products} market={report?.market ?? null} report={report} />}
    </RequireProducts>
  );
}

/**
 * Structures de campagnes, puis les scripts vidéo de la niche analysée, scène par scène. Les scripts
 * vivaient dans « Créatifs publicitaires », retiré le 28/10/2026 avec la génération d'images et de
 * vidéos : ce sont des textes, ils restent, à côté des campagnes qu'ils servent.
 */
export function CampagnesPage() {
  const { currentReport, isLoadingReport } = useWorkspace();
  return (
    <div className="space-y-8">
      <CampaignBlueprintsView />
      {/* L'analyse n'est pas encore à l'écran : on ne dit pas qu'aucune niche n'a de campagne. */}
      {isLoadingReport && !currentReport ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : (
        <MetaVideoStudioView
          campaigns={currentReport?.adCampaigns ?? []}
          provenance={currentReport?.dataProvenance?.adCampaigns}
        />
      )}
    </div>
  );
}

export function DistributionPage() {
  return <DistributionView />;
}

/**
 * « Smart Gain » — deux façons de gagner, deux onglets : le parrainage de Smart Creator (on recommande le site, on
 * touche une commission), et les affiliés de sa propre boutique (ceux qui vendent ses produits).
 */
export function AffiliationPage() {
  const [params, setParams] = useSearchParams();
  // L'adresse décide quand elle nomme un onglet ; sinon, celui où l'on était.
  const [dernierOnglet, setDernierOnglet] = useScreenMemory<'boutique' | 'parrainage'>('smart-gain.onglet', 'parrainage');
  const demande = params.get('onglet');
  const onglet = demande === 'boutique' ? 'boutique' : demande === 'parrainage' ? 'parrainage' : dernierOnglet;
  return (
    <div className="space-y-6">
      <Tabs
        value={onglet}
        onValueChange={(next) => {
          setDernierOnglet(next === 'boutique' ? 'boutique' : 'parrainage');
          setParams(next === 'boutique' ? { onglet: 'boutique' } : {}, { replace: true });
        }}
      >
        <TabsList className="grid h-auto w-full grid-cols-2 sm:inline-flex sm:w-auto">
          <TabsTrigger value="parrainage" className="h-auto min-w-0 py-1.5 whitespace-normal">
            Parrainage Smart Creator
          </TabsTrigger>
          <TabsTrigger value="boutique" className="h-auto min-w-0 py-1.5 whitespace-normal">
            Affiliés de ma boutique
          </TabsTrigger>
        </TabsList>
        <TabsContent value="parrainage" className="space-y-6">
          <PageHeader eyebrow="Vendre" title="Smart Gain" description="Recommandez Smart Creator et touchez une commission sur les paiements des personnes que vous amenez." />
          <ReferralPanel />
        </TabsContent>
        <TabsContent value="boutique">
          <AffiliationView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function CreationsPage() {
  return <CreationsView />;
}

export function AccountPage() {
  const { analyzeNiche } = useWorkspace();
  return <AccountView onSelectSavedNiche={(niche) => void analyzeNiche(niche)} />;
}
