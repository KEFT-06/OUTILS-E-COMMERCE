import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthContext';
import { LoginPage } from '@/features/auth/LoginPage';
import { LandingPage } from '@/features/landing/LandingPage';
import { AppLayout } from '@/app/layout/AppLayout';
import { RequireAuth } from '@/app/layout/RequireAuth';
import { CreditGateProvider } from '@/app/providers/CreditGateProvider';
import { PreferencesProvider } from '@/app/providers/PreferencesContext';
import {
  AccountPage,
  AffiliationPage,
  AnalysePage,
  CampagnesPage,
  CockpitPage,
  CreatifsPage,
  DistributionPage,
  DossierPdfPage,
  GaleriePage,
  KitLancementPage,
  MultilinguePage,
  PagesProduitsPage,
  RadarPage,
  StorybookPage,
  StudioPage,
} from '@/app/routes/ModulePages';
import { NotFoundPage } from '@/app/routes/NotFoundPage';
import { Toaster } from '@/shared/ui/sonner';
import { TooltipProvider } from '@/shared/ui/tooltip';

/**
 * Chaque écran a sa propre adresse : le bouton Retour du navigateur, le
 * rafraîchissement et le partage d'un lien fonctionnent. En production, le
 * serveur renvoie index.html pour toute adresse hors /api.
 */
export default function App() {
  return (
    <BrowserRouter>
      <PreferencesProvider>
        <AuthProvider>
          <CreditGateProvider>
            <TooltipProvider delayDuration={200}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/connexion" element={<LoginPage />} />

                <Route path="/app" element={<RequireAuth />}>
                  <Route element={<AppLayout />}>
                    <Route index element={<Navigate to="cockpit" replace />} />
                    <Route path="cockpit" element={<CockpitPage />} />
                    <Route path="radar" element={<RadarPage />} />
                    <Route path="galerie" element={<GaleriePage />} />
                    <Route path="analyse" element={<AnalysePage />} />
                    <Route path="dossier-pdf" element={<DossierPdfPage />} />
                    <Route path="studio" element={<StudioPage />} />
                    <Route path="creatifs" element={<CreatifsPage />} />
                    <Route path="storybook" element={<StorybookPage />} />
                    <Route path="pages-produits" element={<PagesProduitsPage />} />
                    <Route path="multilingue" element={<MultilinguePage />} />
                    <Route path="kit-lancement" element={<KitLancementPage />} />
                    <Route path="campagnes" element={<CampagnesPage />} />
                    <Route path="distribution" element={<DistributionPage />} />
                    <Route path="affiliation" element={<AffiliationPage />} />
                    <Route path="compte" element={<AccountPage />} />
                    <Route path="*" element={<Navigate to="cockpit" replace />} />
                  </Route>
                </Route>

                <Route path="*" element={<NotFoundPage />} />
              </Routes>
              <Toaster position="bottom-right" mobileOffset={{ bottom: 88 }} closeButton />
            </TooltipProvider>
          </CreditGateProvider>
        </AuthProvider>
      </PreferencesProvider>
    </BrowserRouter>
  );
}
