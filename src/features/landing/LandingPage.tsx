import React from 'react';
import {
  Eye,
  Sparkles,
  Send,
  ArrowRight,
  ShieldCheck,
  Radar,
  Telescope,
  Package,
  Clapperboard,
  Rocket,
  Store,
  Users,
  BookOpen,
  LayoutTemplate,
  Languages,
  Megaphone,
  Sun,
  Moon,
  Check,
} from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { usePreferences } from '@/app/providers/PreferencesContext';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import { Button } from '@/shared/ui/button';

/**
 * Page d'accueil publique.
 *
 * Règle appliquée : aucun chiffre inventé. Les deux statistiques affichées sont
 * sourcées et leur provenance est visible à l'écran (cf. docs/DESIGN-SYSTEM.md).
 * Pas de faux témoignages, pas de compteur d'utilisateurs fictif.
 */
export const LandingPage: React.FC = () => {
  const { setViewMode, isAuthenticated } = useAuth();
  const { t, theme, toggleTheme, language, toggleLanguage } = usePreferences();

  const pillars = [
    {
      icon: Eye,
      tone: 'text-rate-good',
      title: t('VOIR', 'SEE'),
      body: t(
        'Une intelligence de marché dont la méthode est consultable. Chaque taux s’ouvre sur le détail de son calcul : critères, poids, valeurs brutes, date de mesure.',
        'Market intelligence whose method is open to inspection. Every rate opens onto its calculation detail: criteria, weights, raw values, measurement date.',
      ),
    },
    {
      icon: Sparkles,
      tone: 'text-rate-medium',
      title: t('CRÉER', 'CREATE'),
      body: t(
        'Ebooks, guides, storybooks illustrés, visuels et vidéos publicitaires. Avec vérificateur anti-plagiat et cohérence de personnage garantie page après page.',
        'Ebooks, guides, illustrated storybooks, visuals and video ads. With plagiarism checking and character consistency guaranteed page after page.',
      ),
    },
    {
      icon: Send,
      tone: 'text-rate-excellent',
      title: t('VENDRE', 'SELL'),
      body: t(
        'Créatifs pré-vérifiés conformes Meta et TikTok, publication directe sur la marketplace choisie, lancement de campagne sans ressaisie.',
        'Pre-checked creatives compliant with Meta and TikTok, direct publishing to your chosen marketplace, campaign launch without re-entry.',
      ),
    },
  ];

  const modules = [
    { icon: Radar, fr: 'Radar Marché', en: 'Market Radar' },
    { icon: Telescope, fr: 'Analyse Stratégique IA', en: 'AI Strategic Analysis' },
    { icon: Package, fr: 'Studio de Création', en: 'Creation Studio' },
    { icon: Clapperboard, fr: 'Créatifs Publicitaires', en: 'Ad Creatives' },
    { icon: Rocket, fr: 'Kit de Lancement', en: 'Launch Kit' },
    { icon: Store, fr: 'Distribution Marketplace', en: 'Marketplace Distribution' },
    { icon: Users, fr: 'Programme d’Affiliation', en: 'Affiliate Program' },
    { icon: BookOpen, fr: 'Storybook Africain', en: 'African Storybook' },
    { icon: LayoutTemplate, fr: 'Pages Produits', en: 'Product Pages' },
    { icon: Languages, fr: 'Guides Multilingues', en: 'Multilingual Guides' },
    { icon: Megaphone, fr: 'Structures de Campagnes', en: 'Campaign Structures' },
  ];

  const proofs = [
    {
      title: t('Le scoring est ouvert', 'Scoring is open'),
      body: t(
        'Quatre critères pondérés, publiés : annonceurs uniques (30 %), publicités actives (25 %), durée de vie moyenne (25 %), publicités établies (20 %). Chaque score est archivé avec sa version de méthodologie.',
        'Four published weighted criteria: unique advertisers (30%), active ads (25%), average lifetime (25%), established ads (20%). Every score is archived with its methodology version.',
      ),
    },
    {
      title: t('La conformité a un droit de veto', 'Compliance holds a veto'),
      body: t(
        'Promesses de gains chiffrées, séquences avant/après, témoignages financiers non étayés : détectés avant export, avec reformulation proposée. Rien ne se télécharge sans passer par là.',
        'Earnings claims, before/after sequences, unsubstantiated financial testimonials: caught before export, with a rewrite proposed. Nothing downloads without passing through.',
      ),
    },
    {
      title: t('Le coût est annoncé avant', 'Cost is shown upfront'),
      body: t(
        'Chaque génération affiche son coût en points et en monnaie locale, votre solde actuel et votre solde projeté — avant que vous ne validiez.',
        'Every generation shows its cost in points and local currency, your current balance and projected balance — before you confirm.',
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-[var(--surface-sunken)] text-[var(--text-primary)]">
      {/* En-tête */}
      <header className="glass-1 sticky top-0 z-40 rounded-none border-x-0 border-t-0">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <BrandLogo size="md" />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleLanguage}
              className="hidden rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-xs font-bold text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] sm:block"
              aria-label={language === 'FR' ? 'Switch to English' : 'Passer en français'}
            >
              {language}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={t('Changer de thème', 'Toggle theme')}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Button size="sm" onClick={() => setViewMode(isAuthenticated ? 'app' : 'login')}>
              {isAuthenticated ? t('Ouvrir l’outil', 'Open the tool') : t('Connexion', 'Sign in')}
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Héros */}
        <section className="relative overflow-hidden px-4 py-20 sm:px-6 sm:py-28">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[48rem] -translate-x-1/2 rounded-full bg-indigo-500/12 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl"
          />

          <div className="relative mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3.5 py-1.5 text-xs font-bold">
              <span className="h-1.5 w-1.5 rounded-full bg-rate-excellent" />
              {t(
                'Intelligence concurrentielle pour l’Afrique francophone et anglophone',
                'Competitive intelligence for francophone and anglophone Africa',
              )}
            </span>

            <h1 className="mt-6 font-display text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
              {t('Sachez quoi vendre', 'Know what to sell')}
              <br />
              <span className="text-[var(--text-muted)]">
                {t('avant de le produire.', 'before you produce it.')}
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[var(--text-muted)]">
              {t(
                'Smart Creator relie la lecture du marché, la production par IA et la mise en vente en un seul parcours. Avec une règle : aucun chiffre affiché sans sa source.',
                'Smart Creator links market reading, AI production and going to market in a single flow. With one rule: no figure shown without its source.',
              )}
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" variant="glow" onClick={() => setViewMode('login')} className="gap-2">
                {t('Commencer l’analyse', 'Start analysing')}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => setViewMode('app')}>
                {t('Explorer une démonstration', 'Explore a demo')}
              </Button>
            </div>

            <p className="mt-4 text-xs text-[var(--text-muted)]">
              {t(
                'La démonstration utilise des rapports d’exemple, clairement étiquetés comme tels.',
                'The demo uses sample reports, clearly labelled as such.',
              )}
            </p>
          </div>
        </section>

        {/* VOIR · CRÉER · VENDRE */}
        <section className="px-4 pb-20 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-5 md:grid-cols-3">
            {pillars.map(({ icon: Icon, tone, title, body }) => (
              <article
                key={title}
                className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-7"
              >
                <Icon className={`h-6 w-6 ${tone}`} />
                <h2 className="mt-4 font-display text-2xl font-black tracking-tight">{title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Constat de marché — chiffres sourcés */}
        <section className="border-y border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-16 sm:px-6">
          <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
            <figure className="m-0">
              <p className="font-display text-5xl font-black tracking-tighter text-rate-good">18</p>
              <p className="mt-2 text-sm font-semibold">
                {t(
                  'annonceurs uniques détectés sur le montage vidéo en Côte d’Ivoire',
                  'unique advertisers detected in video editing in Côte d’Ivoire',
                )}
              </p>
              <figcaption className="mt-2 text-xs text-[var(--text-muted)]">
                {t(
                  'Pour une demande de contenu massive. La plupart des vendeurs se lancent encore à l’intuition.',
                  'Against massive content demand. Most sellers still launch on intuition.',
                )}
                <br />
                <span className="font-mono">
                  {t('Source : analyse terrain Smart Creator', 'Source: Smart Creator field analysis')}
                </span>
              </figcaption>
            </figure>

            <figure className="m-0">
              <p className="font-display text-5xl font-black tracking-tighter text-rate-medium">25,7 %</p>
              <p className="mt-2 text-sm font-semibold">
                {t(
                  'des comptes Mobile Money enregistrés sont actifs chaque mois',
                  'of registered Mobile Money accounts are active monthly',
                )}
              </p>
              <figcaption className="mt-2 text-xs text-[var(--text-muted)]">
                {t(
                  'L’écart entre comptes déclarés et acheteurs réels change le dimensionnement de vos campagnes.',
                  'The gap between declared accounts and real buyers changes how you size your campaigns.',
                )}
                <br />
                <span className="font-mono">
                  {t(
                    'Source : GSMA, State of the Industry Report on Mobile Money 2026',
                    'Source: GSMA, State of the Industry Report on Mobile Money 2026',
                  )}
                </span>
              </figcaption>
            </figure>
          </div>
        </section>

        {/* Preuves */}
        <section className="px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="font-display text-3xl font-black tracking-tight sm:text-4xl">
              {t('Ce qui nous engage', 'What we commit to')}
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-[var(--text-muted)]">
              {t(
                'Un outil d’analyse ne vaut que par ce qu’il accepte de montrer de sa propre méthode.',
                'An analysis tool is worth only what it agrees to reveal about its own method.',
              )}
            </p>

            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {proofs.map((proof) => (
                <article
                  key={proof.title}
                  className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-6"
                >
                  <ShieldCheck className="h-5 w-5 text-rate-excellent" />
                  <h3 className="mt-4 text-base font-bold">{proof.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{proof.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Modules */}
        <section className="border-t border-[var(--border-subtle)] px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="font-display text-3xl font-black tracking-tight sm:text-4xl">
              {t('Onze modules, un seul parcours', 'Eleven modules, one flow')}
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-[var(--text-muted)]">
              {t(
                'Du radar de marché au lancement de campagne, la sortie de chaque module alimente le suivant sans ressaisie.',
                'From market radar to campaign launch, each module’s output feeds the next without re-entry.',
              )}
            </p>

            <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map(({ icon: Icon, fr, en }, index) => (
                <li
                  key={fr}
                  className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-3.5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-500/10">
                    <Icon className="h-4 w-4 text-[var(--text-muted)]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-[10px] font-bold text-[var(--text-muted)]">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="block truncate text-sm font-bold">{language === 'EN' ? en : fr}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Appel à l'action */}
        <section className="px-4 pb-24 sm:px-6">
          <div className="glass-1 mx-auto max-w-4xl rounded-[2rem] p-10 text-center sm:p-14">
            <h2 className="font-display text-3xl font-black tracking-tight sm:text-4xl">
              {t('Arrêtez de deviner votre marché.', 'Stop guessing your market.')}
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-[var(--text-muted)]">
              {t(
                'Analysez une niche, produisez le produit qui y répond, et lancez la campagne — sans changer d’outil.',
                'Analyse a niche, produce the product that answers it, and launch the campaign — without switching tools.',
              )}
            </p>
            <Button size="lg" variant="glow" onClick={() => setViewMode('login')} className="mt-8 gap-2">
              {t('Créer mon compte', 'Create my account')}
              <ArrowRight className="h-4 w-4" />
            </Button>

            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-[var(--text-muted)]">
              {[
                t('Méthodologie de scoring consultable', 'Inspectable scoring methodology'),
                t('Conformité vérifiée avant export', 'Compliance checked before export'),
                t('Coût affiché avant génération', 'Cost shown before generation'),
              ].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-rate-excellent" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border-subtle)] px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <BrandLogo size="sm" />
          <p className="max-w-md text-center text-[11px] leading-relaxed text-[var(--text-muted)] sm:text-right">
            {t(
              'Smart Creator fournit des analyses basées sur des données publiques. Aucun résultat financier n’est garanti.',
              'Smart Creator provides analyses based on public data. No financial result is guaranteed.',
            )}
          </p>
        </div>
      </footer>
    </div>
  );
};
