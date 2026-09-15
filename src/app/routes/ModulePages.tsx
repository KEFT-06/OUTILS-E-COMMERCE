import { lazy, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Compass, Sparkles } from 'lucide-react';
import { ACCOUNT_PATH, pathOf, type ModuleId } from '@/app/navigation';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { AccountView } from '@/features/account/AccountView';
import { PageHeader } from '@/shared/components/PageHeader';
import type { MarketAnalysisReport } from '@/shared/types/analysis';
import { Button } from '@/shared/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty';
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
const NichesView = lazy(() => import('@/modules/niches/NichesView').then((module) => ({ default: module.NichesView })));
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
  const { currentReport, setAnalysisDialogOpen } = useWorkspace();
  if (currentReport) return <>{children(currentReport)}</>;

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

export function RadarPage() {
  const { analyzeNiche, isAnalyzing } = useWorkspace();
  const goTo = useGoTo();
  return (
    <RadarTrendsView
      onSelectNicheForFullAnalysis={analyzeNiche}
      onNavigateToMetaAds={() => goTo('creatifs')}
      isAnalyzingNiche={isAnalyzing}
      onBrowseNiches={() => goTo('niches')}
    />
  );
}

export function GaleriePage() {
  return <AdGalleryView />;
}

export function AnalysePage() {
  const goTo = useGoTo();
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
  return (
    <RequireReport
      eyebrow="Créer"
      title="Studio de création"
      description="Ebooks, templates et rentabilité des produits de la niche analysée."
    >
      {(report) => (
        <DigitalProductsView report={report} products={report.digitalProducts} onSelectProductForAd={() => goTo('creatifs')} />
      )}
    </RequireReport>
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
    <RequireReport eyebrow="Créer" title="Pages produits" description="Pages de vente en 7 sections, à partir de la niche analysée.">
      {(report) => <ProductPageBuilderView report={report} />}
    </RequireReport>
  );
}

export function KitLancementPage() {
  return (
    <RequireReport
      eyebrow="Vendre"
      title="Kit de lancement"
      description="Textes publicitaires, scripts et boutons d’appel à l’action par marché, pour un produit de la niche analysée."
    >
      {(report) => <LaunchKitView report={report} />}
    </RequireReport>
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
