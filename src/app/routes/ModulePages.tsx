import { useNavigate } from 'react-router-dom';
import { ACCOUNT_PATH, pathOf, type ModuleId } from '@/app/navigation';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { AccountView } from '@/features/account/AccountView';
import { CockpitDashboard } from '@/modules/cockpit/CockpitDashboard';
import { AdGalleryView } from '@/modules/m01-radar/AdGalleryView';
import { RadarTrendsView } from '@/modules/m01-radar/RadarTrendsView';
import { ReportPDFView } from '@/modules/m02-analyse/ReportPDFView';
import { StrategicAnalysisView } from '@/modules/m02-analyse/StrategicAnalysisView';
import { DigitalProductsView } from '@/modules/m03-studio/DigitalProductsView';
import { CreativeGeneratorPanel } from '@/modules/m04-creatifs/CreativeGeneratorPanel';
import { MetaVideoStudioView } from '@/modules/m04-creatifs/MetaVideoStudioView';
import { LaunchKitView } from '@/modules/m05-kit-lancement/LaunchKitView';
import { DistributionView } from '@/modules/m06-distribution/DistributionView';
import { AffiliationView } from '@/modules/m07-affiliation/AffiliationView';
import { StorybookView } from '@/modules/m08-storybook/StorybookView';
import { ProductPageBuilderView } from '@/modules/m09-pages/ProductPageBuilderView';
import { CampaignBlueprintsView } from '@/modules/m11-campagnes/CampaignBlueprintsView';
import { PlaceholderModuleView } from '@/shared/ui/PlaceholderModuleView';

/**
 * Un composant par route. Chaque page lit la niche active dans l'espace de
 * travail et traduit ses liens internes en adresses.
 */

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
    <div className="space-y-10">
      <CreativeGeneratorPanel />
      <MetaVideoStudioView
        campaigns={currentReport.adCampaigns}
        provenance={currentReport.dataProvenance?.adCampaigns}
      />
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
