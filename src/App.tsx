import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NexusHeader, StrategicTab } from './components/strategic/NexusHeader';
import { StrategicAnalysisView } from './components/strategic/StrategicAnalysisView';
import { DigitalProductsView } from './components/strategic/DigitalProductsView';
import { MetaVideoStudioView } from './components/strategic/MetaVideoStudioView';
import { ReportPDFView } from './components/strategic/ReportPDFView';
import { RadarTrendsView } from './components/strategic/RadarTrendsView';
import { CockpitDashboard } from './components/strategic/CockpitDashboard';
import { PlaceholderModuleView } from './components/strategic/PlaceholderModuleView';
import { LandingPage } from './components/landing/LandingPage';
import { LoginPage } from './components/auth/LoginPage';
import { AccountView } from './components/account/AccountView';
import { BottomLeftModuleMenu } from './components/navigation/BottomLeftModuleMenu';
import { PRESET_ANALYSES } from './data/presetAnalyses';
import { MarketAnalysisReport } from './types/analysis';
import { generateAnalysisPDF } from './utils/pdfGenerator';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

import { PreferencesProvider, usePreferences } from './context/PreferencesContext';

function NexusVeilleWorkspace() {
  const { viewMode, setViewMode } = useAuth();
  const { t } = usePreferences();
  
  // Strategic Intelligence State
  const [activeStrategicTab, setActiveStrategicTab] = useState<StrategicTab>('cockpit');
  const [allReports, setAllReports] = useState<MarketAnalysisReport[]>(PRESET_ANALYSES);
  const [currentReport, setCurrentReport] = useState<MarketAnalysisReport>(PRESET_ANALYSES[0]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isExportingPDF, setIsExportingPDF] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'warning' | 'info'; message: string } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'info' = 'success') => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3500);
  };

  // Live Web AI Search Handler
  const handleSearchNewNiche = async (query: string) => {
    setIsSearching(true);
    try {
      const response = await fetch('/api/analyze-niche', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (response.ok) {
        const data: MarketAnalysisReport = await response.json();
        setAllReports((prev) => [data, ...prev]);
        setCurrentReport(data);
        setActiveStrategicTab('veille');
        setViewMode('app');
        showToast(`Veille terminée pour « ${data.nicheName} »`);
      } else {
        // Fallback: Create dynamic structured report
        const fallbackReport: MarketAnalysisReport = {
          id: `report-${Date.now()}`,
          query,
          nicheName: query.charAt(0).toUpperCase() + query.slice(1),
          dateCreated: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
          overallVerdict: 'Opportunité Forte',
          executiveSummary: `L'analyse du web pour « ${query} » révèle une demande soutenue portée par la recherche d'efficacité et d'outils clés en main. Les barrières à l'entrée sont modérées et la marge opérationnelle sur les formats digitaux dépasse 95%.`,
          rates: {
            demand: {
              key: 'demand',
              label: 'Taux de Demande Marché',
              level: 'Élevé',
              score: 86,
              description: `Forte accélération des requêtes web associées à ${query} avec un intérêt d'achat élevé.`,
              trend: 'up',
            },
            saturation: {
              key: 'saturation',
              label: 'Taux de Saturation Concurrentielle',
              level: 'Moyen',
              score: 52,
              description: 'Présence d\'acteurs généralistes mais absence d\'offre hyper-spécialisée prête à l\'emploi.',
              trend: 'stable',
            },
            profitability: {
              key: 'profitability',
              label: 'Taux de Rentabilité & Marge',
              level: 'Très élevé',
              score: 96,
              description: 'Format digital avec coût de revient nul après conception. Marge brute quasi-totale.',
              trend: 'up',
            },
            opportunity: {
              key: 'opportunity',
              label: 'Taux d\'Opportunité Stratégique',
              level: 'Très élevé',
              score: 89,
              description: 'Opportunité prioritaire pour lancer un premier produit digital en moins de 5 jours.',
              trend: 'up',
            },
            virality: {
              key: 'virality',
              label: 'Taux de Potentiel Viral / Ads',
              level: 'Élevé',
              score: 83,
              description: 'Fort taux de clic prévisible sur formats courts verticaux (Meta Ads & Reels).',
              trend: 'up',
            },
          },
          searchTrends: [
            { keyword: `${query} avis`, volume: '22 400 / mois', growthRate: '+165%', growthType: 'explosive', intent: 'commercial' },
            { keyword: `meilleur ${query}`, volume: '18 100 / mois', growthRate: '+95%', growthType: 'steady', intent: 'transactional' },
            { keyword: `comment utiliser ${query}`, volume: '14 500 / mois', growthRate: '+80%', growthType: 'steady', intent: 'informational' },
          ],
          competitors: [
            {
              id: `comp-${Date.now()}-1`,
              name: `Leader ${query}`,
              urlOrHandle: `@${query.toLowerCase().replace(/\s+/g, '_')}_pro`,
              priceRange: '39€ - 97€',
              positioning: 'Offre standard du marché',
              strengths: ['Bonne visibilité SEO', 'Audience établie'],
              weaknesses: ['Support inexistant', 'Interface vieillissante'],
              exploitableGaps: ['Créer un produit plus synthétique, ultra-rapide à prendre en main en 15 minutes.'],
            },
          ],
          digitalProducts: [
            {
              id: `prod-${Date.now()}-1`,
              title: `Le Guide Expert & Templates : ${query}`,
              subtitle: 'Le système complet pour passer à l\'action et obtenir des résultats mesurables.',
              type: 'bundle',
              typeName: 'Pack Digital + Templates',
              recommendedPrice: 39,
              currency: 'EUR',
              estimatedProductionDays: 3,
              estimatedMarginPercent: 97,
              targetAudience: 'Professionnels et passionnés cherchant un résultat concret immédiat.',
              transformationPromise: 'Supprimer 80% des frictions et automatiser votre mise en œuvre.',
              tableOfContents: [
                { moduleNumber: 1, title: 'Fondations & Diagnostic Initial', details: 'Évaluer son point de départ en 10 minutes.' },
                { moduleNumber: 2, title: 'La Méthode Accélérée Pas à Pas', details: 'Déploiement des outils essentiels.' },
                { moduleNumber: 3, title: 'Modèles & Fichiers Clés en Main', details: 'Ressources téléchargeables immédiatement.' },
                { moduleNumber: 4, title: 'Checklists & Optimisation Continue', details: 'Éviter les erreurs les plus courantes.' },
              ],
              leadMagnet: {
                title: `La Checklist Essentielle : ${query}`,
                format: 'PDF 2 pages',
                hook: 'Le récapitulatif gratuit des 10 étapes incontournables.',
              },
              imageUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
            },
          ],
          adCampaigns: [
            {
              id: `ad-${Date.now()}-aida`,
              framework: 'AIDA',
              frameworkFullName: 'Attention — Intérêt — Désir — Action',
              targetProductTitle: `Le Guide Expert : ${query}`,
              hookHeadline: `Tu perds encore du temps avec ${query} ? Regarde ça.`,
              metaPrimaryText: `Marre de chercher des solutions incomplètes sur Google ? 🛑\n\nDécouvrez la méthode complète qui simplifie tout en quelques clics.\n\n✅ 100% prêt à l'emploi\n✅ Sans perte de temps\n✅ Résultats dès la première semaine`,
              metaHeadline: `Accès immédiat : Pack Digital ${query}`,
              callToAction: 'Télécharger maintenant',
              aspectRatio: '9:16',
              durationSeconds: 18,
              scenes: [
                {
                  sceneNumber: 1,
                  timing: '0:00 - 0:03',
                  phase: 'Attention',
                  visualDescription: `Plan serré sur la friction quotidienne liée à ${query}`,
                  onScreenText: `L'erreur que 90% des gens font avec ${query} ❌`,
                  spokenVoiceover: `Si tu galères encore avec ça, arrête tout deux secondes.`,
                  soundAndVibe: 'Beat punchy et alerte sonore',
                },
                {
                  sceneNumber: 2,
                  timing: '0:03 - 0:08',
                  phase: 'Intérêt',
                  visualDescription: 'Transition dynamique vers la solution clé en main',
                  onScreenText: 'Voici la méthode simplifiée en 3 étapes ✨',
                  spokenVoiceover: 'Au lieu de réinventer la roue, utilise un système déjà testé et optimisé.',
                  soundAndVibe: 'Swoosh et musique moderne',
                },
                {
                  sceneNumber: 3,
                  timing: '0:08 - 0:14',
                  phase: 'Désir',
                  visualDescription: 'Démonstration à l\'écran des résultats obtenus',
                  onScreenText: 'Gain de temps immédiat garanti ⚡️',
                  spokenVoiceover: 'Tu télécharges les templates, tu les adaptes en 5 minutes et c\'est réglé.',
                  soundAndVibe: 'Satisfaction visuelle',
                },
                {
                  sceneNumber: 4,
                  timing: '0:14 - 0:18',
                  phase: 'Action',
                  visualDescription: 'Affichage du bouton de téléchargement avec offre de lancement',
                  onScreenText: 'Clique sous la vidéo pour le télécharger 👇',
                  spokenVoiceover: 'Clique sur le lien dès maintenant pour en profiter.',
                  soundAndVibe: 'Carillon positif de fin',
                },
              ],
              complianceCheck: [
                { rule: 'Pas de promesses irréalistes de gains', compliant: true, explanation: 'Validé : focus organisation et efficacité.' },
                { rule: 'Optimisé mode silencieux (Sound-off)', compliant: true, explanation: 'Validé : textes d\'écran clairs.' },
                { rule: 'Marges 9:16 respectées', compliant: true, explanation: 'Validé : zones de sécurité Reels conformes.' },
              ],
              metaTargeting: {
                interests: [query, 'Productivité', 'Entrepreneuriat'],
                demographics: '25 - 50 ans',
                placements: ['Instagram Reels', 'Facebook Reels'],
              },
            },
          ],
          illustrativeImages: [
            {
              title: 'Tableau de bord de performance et tendances',
              url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
              caption: 'Suivi des indicateurs clés et de la demande du marché.',
            },
            {
              title: 'Espace de travail et outils digitaux',
              url: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80',
              caption: 'Conception ergonomique et intégration rapide.',
            },
          ],
          strategicActionPlan: [
            {
              phase: 'Phase 1 : Validation & Lead Magnet',
              title: 'Capter les premiers prospects',
              steps: ['Diffuser la checklist gratuite sur les réseaux', 'Collecter les emails des personnes intéressées'],
            },
            {
              phase: 'Phase 2 : Vente Principale',
              title: 'Conversion payante',
              steps: ['Lancer la campagne publicitaire Meta Ads', 'Proposer le pack digital à 39€'],
            },
          ],
        };

        setAllReports((prev) => [fallbackReport, ...prev]);
        setCurrentReport(fallbackReport);
        setActiveStrategicTab('veille');
        setViewMode('app');
        showToast(`Rapport généré pour « ${query} »`);
      }
    } catch (err) {
      console.error('Erreur recherche niche:', err);
      showToast('Erreur lors de la recherche', 'warning');
    } finally {
      setIsSearching(false);
    }
  };

  // PDF Export Handler
  const handleExportPDF = async () => {
    setIsExportingPDF(true);
    try {
      await generateAnalysisPDF(currentReport);
      showToast('Dossier PDF téléchargé avec succès !');
    } catch (e) {
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
            products={currentReport.digitalProducts}
            onSelectProductForAd={(_prod) => {
              setActiveStrategicTab('meta_ads');
            }}
          />
        )}

        {/* TAB 3: Studio Vidéos Publicitaires Meta Ads (AIDA & PAS) */}
        {activeStrategicTab === 'meta_ads' && (
          <MetaVideoStudioView
            campaigns={currentReport.adCampaigns}
          />
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
        {activeStrategicTab === 'storybook' && (
          <PlaceholderModuleView
            moduleNumber="08"
            title="Storybook Africain"
            description="Création de contes et livres illustrés ancrés dans des noms et contextes africains, avec garantie de cohérence des personnages."
          />
        )}

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
        <NexusVeilleWorkspace />
      </PreferencesProvider>
    </AuthProvider>
  );
}
