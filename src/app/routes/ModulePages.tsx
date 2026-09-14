import { lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { ACCOUNT_PATH, pathOf, type ModuleId } from '@/app/navigation';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { AccountView } from '@/features/account/AccountView';
import { PageHeader } from '@/shared/components/PageHeader';
import { PlaceholderModuleView } from '@/shared/ui/PlaceholderModuleView';

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
const AdGalleryView = lazy(() =>
  import('@/modules/m01-radar/AdGalleryView').then((module) => ({ default: module.AdGalleryView })),
);
const RadarTrendsView = lazy(() =>
  import('@/modules/m01-radar/RadarTrendsView').then((module) => ({ default: module.RadarTrendsView })),
);
const ReportPDFView = lazy(() =>
  import('@/modules/m02-analyse/ReportPDFView').then((module) => ({ default: module.ReportPDFView })),
);
const StrategicAnalysisView = lazy(() =>
  import('@/modules/m02-analyse/StrategicAnalysisView').then((module) => ({ default: module.StrategicAnalysisView })),
);
const DigitalProductsView = lazy(() =>
  import('@/modules/m03-studio/DigitalProductsView').then((module) => ({ default: module.DigitalProductsView })),
);
const CreativeGeneratorPanel = lazy(() =>
  import('@/modules/m04-creatifs/CreativeGeneratorPanel').then((module) => ({ default: module.CreativeGeneratorPanel })),
);
const MetaVideoStudioView = lazy(() =>
  import('@/modules/m04-creatifs/MetaVideoStudioView').then((module) => ({ default: module.MetaVideoStudioView })),
);
const LaunchKitView = lazy(() =>
  import('@/modules/m05-kit-lancement/LaunchKitView').then((module) => ({ default: module.LaunchKitView })),
);
const DistributionView = lazy(() =>
  import('@/modules/m06-distribution/DistributionView').then((module) => ({ default: module.DistributionView })),
);
const AffiliationView = lazy(() =>
  import('@/modules/m07-affiliation/AffiliationView').then((module) => ({ default: module.AffiliationView })),
);
const StorybookView = lazy(() =>
  import('@/modules/m08-storybook/StorybookView').then((module) => ({ default: module.StorybookView })),
);
const ProductPageBuilderView = lazy(() =>
  import('@/modules/m09-pages/ProductPageBuilderView').then((module) => ({ default: module.ProductPageBuilderView })),
);
const CampaignBlueprintsView = lazy(() =>
  import('@/modules/m11-campagnes/CampaignBlueprintsView').then((module) => ({ default: module.CampaignBlueprintsView })),
);

function useGoTo() {
  const navigate = useNavigate();
  return (id: ModuleId) => navigate(pathOf(id));
}

export function CockpitPage() {
  const { currentReport } = useWorkspace();
  const goTo = useGoTo();
  const navigate = useNavigate();
  return (
    <CockpitDashboard report={currentReport} onNavigateToModule={goTo} onOpenBilling={() => navigate(ACCOUNT_PATH)} />
  );
}

export function RadarPage() {
  const { analyzeNiche, isAnalyzing } = useWorkspace();
  const goTo = useGoTo();
  return (
    <RadarTrendsView
      onSelectNicheForFullAnalysis={analyzeNiche}
      onNavigateToMetaAds={() => goTo('creatifs')}
      isAnalyzingNiche={isAnalyzing}
      onOpenExampleReport={() => goTo('analyse')}
    />
  );
}

export function GaleriePage() {
  return <AdGalleryView />;
}

export function AnalysePage() {
  const { currentReport } = useWorkspace();
  const goTo = useGoTo();
  return (
    <StrategicAnalysisView
      report={currentReport}
      onNavigateToProducts={() => goTo('studio')}
      onNavigateToMetaAds={() => goTo('creatifs')}
    />
  );
}

export function DossierPdfPage() {
  const { currentReport } = useWorkspace();
  return <ReportPDFView report={currentReport} />;
}

export function StudioPage() {
  const { currentReport } = useWorkspace();
  const goTo = useGoTo();
  return (
    <DigitalProductsView
      report={currentReport}
      products={currentReport.digitalProducts}
      onSelectProductForAd={() => goTo('creatifs')}
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
        description="Générez un visuel ou une vidéo, puis travaillez les scripts vidéo proposés pour la niche active."
      />
      <CreativeGeneratorPanel />
      <MetaVideoStudioView campaigns={currentReport.adCampaigns} provenance={currentReport.dataProvenance?.adCampaigns} />
    </div>
  );
}

export function StorybookPage() {
  return <StorybookView />;
}

export function PagesProduitsPage() {
  const { currentReport } = useWorkspace();
  return <ProductPageBuilderView report={currentReport} />;
}

export function KitLancementPage() {
  const { currentReport } = useWorkspace();
  return <LaunchKitView report={currentReport} />;
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
  return (
    <PlaceholderModuleView
      eyebrow="Créer"
      title="Guides multilingues"
      description="Prévu : des guides traduits en plusieurs langues, relus par des locuteurs natifs selon trois niveaux (Tier A, B et C)."
      blocker="Les niveaux A, B et C ne sont pas encore définis (langues couvertes, degré de relecture, prix), et le réseau de relecteurs suppose des comptes et des paiements qui n’existent pas encore. Aucune traduction n’est proposée ni simulée en attendant."
    />
  );
}

export function AccountPage() {
  const { analyzeNiche } = useWorkspace();
  return <AccountView onSelectSavedNiche={(niche) => void analyzeNiche(niche)} />;
}
