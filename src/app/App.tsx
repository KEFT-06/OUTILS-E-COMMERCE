import { useState } from 'react';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { NexusHeader, StrategicTab } from '@/shared/layout/NexusHeader';
import { StrategicAnalysisView } from '@/modules/m02-analyse/StrategicAnalysisView';
import { DigitalProductsView } from '@/modules/m03-studio/DigitalProductsView';
import { MetaVideoStudioView } from '@/modules/m04-creatifs/MetaVideoStudioView';
import { ReportPDFView } from '@/modules/m02-analyse/ReportPDFView';
import { RadarTrendsView } from '@/modules/m01-radar/RadarTrendsView';
import { AdGalleryView } from '@/modules/m01-radar/AdGalleryView';
import { StorybookView } from '@/modules/m08-storybook/StorybookView';
import { CreativeGeneratorPanel } from '@/modules/m04-creatifs/CreativeGeneratorPanel';
import { CockpitDashboard } from '@/modules/cockpit/CockpitDashboard';
import { PlaceholderModuleView } from '@/shared/ui/PlaceholderModuleView';
import { LandingPage } from '@/features/landing/LandingPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { AccountView } from '@/features/account/AccountView';
import { BottomLeftModuleMenu } from '@/shared/layout/BottomLeftModuleMenu';
import { PRESET_ANALYSES } from '@/data/presetAnalyses';
import { MarketAnalysisReport } from '@/shared/types/analysis';
import { ComplianceBlockedError, exportReportPDF } from '@/shared/lib/complianceGate';
import { ReportComplianceVerdict } from '@/shared/types/compliance';
import { ComplianceBlockDialog } from '@/shared/ui/ComplianceBlockDialog';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

import { PreferencesProvider, usePreferences } from '@/app/providers/PreferencesContext';
import { CreditGateProvider, useCreditGate } from '@/app/providers/CreditGateProvider';

function NexusVeilleWorkspace() {
  const { viewMode, setViewMode } = useAuth();
  const { t } = usePreferences();
  const { runWithCredits } = useCreditGate();
  
  // Strategic Intelligence State
  const [activeStrategicTab, setActiveStrategicTab] = useState<StrategicTab>('cockpit');
  const [allReports, setAllReports] = useState<MarketAnalysisReport[]>(PRESET_ANALYSES);
  const [currentReport, setCurrentReport] = useState<MarketAnalysisReport>(PRESET_ANALYSES[0]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isExportingPDF, setIsExportingPDF] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'warning' | 'info'; message: string } | null>(null);

  // Verdict de conformité ayant refusé un export, affiché en détail à l'utilisateur.
  const [blockedVerdict, setBlockedVerdict] = useState<ReportComplianceVerdict | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'info' = 'success') => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3500);
  };

  /**
   * Analyse d'une nouvelle niche.
   *
   * Passe par la porte de crédits : le simulateur montre le coût, l'équivalent
   * monétaire et le solde avant/après, et l'appel n'est lancé qu'après
   * confirmation. Les points ne sont débités qu'en cas de succès — facturer une
   * analyse qui n'a rien produit serait indéfendable.
   */
  const handleSearchNewNiche = async (query: string) => {
    try {
      await runWithCredits('niche_analysis', async () => {
        setIsSearching(true);
        try {
          const response = await fetch('/api/analyze-niche', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          });

          if (!response.ok) {
            // Aucun repli fabriqué ici. Un rapport inventé — concurrents, volumes
            // de recherche, conformité « validée » — présenté comme une analyse du
            // marché est exactement ce que le CdC §9.4 interdit, et ce qui est
            // reproché au concurrent direct. On remonte le message du serveur, qui
            // explique ce qui manque réellement (clé absente, module pas livré).
            const payload = (await response.json().catch(() => null)) as
              | { error?: { message?: string } }
              | null;

            throw new Error(
              payload?.error?.message ??
                "L'analyse n'a pas pu être lancée. Réessayez dans un moment.",
            );
          }

          const data: MarketAnalysisReport = await response.json();
          setAllReports((prev) => [data, ...prev]);
          setCurrentReport(data);
          setActiveStrategicTab('veille');
          setViewMode('app');
          showToast(`Veille terminée pour « ${data.nicheName} »`);
        } finally {
          setIsSearching(false);
        }
      });
    } catch (err) {
      console.error('Erreur recherche niche:', err);
      showToast(
        err instanceof Error ? err.message : 'Erreur lors de la recherche',
        'warning',
      );
    }
  };

  // Export PDF — passe obligatoirement par la porte de conformité (CdC §6.4.1).
  const handleExportPDF = async () => {
    setIsExportingPDF(true);
    try {
      const verdict = await exportReportPDF(currentReport);

      showToast(
        verdict.findings.length > 0
          ? `Dossier PDF téléchargé — ${verdict.findings.length} point(s) de vigilance signalé(s).`
          : 'Dossier PDF téléchargé avec succès !',
        verdict.findings.length > 0 ? 'info' : 'success',
      );
    } catch (e) {
      if (e instanceof ComplianceBlockedError) {
        setBlockedVerdict(e.verdict);
        return;
      }
      console.error(e);
      showToast('Erreur export PDF', 'warning');
    } finally {
      setIsExportingPDF(false);
    }
  };

  // Switch between views according to viewMode
  if (viewMode === 'landing') {
    return <LandingPage />;
  }

  if (viewMode === 'login') {
    return <LoginPage />;
  }

  if (viewMode === 'account') {
    return (
      <AccountView
        onBackToApp={() => setViewMode('app')}
        onSelectSavedNiche={(nicheQuery) => handleSearchNewNiche(nicheQuery)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100/70 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col font-sans selection:bg-indigo-200 dark:selection:bg-indigo-900 selection:text-indigo-950 dark:selection:text-indigo-100 transition-colors duration-300">
      
      {/* Primary Strategic Header with Dropdown Modules Menu & User Menu */}
      <NexusHeader
        activeTab={activeStrategicTab}
        setActiveTab={setActiveStrategicTab}
        currentReport={currentReport}
        allReports={allReports}
        onSelectReport={(r) => setCurrentReport(r)}
        onSearchNewNiche={handleSearchNewNiche}
        isSearching={isSearching}
        onExportPDF={handleExportPDF}
        isExportingPDF={isExportingPDF}
        onOpenAccount={() => setViewMode('account')}
        onOpenLanding={() => setViewMode('landing')}
      />

      {/* Main Content Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        
        {/* TAB 00: Cockpit Dashboard */}
        {activeStrategicTab === 'cockpit' && (
          <CockpitDashboard
            report={currentReport}
            onNavigateToModule={setActiveStrategicTab}
            onOpenBilling={() => setViewMode('account')}
          />
        )}

        {/* TAB 01: Radar Web & Détecteur de Niches Explosives */}
        {activeStrategicTab === 'radar' && (
          <RadarTrendsView
            onSelectNicheForFullAnalysis={handleSearchNewNiche}
            onNavigateToMetaAds={(_productTitle) => {
              setActiveStrategicTab('meta_ads');
            }}
            isAnalyzingNiche={isSearching}
          />
        )}

        {/* TAB 01 bis : Galerie publicitaire, swipe file et fiches annonceurs (Lot 2) */}
        {activeStrategicTab === 'ad_gallery' && <AdGalleryView />}

        {/* TAB 1: Veille Concurrentielle & Taux de Marché */}
        {activeStrategicTab === 'veille' && (
          <StrategicAnalysisView
            report={currentReport}
            onNavigateToProducts={() => setActiveStrategicTab('products')}
            onNavigateToMetaAds={() => setActiveStrategicTab('meta_ads')}
          />
        )}

        {/* TAB 2: Conception & Production des Produits Digitaux */}
        {activeStrategicTab === 'products' && (
          <DigitalProductsView
            report={currentReport}
            products={currentReport.digitalProducts}
            onSelectProductForAd={(_prod) => {
              setActiveStrategicTab('meta_ads');
            }}
          />
        )}

        {/* TAB 3: Studio Vidéos Publicitaires Meta Ads (AIDA & PAS) */}
        {activeStrategicTab === 'meta_ads' && (
          <div className="space-y-8">
            {/* Visuels et vidéos générés, conformité avant téléchargement (Lot 4) */}
            <CreativeGeneratorPanel />
            <MetaVideoStudioView
              campaigns={currentReport.adCampaigns}
              provenance={currentReport.dataProvenance?.adCampaigns}
            />
          </div>
        )}

        {/* TAB 05: Kit de Lancement */}
        {activeStrategicTab === 'kit_lancement' && (
          <PlaceholderModuleView
            moduleNumber="05"
            title="Kit de Lancement"
            description="Génération des textes publicitaires, scripts vidéos (15s/30s/60s), et descriptions pour pages de vente basés sur les 12 méthodes de copywriting."
          />
        )}

        {/* TAB 06: Distribution & Intégration */}
        {activeStrategicTab === 'distribution' && (
          <PlaceholderModuleView
            moduleNumber="06"
            title="Distribution Marketplace"
            description="Connecteurs pour l'écosystème de vente : Maketou, Taliopay, Chariow, et les principales infrastructures de paiement africaines."
          />
        )}

        {/* TAB 07: Programme d'Affiliation */}
        {activeStrategicTab === 'affiliation' && (
          <PlaceholderModuleView
            moduleNumber="07"
            title="Programme d'Affiliation"
            description="Tableau de bord pour la gestion des affiliés, création de liens uniques UTM, suivi des clics et calcul automatique des commissions."
          />
        )}

        {/* TAB 08: Storybook Africain */}
        {/* L'ancien placeholder promettait une « garantie de cohérence des personnages » :
            Gamma ne l'offre pas (feuille de route 3.5), l'écran le dit désormais. */}
        {activeStrategicTab === 'storybook' && <StorybookView />}

        {/* TAB 09: Pages Produits */}
        {activeStrategicTab === 'pages_produits' && (
          <PlaceholderModuleView
            moduleNumber="09"
            title="Générateur de Pages Produits"
            description="Assemblage de pages prêtes à publier orientées conversion avec images adaptées à chaque section (Hero, Problème, Bénéfices)."
          />
        )}

        {/* TAB 10: Guides Multilingues */}
        {activeStrategicTab === 'multilingue' && (
          <PlaceholderModuleView
            moduleNumber="10"
            title="Guides Multilingues"
            description="Traduction assistée par IA et intégration du réseau de relecteurs natifs pour les langues africaines locales et l'anglais."
          />
        )}

        {/* TAB 11: Structures de Campagnes */}
        {activeStrategicTab === 'campagnes' && (
          <PlaceholderModuleView
            moduleNumber="11"
            title="Structures de Campagnes"
            description="Déploiement automatisé des campagnes publicitaires Meta et TikTok Ads depuis le tableau de bord avec retour de performance."
          />
        )}

        {/* TAB 12: Rapport PDF Illustré avec Visuels */}
        {activeStrategicTab === 'pdf_report' && (
          <ReportPDFView
            report={currentReport}
          />
        )}

      </main>

      {/* Détail d'un export refusé par la conformité — sans échappatoire. */}
      <ComplianceBlockDialog
        verdict={blockedVerdict}
        open={blockedVerdict !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setBlockedVerdict(null);
        }}
      />

      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-xs px-4 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center space-x-2.5 animate-in fade-in slide-in-from-bottom-4 duration-200">
          {notification.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {notification.type === 'warning' && <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />}
          {notification.type === 'info' && <Info className="w-4 h-4 text-blue-400 shrink-0" />}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}

      {/* Global Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-4 px-6 mt-auto transition-colors duration-300">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Smart Creator · {t('Outil Stratégique de Veille Concurrentielle & Production de Produits Digitaux', 'Strategic Intelligence & Digital Product Creation Tool')}
            </span>
          </div>

          <div className="flex items-center space-x-4">
            <button
              onClick={() => setViewMode('landing')}
              className="hover:text-indigo-600 font-semibold transition-colors"
            >
              {t('Accueil', 'Home')}
            </button>
            <span>·</span>
            <button
              onClick={() => setViewMode('account')}
              className="hover:text-indigo-600 font-semibold transition-colors"
            >
              {t('Mon Compte', 'My Account')}
            </button>
            <span>·</span>
            <span>{t('5 Taux de Marché', '5 Market Rates')}</span>
            <span>·</span>
            <span>{t('PDF Illustré HD', 'HD Illustrated PDF')}</span>
          </div>
        </div>
      </footer>

      {/* Menu Flottant en Bas à Gauche (Top 1% Luxury SaaS Navigation) */}
      <BottomLeftModuleMenu
        activeTab={activeStrategicTab}
        setActiveTab={setActiveStrategicTab}
        currentNicheName={currentReport.nicheName}
      />

    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PreferencesProvider>
        {/* Sous AuthProvider : la porte de crédits lit et débite le solde du profil. */}
        <CreditGateProvider>
          <NexusVeilleWorkspace />
        </CreditGateProvider>
      </PreferencesProvider>
    </AuthProvider>
  );
}
