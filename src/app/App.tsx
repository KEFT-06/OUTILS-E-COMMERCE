import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthContext';
import { LandingPage } from '@/features/landing/LandingPage';
import { RequireAuth } from '@/app/layout/RequireAuth';
import { CreditGateProvider } from '@/app/providers/CreditGateProvider';
import { PreferencesProvider } from '@/app/providers/PreferencesContext';
import { lazyPage } from '@/app/routes/lazyPage';
import {
  AdminConnectionsPage,
  AdminAudiencePage,
  AdminContentPage,
  AdminLayout,
  AdminMessagesPage,
  AdminOverviewPage,
  AdminRevenuePage,
  AdminSecurityPage,
  AdminServicesPage,
  AdminUserDetailPage,
  AdminUsersPage,
} from '@/app/routes/AdminPages';
import { NotFoundPage } from '@/app/routes/NotFoundPage';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { Toaster } from '@/shared/ui/sonner';
import { Spinner } from '@/shared/ui/spinner';
import { TooltipProvider } from '@/shared/ui/tooltip';

/*
 * Seul l'accueil part avec le premier téléchargement. Les autres pages publiques, le cadre de
 * l'espace de travail et chaque module arrivent à l'ouverture de leur adresse : sur une connexion
 * mobile, l'accueil s'affiche sans attendre le code des outils.
 */
const LoginPage = lazyPage(() => import('@/features/auth/LoginPage'), 'LoginPage');
const ForgotPasswordPage = lazyPage(() => import('@/features/auth/ForgotPasswordPage'), 'ForgotPasswordPage');
const PasswordTokenPage = lazyPage(() => import('@/features/auth/PasswordTokenPage'), 'PasswordTokenPage');
const VerifyEmailPage = lazyPage(() => import('@/features/auth/VerifyEmailPage'), 'VerifyEmailPage');
const ContactPage = lazyPage(() => import('@/features/contact/ContactPage'), 'ContactPage');
const LegalPage = lazyPage(() => import('@/features/legal/LegalPage'), 'LegalPage');
/** Page d'impression d'un guide, hors de la mise en page de l'espace de travail. */
const GuidePrintPage = lazyPage(() => import('@/modules/multilingue/GuidePrintView'), 'GuidePrintView');
const AppLayout = lazyPage(() => import('@/app/layout/AppLayout'), 'AppLayout');

const modulePages = () => import('@/app/routes/ModulePages');
const AccountPage = lazyPage(modulePages, 'AccountPage');
const AffiliationPage = lazyPage(modulePages, 'AffiliationPage');
const AnalysePage = lazyPage(modulePages, 'AnalysePage');
const CampagnesPage = lazyPage(modulePages, 'CampagnesPage');
const CockpitPage = lazyPage(modulePages, 'CockpitPage');
const CreatifsPage = lazyPage(modulePages, 'CreatifsPage');
const DistributionPage = lazyPage(modulePages, 'DistributionPage');
const DossierPdfPage = lazyPage(modulePages, 'DossierPdfPage');
const GuidePage = lazyPage(modulePages, 'GuidePage');
const GuideReviewPage = lazyPage(modulePages, 'GuideReviewPage');
const GuideTranslationPage = lazyPage(modulePages, 'GuideTranslationPage');
const KitLancementPage = lazyPage(modulePages, 'KitLancementPage');
const MultilinguePage = lazyPage(modulePages, 'MultilinguePage');
const NichesPage = lazyPage(modulePages, 'NichesPage');
const PagesProduitsPage = lazyPage(modulePages, 'PagesProduitsPage');
const StorybookPage = lazyPage(modulePages, 'StorybookPage');
const StudioPage = lazyPage(modulePages, 'StudioPage');

/**
 * Pendant le téléchargement d'un écran : le fond du thème (pas de flash blanc en sombre) et un
 * indicateur, pour qu'un chargement lent sur mobile ne passe pas pour une page vide.
 */
const loadingScreen = (
  <div className="flex min-h-dvh items-center justify-center bg-background" aria-busy="true">
    <Spinner className="size-6 text-muted-foreground" />
  </div>
);

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
              <ErrorBoundary>
              <Suspense fallback={loadingScreen}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/connexion" element={<LoginPage />} />
                <Route path="/mot-de-passe" element={<PasswordTokenPage />} />
                <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
                <Route path="/verifier-email" element={<VerifyEmailPage />} />
                <Route path="/mentions-legales" element={<LegalPage kind="mentions-legales" />} />
                <Route path="/confidentialite" element={<LegalPage kind="confidentialite" />} />
                <Route path="/conditions" element={<LegalPage kind="conditions" />} />
                <Route path="/contact" element={<ContactPage />} />

                <Route path="/app" element={<RequireAuth />}>
                  <Route element={<AppLayout />}>
                    <Route index element={<Navigate to="cockpit" replace />} />
                    <Route path="cockpit" element={<CockpitPage />} />
                    <Route path="niches" element={<NichesPage />} />
                    <Route path="analyse" element={<AnalysePage />} />
                    <Route path="dossier-pdf" element={<DossierPdfPage />} />
                    <Route path="studio" element={<StudioPage />} />
                    <Route path="creatifs" element={<CreatifsPage />} />
                    <Route path="storybook" element={<StorybookPage />} />
                    <Route path="pages-produits" element={<PagesProduitsPage />} />
                    <Route path="multilingue" element={<MultilinguePage />} />
                    <Route path="multilingue/relectures/:translationId" element={<GuideReviewPage />} />
                    <Route path="multilingue/:guideId" element={<GuidePage />} />
                    <Route path="multilingue/:guideId/:language" element={<GuideTranslationPage />} />
                    <Route path="kit-lancement" element={<KitLancementPage />} />
                    <Route path="campagnes" element={<CampagnesPage />} />
                    <Route path="distribution" element={<DistributionPage />} />
                    <Route path="affiliation" element={<AffiliationPage />} />
                    <Route path="compte" element={<AccountPage />} />
                    <Route path="admin" element={<AdminLayout />}>
                      <Route index element={<AdminOverviewPage />} />
                      <Route path="utilisateurs" element={<AdminUsersPage />} />
                      <Route path="utilisateurs/:userId" element={<AdminUserDetailPage />} />
                      <Route path="connexions" element={<AdminConnectionsPage />} />
                      <Route path="messages" element={<AdminMessagesPage />} />
                      <Route path="audience" element={<AdminAudiencePage />} />
                      <Route path="revenus" element={<AdminRevenuePage />} />
                      <Route path="contenus" element={<AdminContentPage />} />
                      <Route path="services" element={<AdminServicesPage />} />
                      <Route path="securite" element={<AdminSecurityPage />} />
                    </Route>
                    <Route path="*" element={<Navigate to="cockpit" replace />} />
                  </Route>
                </Route>

                <Route path="/imprimer" element={<RequireAuth />}>
                  <Route
                    path="guide/:guideId/:language"
                    element={
                      <Suspense fallback={null}>
                        <GuidePrintPage />
                      </Suspense>
                    }
                  />
                </Route>

                <Route path="*" element={<NotFoundPage />} />
              </Routes>
              </Suspense>
              </ErrorBoundary>
              <Toaster position="bottom-right" mobileOffset={{ bottom: 88 }} closeButton />
            </TooltipProvider>
          </CreditGateProvider>
        </AuthProvider>
      </PreferencesProvider>
    </BrowserRouter>
  );
}
