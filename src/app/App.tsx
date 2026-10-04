import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
  AdminPricingPage,
  AdminSecurityPage,
  AdminServicesPage,
  AdminUserDetailPage,
  AdminUsersPage,
} from '@/app/routes/AdminPages';
import { NotFoundPage } from '@/app/routes/NotFoundPage';
import { CookieNotice } from '@/shared/components/CookieNotice';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { FloatingContact } from '@/shared/components/FloatingContact';
import { ScrollAids } from '@/shared/components/ScrollAids';
import { Toaster } from '@/shared/ui/sonner';
import { Spinner } from '@/shared/ui/spinner';

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
const RadarPage = lazyPage(modulePages, 'RadarPage');
const EspionnagePage = lazyPage(modulePages, 'EspionnagePage');
const AlertesPage = lazyPage(modulePages, 'AlertesPage');
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
        {/* Voir AppChrome, plus bas dans ce fichier. */}
        <AuthProvider>
          <CreditGateProvider>
            {/*
              Pas de fournisseur d'infobulles ici : seules les barres de l'espace connecté en
              ont, et SidebarProvider fournit le sien. Celui-ci chargeait tout le moteur de
              positionnement dans le premier fichier de l'accueil, pour aucune infobulle.
            */}
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
                  <Route path="radar" element={<RadarPage />} />
                  <Route path="espionnage" element={<EspionnagePage />} />
                  <Route path="alertes" element={<AlertesPage />} />
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
                    <Route path="tarifs" element={<AdminPricingPage />} />
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
            {/*
              Hors des <Routes> : ces trois-là suivent le visiteur d'une page à l'autre, et
              les remonter à chaque changement d'écran ferait repartir le bandeau cookies
              et perdre la position de défilement mesurée.

              La page d'impression est la seule exclue — voir `ScrollAids` et l'exclusion
              de `/imprimer` ci-dessous : une barre de progression et un bouton flottant
              sortiraient sur le papier.
            */}
            <AppChrome />
            <Toaster position="bottom-right" mobileOffset={{ bottom: 88 }} closeButton />
          </CreditGateProvider>
        </AuthProvider>
      </PreferencesProvider>
    </BrowserRouter>
  );
}

/**
 * Ce qui accompagne le visiteur partout, en dehors du contenu de chaque page.
 *
 * Monté hors des <Routes> pour que rien ne se remonte à chaque changement d'écran : un
 * bandeau cookies qui se recrée reviendrait après avoir été fermé, et la barre de
 * progression repartirait de zéro avant même que la page ait défilé.
 *
 * La page d'impression est la seule où rien ne s'affiche : une barre de progression et un
 * bouton flottant sortiraient sur le papier, où ils ne veulent rien dire.
 */
function AppChrome() {
  const { pathname } = useLocation();
  if (/^\/imprimer(\/|$)/.test(pathname)) return null;

  return (
    <>
      <ScrollAids />
      <FloatingContact />
      <CookieNotice />
    </>
  );
}
