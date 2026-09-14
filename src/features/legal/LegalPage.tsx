import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import { Button } from '@/shared/ui/button';

/**
 * Pages légales.
 *
 * Les informations que seul l'éditeur peut fournir (identité, adresse,
 * hébergeur, contact) sont signalées « à compléter » plutôt qu'inventées. Le
 * reste décrit le service tel qu'il fonctionne réellement aujourd'hui.
 */

export type LegalKind = 'mentions-legales' | 'confidentialite' | 'conditions';

const TITLES: Record<LegalKind, string> = {
  'mentions-legales': 'Mentions légales',
  confidentialite: 'Politique de confidentialité',
  conditions: 'Conditions d’utilisation',
};

function ToComplete({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-warning-soft px-1.5 py-0.5 text-warning ring-1 ring-warning-border">
      À compléter : {children}
    </mark>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl font-extrabold tracking-tight">{title}</h2>
      <div className="space-y-3 leading-relaxed text-foreground/85">{children}</div>
    </section>
  );
}

function MentionsLegales() {
  return (
    <>
      <Section title="Éditeur du site">
        <p>
          <ToComplete>raison sociale ou nom de l’éditeur, forme juridique, adresse du siège, numéro d’immatriculation</ToComplete>
        </p>
        <p>
          Directeur de la publication : <ToComplete>nom</ToComplete>
        </p>
        <p>
          Contact : <ToComplete>adresse e-mail</ToComplete>
        </p>
      </Section>
      <Section title="Hébergement">
        <p>
          <ToComplete>nom, adresse et contact de l’hébergeur</ToComplete>
        </p>
      </Section>
      <Section title="Propriété intellectuelle">
        <p>
          La marque Smart Creator, son logo, ses textes et son interface sont protégés. Toute reproduction sans
          l’autorisation de l’éditeur est interdite. Les contenus que vous créez avec l’outil vous appartiennent.
        </p>
      </Section>
      <Section title="Nature des analyses">
        <p>
          Smart Creator fournit des analyses fondées sur des données publiques et des estimations. Elles aident à décider
          mais ne garantissent aucun résultat commercial ou financier.
        </p>
      </Section>
    </>
  );
}

function Confidentialite() {
  return (
    <>
      <Section title="Où sont conservées vos données">
        <p>
          Dans la version actuelle, il n’existe pas encore de compte sur nos serveurs. Votre profil (nom, adresse e-mail,
          palier, points de recherche, niches enregistrées) et vos brouillons (produits, swipe file, kits de lancement,
          pages produits) sont enregistrés dans votre navigateur.
        </p>
        <p>
          Se déconnecter supprime le profil de ce navigateur. Effacer les données du site dans les réglages du navigateur
          supprime aussi les brouillons.
        </p>
      </Section>
      <Section title="Données transmises à des services tiers">
        <p>
          Quand vous utilisez une fonction, et seulement si le service correspondant est configuré sur le serveur, les
          informations nécessaires lui sont transmises :
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Meta (bibliothèque publicitaire) : la niche et le marché d’une collecte de publicités ;</li>
          <li>Google Gemini : la requête d’une analyse de niche ;</li>
          <li>Gamma : le brief d’un storybook ;</li>
          <li>Higgsfield : le brief d’un visuel ou d’une vidéo ;</li>
          <li>
            Chariow : la consultation de votre catalogue, de vos ventes et de vos affiliés, et les adresses e-mail que vous
            saisissez pour inviter des affiliés — Chariow leur envoie alors un e-mail ;
          </li>
          <li>Google Fonts : les polices du site sont chargées depuis les serveurs de Google, qui reçoivent votre adresse IP.</li>
        </ul>
      </Section>
      <Section title="Cookies">
        <p>
          Un cookie fonctionnel mémorise l’état ouvert ou replié de la barre latérale. Smart Creator ne dépose aucun cookie
          publicitaire ni de mesure d’audience.
        </p>
      </Section>
      <Section title="Vos droits">
        <p>
          Vous pouvez demander l’accès, la rectification ou la suppression des données vous concernant :{' '}
          <ToComplete>adresse de contact pour exercer ces droits</ToComplete>
        </p>
      </Section>
    </>
  );
}

function Conditions() {
  return (
    <>
      <Section title="Un service en cours de développement">
        <p>
          Plusieurs fonctions dépendent de services tiers qui ne sont pas encore tous branchés ; l’écran l’indique chaque
          fois. Les comptes sont pour l’instant locaux : aucun mot de passe n’est demandé ni vérifié.
        </p>
      </Section>
      <Section title="Analyses et résultats">
        <p>
          Les taux, volumes et recommandations reposent sur des données publiques et des estimations dont la provenance est
          affichée. Ils ne constituent ni un conseil financier ni une garantie de ventes.
        </p>
      </Section>
      <Section title="Conformité publicitaire">
        <p>
          Le vérificateur de conformité signale les formulations à risque avant chaque export. Il ne remplace ni la
          modération des plateformes publicitaires, qui garde la décision finale, ni un avis juridique. Vous restez
          responsable des contenus que vous publiez.
        </p>
      </Section>
      <Section title="Contenus générés">
        <p>
          Relisez tout contenu généré avant de le diffuser. Les contes du storybook ne passent pas par le vérificateur de
          conformité, et la cohérence d’un personnage d’une page à l’autre n’est pas garantie.
        </p>
      </Section>
      <Section title="Points de recherche et paliers">
        <p>
          Le coût de chaque action s’affiche avant validation. Les quotas et la valeur des points sont provisoires, et le
          paiement en ligne n’est pas encore ouvert.
        </p>
      </Section>
      <Section title="Invitations d’affiliés">
        <p>
          Une invitation déclenche l’envoi immédiat d’un e-mail par Chariow. N’invitez que des personnes qui ont accepté
          d’être contactées.
        </p>
      </Section>
      <Section title="Contact">
        <p>
          <ToComplete>adresse e-mail de contact</ToComplete>
        </p>
      </Section>
    </>
  );
}

const CONTENT: Record<LegalKind, () => ReactNode> = {
  'mentions-legales': MentionsLegales,
  confidentialite: Confidentialite,
  conditions: Conditions,
};

export function LegalPage({ kind }: { kind: LegalKind }) {
  const title = TITLES[kind];
  const Content = CONTENT[kind];

  useEffect(() => {
    document.title = `${title} · Smart Creator`;
    window.scrollTo(0, 0);
  }, [title]);

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b bg-background/90">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="rounded-md" aria-label="Accueil Smart Creator">
            <BrandLogo size="sm" />
          </Link>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft />
              Accueil
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-4 py-12 sm:px-6">
        <div className="space-y-4">
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>Page à compléter avant la mise en ligne</AlertTitle>
            <AlertDescription>
              Les passages surlignés attendent des informations que seul l’éditeur du site peut fournir.
            </AlertDescription>
          </Alert>
        </div>
        <Content />
      </main>

      <footer className="border-t">
        <nav
          aria-label="Pages légales"
          className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6"
        >
          <Link to="/mentions-legales" className="hover:text-foreground">
            Mentions légales
          </Link>
          <Link to="/confidentialite" className="hover:text-foreground">
            Confidentialité
          </Link>
          <Link to="/conditions" className="hover:text-foreground">
            Conditions d’utilisation
          </Link>
        </nav>
      </footer>
    </div>
  );
}
