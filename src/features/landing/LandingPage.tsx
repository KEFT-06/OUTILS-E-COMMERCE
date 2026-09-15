import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTrackVisit } from '@/shared/lib/audience';
import { ArrowRight, ExternalLink, Moon, Scale, ShieldCheck, Sun, Wallet } from 'lucide-react';
import { MODULES, MODULE_GROUPS, type ModuleGroup } from '@/app/navigation';
import { usePreferences } from '@/app/providers/PreferencesContext';
import { useAuth } from '@/features/auth/AuthContext';
import { COUNTRIES, countryName } from '@server/shared/countries';
import { CountryCombobox } from '@/shared/components/CountryCombobox';
import { CountryFlag } from '@/shared/components/CountryFlag';
import { PlanCards } from '@/shared/components/PlanCards';
import { guessCountryCode } from '@/shared/lib/geo';
import { usePlans } from '@/shared/lib/plans';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/shared/ui/accordion';
import { Badge } from '@/shared/ui/badge';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/shared/ui/card';
import { Marquee } from '@/shared/ui/magicui/marquee';

// Effet décoratif : chargé après la page, il ne retarde pas le premier affichage.
const BorderBeam = lazy(() => import('@/shared/ui/magicui/border-beam').then((module) => ({ default: module.BorderBeam })));

/**
 * Page d'accueil publique.
 *
 * Règle appliquée : chaque promesse correspond à ce que l'outil fait aujourd'hui.
 * L'ancienne version annonçait une « cohérence de personnage garantie », une
 * « publication directe sur la marketplace » et un lancement « sans ressaisie » ;
 * l'outil lui-même disait le contraire.
 */

const GROUP_PITCH: Record<ModuleGroup, string> = {
  voir: 'Lire la demande, la concurrence et les publicités déjà diffusées.',
  creer: 'Structurer le produit, ses visuels, ses scripts et sa page de vente.',
  vendre: 'Préparer la campagne, suivre les ventes et animer vos affiliés.',
};

const COMMITMENTS = [
  {
    icon: Scale,
    title: 'Le scoring est ouvert',
    body: 'Le taux de saturation repose sur quatre critères publiés : annonceurs uniques (30 %), publicités actives (25 %), durée de vie moyenne (25 %), publicités établies (20 %). Chaque score est archivé avec sa version de méthodologie.',
  },
  {
    icon: ShieldCheck,
    title: 'La conformité a un droit de veto',
    body: 'Promesses de gains chiffrées, avant/après trompeurs, témoignages non étayés : repérés avant chaque export, avec une reformulation proposée. Rien ne se télécharge sans ce contrôle.',
  },
  {
    icon: Wallet,
    title: 'Le coût est annoncé avant',
    body: 'Chaque action affiche son coût en points, son équivalent en monnaie locale et votre solde après l’opération, avant que vous ne validiez.',
  },
];

const FAQ = [
  {
    question: 'Smart Creator publie-t-il mes produits sur les marketplaces ?',
    answer:
      'Non. L’API de Chariow permet de lire votre catalogue et vos ventes, pas de créer un produit. Vous publiez sur la marketplace à partir de l’export du studio, puis Smart Creator suit vos ventes.',
  },
  {
    question: 'Les analyses de marché sont-elles en temps réel ?',
    answer:
      'Pas encore. Le scan en direct attend la connexion de la bibliothèque publicitaire Meta et d’un fournisseur d’IA. Aucun rapport d’exemple n’est fabriqué en attendant : chaque analyse porte sur la niche que vous choisissez.',
  },
  {
    question: 'Mes publicités seront-elles acceptées par Meta ou TikTok ?',
    answer:
      'Personne ne peut le garantir. Le vérificateur signale les formulations à risque avant l’export ; la décision finale revient toujours à la plateforme.',
  },
  {
    question: 'Où sont stockées mes données ?',
    answer:
      'Votre compte, votre solde de points et vos paiements sont enregistrés sur nos serveurs, dans une base protégée : mot de passe haché, jamais stocké en clair, et clés API chiffrées. Vos rapports et vos brouillons de travail sont enregistrés sur votre compte, et vous pouvez en télécharger une copie ou tout supprimer depuis Mon compte. La politique de confidentialité détaille ce qui est transmis aux services tiers.',
    link: { to: '/confidentialite', label: 'Politique de confidentialité' },
  },
  {
    question: 'Combien coûte Smart Creator ?',
    answer:
      'Le palier Gratuit permet de commencer sans carte bancaire. Les forfaits Plus, Pro, Max et Elite Enterprise sont détaillés dans la section Paliers, avec leur prix dans la devise de votre pays. Chaque action affiche son coût en points avant validation.',
  },
  {
    question: 'Smart Creator est-il disponible dans mon pays ?',
    answer:
      'Oui : l’outil est international. Choisissez votre pays à l’inscription et les prix s’affichent dans votre devise : franc CFA, naira, euro, dollar…',
  },
];

/** Quelques pays montrés en bandeau : l'outil couvre tous les pays du monde. */
const SHOWCASE_COUNTRIES = ['CM', 'CI', 'SN', 'CD', 'NG', 'GH', 'KE', 'MA', 'BJ', 'GA', 'FR', 'BE', 'CA', 'US', 'GB', 'BR', 'IN', 'AE', 'ZA', 'HT'];

/** Préférence système « réduire les animations », sans charger la bibliothèque motion. */
function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: ReactNode }) {
  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-sm font-semibold tracking-wider text-brand-green-text uppercase">{eyebrow}</p>
      <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
      {description && <p className="text-lg leading-relaxed text-muted-foreground">{description}</p>}
    </div>
  );
}

export function LandingPage() {
  useTrackVisit('/');
  const { isAuthenticated, account } = useAuth();
  const [priceCountry, setPriceCountry] = useState(() => account?.country ?? guessCountryCode() ?? 'US');
  const { theme, toggleTheme } = usePreferences();
  const navigate = useNavigate();
  const reduceMotion = usePrefersReducedMotion();
  const { catalog } = usePlans(priceCountry);

  useEffect(() => {
    document.title = 'Smart Creator — Veille stratégique & production e-commerce';
  }, []);

  const openWorkspace = () => {
    navigate(isAuthenticated ? '/app/cockpit' : '/connexion?mode=inscription');
  };

  const primaryLabel = isAuthenticated ? 'Ouvrir mon espace' : 'Créer mon compte gratuit';

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="rounded-md" aria-label="Accueil Smart Creator">
            <BrandLogo size="md" className="lg:hidden" />
            <BrandLogo size="md" showTagline className="hidden lg:inline-flex" />
          </Link>

          <nav aria-label="Sections" className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#parcours" className="hover:text-foreground">
              Le parcours
            </a>
            <a href="#engagements" className="hover:text-foreground">
              Engagements
            </a>
            <a href="#paliers" className="hover:text-foreground">
              Paliers
            </a>
            <a href="#questions" className="hover:text-foreground">
              Questions
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
            {!isAuthenticated && (
              <Button variant="ghost" asChild className="hidden sm:inline-flex">
                <Link to="/connexion">Connexion</Link>
              </Button>
            )}
            <Button onClick={openWorkspace}>{isAuthenticated ? 'Mon espace' : 'Commencer'}</Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-40 -left-32 size-[36rem] rounded-full bg-brand-green/10 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-40 bottom-0 size-[28rem] rounded-full bg-brand-orange/10 blur-3xl"
          />

          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:py-24">
            <div className="space-y-6">
              <Badge variant="brand" className="px-3 py-1 text-sm whitespace-normal">
                Pour les créateurs de produits digitaux, partout dans le monde
              </Badge>
              <h1 className="font-display text-4xl leading-[1.05] font-black tracking-tight sm:text-5xl lg:text-6xl">
                Sachez quoi vendre <span className="text-brand-green-text">avant de le produire.</span>
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
                Smart Creator relie la lecture du marché, la création de vos produits digitaux et leur mise en vente. Avec
                une règle : aucun chiffre affiché sans sa source.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" onClick={openWorkspace}>
                  {primaryLabel}
                  <ArrowRight />
                </Button>
                {!isAuthenticated && (
                  <Button size="lg" variant="outline" asChild>
                    <Link to="/connexion">Se connecter</Link>
                  </Button>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Gratuit pour commencer, sans carte bancaire. Prix affichés dans la devise de votre pays.
              </p>
            </div>

            <figure className="min-w-0">
              <div className="relative overflow-hidden rounded-xl border bg-card shadow-2xl">
                <div className="flex items-center gap-1.5 border-b bg-muted/60 px-3 py-2" aria-hidden="true">
                  <span className="size-2.5 rounded-full bg-muted-foreground/30" />
                  <span className="size-2.5 rounded-full bg-muted-foreground/30" />
                  <span className="size-2.5 rounded-full bg-muted-foreground/30" />
                  <span className="ml-3 truncate text-xs text-muted-foreground">Smart Creator · Niches</span>
                </div>
                <img
                  src="/captures/niches-clair.jpg"
                  alt="Écran Niches de Smart Creator : niches enregistrées et catalogue des niches par secteur"
                  width={1440}
                  height={900}
                  className="block w-full dark:hidden"
                />
                <img
                  src="/captures/niches-sombre.jpg"
                  alt="Écran Niches de Smart Creator en thème sombre"
                  width={1440}
                  height={900}
                  className="hidden w-full dark:block"
                />
                {!reduceMotion && (
                  <Suspense fallback={null}>
                    <BorderBeam size={140} duration={12} colorFrom="#00c853" colorTo="#f59e0b" borderWidth={2} />
                  </Suspense>
                )}
              </div>
              <figcaption className="mt-3 text-center text-sm text-muted-foreground">
                Capture réelle de l’outil : le catalogue des niches, tous secteurs.
              </figcaption>
            </figure>
          </div>
        </section>

        <section aria-labelledby="marches-titre" className="border-b py-10">
          <p id="marches-titre" className="px-4 text-center text-sm font-medium text-muted-foreground">
            Disponible dans {COUNTRIES.length} pays, avec les prix dans la devise locale
          </p>
          <div className="relative mt-5" aria-hidden="true">
            {reduceMotion ? (
              <div className="mx-auto flex max-w-5xl flex-wrap justify-center gap-2 px-4">
                {SHOWCASE_COUNTRIES.map((code) => (
                  <span key={code} className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-sm font-medium">
                    <CountryFlag code={code} />
                    {countryName(code)}
                  </span>
                ))}
              </div>
            ) : (
              <>
                <Marquee pauseOnHover className="[--duration:50s]">
                  {SHOWCASE_COUNTRIES.map((code) => (
                    <span key={code} className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-sm font-medium whitespace-nowrap">
                      <CountryFlag code={code} />
                      {countryName(code)}
                    </span>
                  ))}
                </Marquee>
                <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background sm:w-32" />
                <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background sm:w-32" />
              </>
            )}
          </div>
        </section>

        <section id="parcours" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <SectionHeading
            eyebrow="Le parcours"
            title="Voir, créer, vendre : un seul outil"
            description="La niche analysée alimente le studio ; le produit du studio alimente les créatifs, le kit de lancement et la page de vente."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {MODULE_GROUPS.map((group) => (
              <Card key={group.id} className="gap-5">
                <CardHeader>
                  <p className="font-display text-3xl font-black tracking-tight uppercase">{group.label.fr}</p>
                  <CardDescription className="text-base">{GROUP_PITCH[group.id]}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-4">
                    {MODULES.filter((entry) => entry.group === group.id).map((entry) => {
                      const Icon = entry.icon;
                      return (
                        <li key={entry.id} className="flex items-start gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                            <Icon className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2 font-semibold">
                              {entry.label.fr}
                              {!entry.ready && <Badge variant="outline">bientôt</Badge>}
                            </span>
                            <span className="block text-sm text-muted-foreground">{entry.description.fr}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section id="engagements" className="scroll-mt-20 border-y bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading
              eyebrow="Engagements"
              title="Ce que l’outil accepte de montrer"
              description="Un outil d’analyse ne vaut que par ce qu’il révèle de sa propre méthode."
            />
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {COMMITMENTS.map((commitment) => {
                const Icon = commitment.icon;
                return (
                  <Card key={commitment.title}>
                    <CardHeader>
                      <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                        <Icon className="size-5" aria-hidden="true" />
                      </span>
                      <h3 className="mt-2 text-lg font-semibold">{commitment.title}</h3>
                    </CardHeader>
                    <CardContent>
                      <p className="leading-relaxed text-muted-foreground">{commitment.body}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <figure className="mt-12 grid gap-6 rounded-xl border bg-card p-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
              <p className="font-display text-6xl font-black tracking-tighter text-brand-orange-text tabular-nums">25,7 %</p>
              <figcaption className="space-y-2">
                <p className="text-lg font-semibold">
                  des comptes de mobile money enregistrés dans le monde étaient actifs sur 30 jours en 2025.
                </p>
                <p className="text-muted-foreground">
                  L’écart entre comptes ouverts et acheteurs réels change la façon de dimensionner vos campagnes.
                </p>
                <a
                  href="https://www.gsma.com/sotir/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand-green-text underline-offset-4 hover:underline"
                >
                  Source : GSMA, State of the Industry Report on Mobile Money 2026
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </figcaption>
            </figure>
          </div>
        </section>

        <section id="paliers" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <SectionHeading
            eyebrow="Paliers"
            title="Un forfait pour chaque étape"
            description="Chaque carte détaille ce que comprend le forfait : points de recherche, niches enregistrées, méthodes publicitaires et fonctions. Prix dans la devise de votre pays."
          />
          <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="landing-price-country" className="text-sm font-medium">
              Prix affichés pour
            </label>
            <CountryCombobox id="landing-price-country" value={priceCountry} onChange={setPriceCountry} showCurrency className="sm:w-72" />
          </div>
          <PlanCards
            className="mt-6"
            catalog={catalog}
            renderAction={(plan) => (
              <Button className="w-full" variant={plan.highlight ? 'default' : 'outline'} onClick={openWorkspace}>
                {plan.price?.monthly === 0 ? 'Commencer gratuitement' : `Choisir ${plan.label}`}
              </Button>
            )}
          />
        </section>

        <section id="questions" className="scroll-mt-20 border-t bg-muted/30">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <SectionHeading eyebrow="Questions" title="Ce qu’il faut savoir avant de commencer" />
            <Accordion type="single" collapsible className="rounded-xl border bg-card px-5">
              {FAQ.map((item) => (
                <AccordionItem key={item.question} value={item.question}>
                  <AccordionTrigger className="text-base">{item.question}</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-base leading-relaxed text-muted-foreground">
                    <p>{item.answer}</p>
                    {item.link && (
                      <Link to={item.link.to} className="font-medium text-brand-green-text underline-offset-4 hover:underline">
                        {item.link.label}
                      </Link>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="flex flex-col items-start gap-6 rounded-2xl bg-foreground p-8 text-background sm:p-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Arrêtez de deviner votre marché.</h2>
              <p className="max-w-xl text-lg opacity-80">
                Analysez une niche, construisez le produit qui y répond et préparez son lancement, sans changer d’outil.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" onClick={openWorkspace}>
                {primaryLabel}
                <ArrowRight />
              </Button>
              {!isAuthenticated && (
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="border-background/30 bg-transparent text-background hover:bg-background/10 hover:text-background dark:border-background/30 dark:bg-transparent"
                >
                  <Link to="/connexion">Se connecter</Link>
                </Button>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <BrandLogo size="sm" showTagline />
            <p className="max-w-md text-sm text-muted-foreground">
              Smart Creator fournit des analyses fondées sur des données publiques. Aucun résultat financier n’est garanti.
            </p>
          </div>
          <nav aria-label="Informations légales" className="flex flex-col gap-2 text-sm text-muted-foreground">
            <Link to="/mentions-legales" className="hover:text-foreground">
              Mentions légales
            </Link>
            <Link to="/confidentialite" className="hover:text-foreground">
              Confidentialité
            </Link>
            <Link to="/conditions" className="hover:text-foreground">
              Conditions d’utilisation
            </Link>
            <Link to="/contact" className="hover:text-foreground">
              Contact
            </Link>
          </nav>
        </div>
        <p className="border-t px-4 py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Smart Creator — Veille stratégique &amp; production e-commerce
        </p>
      </footer>
    </div>
  );
}
