import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTrackVisit } from '@/shared/hooks/useTrackVisit';
import { usePublicPageMeta } from '@/shared/hooks/usePublicPageMeta';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { BrandLogo } from '@/shared/components/BrandLogo';
import { Button } from '@/shared/ui/button';

/**
 * Pages légales.
 *
 * Les informations que seul l'éditeur peut fournir (identité, adresse, hébergeur,
 * durées légales, droit applicable) sont signalées « à compléter » plutôt
 * qu'inventées. Le reste décrit le site tel qu'il fonctionne réellement : chaque
 * durée et chaque service cité correspond au code du serveur.
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

function ContactLink({ topic, children }: { topic?: 'data'; children: ReactNode }) {
  return (
    <Link to={topic ? `/contact?sujet=${topic}` : '/contact'} className="font-medium text-brand-green-text underline underline-offset-4">
      {children}
    </Link>
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
          Contact : par le <ContactLink>formulaire de contact</ContactLink>.
        </p>
      </Section>
      <Section title="Hébergement">
        <p>
          Site : <ToComplete>nom, adresse et contact de l’hébergeur du site</ToComplete>
        </p>
        <p>
          Base de données : <ToComplete>nom de l’hébergeur de la base de données et pays des serveurs</ToComplete>
        </p>
      </Section>
      <Section title="Propriété intellectuelle">
        <p>
          La marque Smart Creator, son logo, ses textes et son interface sont protégés. Toute reproduction sans
          l’autorisation de l’éditeur est interdite. Les contenus que vous créez avec le site vous appartiennent.
        </p>
      </Section>
      <Section title="Nature des analyses">
        <p>
          Les analyses de niche s’appuient sur des sources web citées une à une. Un chiffre sans source n’est pas affiché,
          et une analyse sans source ne rend aucun verdict. Ces analyses aident à décider mais ne garantissent aucun
          résultat commercial ou financier.
        </p>
      </Section>
    </>
  );
}

function Confidentialite() {
  return (
    <>
      <Section title="Responsable du traitement">
        <p>
          <ToComplete>identité et adresse du responsable du traitement</ToComplete>
        </p>
        <p>
          Pour toute question sur vos données : le <ContactLink topic="data">formulaire de contact</ContactLink>, sujet
          « Mes données personnelles ».
        </p>
      </Section>

      <Section title="Données conservées">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Compte</strong> : nom, adresse e-mail, pays, date de confirmation de l’adresse, palier et points de
            recherche. Le mot de passe n’est jamais conservé en clair (empreinte Argon2id) ; le secret de l’application
            d’authentification est chiffré.
          </li>
          <li>
            <strong>Travail</strong> : vos 50 dernières analyses de niche, vos brouillons (produits, kits de lancement,
            pages produits), vos guides et leurs traductions, vos couvertures et l’historique de vos
            générations. Ils sont enregistrés sur votre compte et vous les retrouvez sur chaque appareil.
          </li>
          <li>
            <strong>Connexions</strong> : pendant une session, l’adresse IP et le navigateur. Après la déconnexion,
            l’historique ne garde que le type d’appareil et une adresse IP tronquée.
          </li>
          <li>
            <strong>Journal de sécurité</strong> : connexions réussies ou refusées, changements de mot de passe et de
            second facteur, avec l’adresse IP et le navigateur.
          </li>
          <li>
            <strong>Paiements</strong> : palier, montant, devise, date et référence du paiement. Le numéro de carte est
            saisi sur la page de Stripe et n’arrive jamais sur nos serveurs.
          </li>
          <li>
            <strong>Clé Chariow personnelle</strong> : chiffrée sur le serveur, jamais renvoyée au navigateur ; seuls ses
            quatre derniers caractères sont affichés.
          </li>
          <li>
            <strong>Messages de contact</strong> : nom, adresse e-mail, sujet et message.
          </li>
        </ul>
      </Section>

      <Section title="Qui y accède">
        <p>
          Les administrateurs de Smart Creator voient les informations de compte, les paiements et l’historique des
          connexions, pour l’assistance et la sécurité. Ils peuvent aussi ouvrir les vidéos et visuels générés, pour
          l’assistance et le contrôle du respect des conditions d’utilisation. Chacune de leurs actions, dont chaque
          ouverture d’une vidéo ou d’un visuel, est inscrite dans un journal qu’ils ne peuvent pas effacer. Quand vous demandez la relecture d’une traduction, le relecteur désigné voit le guide
          concerné.
        </p>
      </Section>

      <Section title="Services tiers">
        <p>
          Quand vous utilisez une fonction, et seulement si le service correspondant est configuré sur le serveur, les
          informations nécessaires lui sont transmises par le serveur. Aucune de nos clés d’accès n’est envoyée au
          navigateur.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Prestataires de rédaction et de traduction par intelligence artificielle : la niche et le marché d’une analyse avec l’étude et les sources trouvées, les textes à rédiger ou à traduire, le brief d’un storybook, la description d’une couverture, la vidéo ou le lien YouTube d’un produit créé à partir d’une vidéo ;</li>
          <li>Prestataire de recherche sur le web : la niche et le marché d’une analyse, sans aucune donnée de compte ;</li>
          <li>Prestataire de création de visuels et de vidéos : le brief d’un visuel ou d’une vidéo ;</li>
          <li>Prestataire de mise en page illustrée : le texte d’un storybook et la description de ses illustrations ;</li>
          <li>
            Chariow : avec votre propre clé, la consultation de votre catalogue, de vos ventes et de vos affiliés, et les
            adresses e-mail que vous saisissez pour inviter des affiliés — Chariow leur envoie alors un e-mail ;
          </li>
          <li>Stripe : votre adresse e-mail, l’identifiant de votre compte, le palier et le montant, lors d’un paiement ;</li>
          <li>
            Service d’envoi d’e-mails (Brevo ou Resend) : votre adresse et le contenu des e-mails de sécurité (lien de
            nouveau mot de passe, confirmation d’adresse, alerte de changement de mot de passe).
          </li>
        </ul>
        <p>
          Plusieurs de ces services sont établis hors de l’Union européenne.{' '}
          <ToComplete>garanties encadrant ces transferts (clauses contractuelles types, cadre de protection des données)</ToComplete>
        </p>
        <p>
          L’identité de chacun de ces prestataires vous est communiquée sur simple demande écrite, à l’adresse de
          contact indiquée dans les mentions légales.
        </p>
      </Section>

      <Section title="Cookies et stockage du navigateur">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Cookie de session : vous garde connecté, illisible par les scripts de la page. Il expire après 30 jours, ou 7
            jours sans activité ; 12 heures pour un compte d’administration.
          </li>
          <li>Cookie de second facteur : quelques minutes, le temps de saisir le code de connexion.</li>
          <li>Cookie « sidebar_state » : mémorise l’état ouvert ou replié de la barre latérale, 7 jours.</li>
          <li>Stockage du navigateur : le thème clair ou sombre et la dernière analyse ouverte.</li>
        </ul>
        <p>
          Ces éléments sont nécessaires au fonctionnement du site. Smart Creator ne dépose aucun cookie publicitaire ni de
          mesure d’audience.
        </p>
      </Section>

      <Section title="Mesure d’audience sans cookie">
        <p>
          Sur les pages publiques seulement (accueil, connexion, contact, pages légales), le serveur compte les visites par
          page et par jour, et le site d’où vient le visiteur. Pour compter les visiteurs uniques, il calcule une empreinte
          avec une clé qui change chaque jour ; les empreintes sont effacées le lendemain et ne permettent pas de vous
          suivre d’un jour à l’autre. Si votre navigateur envoie un refus de suivi (Do Not Track ou Global Privacy
          Control), rien n’est compté.
        </p>
      </Section>

      <Section title="Durées de conservation">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Compte, contenus et clé Chariow : tant que le compte existe ;</li>
          <li>Analyses de niche : les 50 plus récentes ;</li>
          <li>Historique des connexions : 12 mois après la déconnexion ;</li>
          <li>Journal de sécurité : 12 mois ;</li>
          <li>Messages de contact : 12 mois ;</li>
          <li>Lien de nouveau mot de passe : 1 heure ; lien de confirmation d’adresse : 48 heures ;</li>
          <li>Empreintes de la mesure d’audience : jusqu’au lendemain ;</li>
          <li>
            Paiements : conservés pour la comptabilité, y compris après la suppression du compte, pendant{' '}
            <ToComplete>durée légale de conservation des pièces comptables</ToComplete>.
          </li>
        </ul>
      </Section>

      <Section title="Vos droits">
        <p>
          Dans Mon compte, vous pouvez à tout moment modifier votre nom et votre pays, télécharger une copie de toutes vos
          données (fichier JSON) et supprimer votre compte. La suppression efface le compte, les contenus, les sessions et
          le journal de sécurité ; seule reste une trace anonyme de la suppression, et les paiements pour la comptabilité.
        </p>
        <p>
          Pour toute autre demande (rectification, opposition, limitation) : le{' '}
          <ContactLink topic="data">formulaire de contact</ContactLink>. Vous pouvez aussi saisir l’autorité de protection
          des données de votre pays (en France, la CNIL).
        </p>
      </Section>
    </>
  );
}

function Conditions() {
  return (
    <>
      <Section title="Objet">
        <p>
          Smart Creator aide à lire un marché, à produire des produits digitaux et à les vendre : analyses de niche,
          studio de produits, kits de lancement, pages produits, campagnes et guides multilingues. Ces conditions
          s’appliquent dès la création d’un compte.
        </p>
      </Section>
      <Section title="Compte">
        <p>
          Un compte correspond à une personne. Vous fournissez une adresse e-mail valide, gardez votre mot de passe pour
          vous et êtes responsable de ce qui est fait depuis votre compte. Activer l’application d’authentification est
          vivement recommandé.
        </p>
      </Section>
      <Section title="Points de recherche et paliers">
        <p>
          Chaque action payante affiche son coût en points avant validation. Si une génération échoue, les points sont
          rendus. Les quotas et les prix affichés sur le site sont ceux en vigueur au moment de l’action ou du paiement.
        </p>
      </Section>
      <Section title="Paiement">
        <p>
          Les paliers se paient par carte sur la page sécurisée de Stripe, pour 1 mois ou 1 an. Le palier s’active dès que
          Stripe confirme le paiement. Il n’y a pas de renouvellement automatique : aucun prélèvement n’a lieu sans un
          nouveau paiement de votre part.
        </p>
        <p>
          Rétractation et remboursement : <ToComplete>conditions de rétractation et de remboursement</ToComplete>
        </p>
      </Section>
      <Section title="Analyses et résultats">
        <p>
          Les taux, volumes et recommandations reposent sur des sources publiques citées et sur des estimations dont la
          nature est affichée. Ils ne constituent ni un conseil financier ni une garantie de ventes.
        </p>
      </Section>
      <Section title="Contenus générés">
        <p>
          Les textes, visuels et vidéos sont produits par des modèles d’intelligence artificielle qui peuvent se tromper.
          Relisez tout contenu avant de le diffuser ; vous restez responsable de ce que vous publiez. Les contes du
          storybook ne passent pas par le vérificateur de conformité, et la cohérence d’un personnage d’une page à l’autre
          n’est pas garantie.
        </p>
      </Section>
      <Section title="Conformité publicitaire">
        <p>
          Le vérificateur de conformité signale les formulations à risque avant chaque export. Il ne remplace ni la
          modération des plateformes publicitaires, qui garde la décision finale, ni un avis juridique.
        </p>
      </Section>
      <Section title="Chariow et invitations d’affiliés">
        <p>
          Chaque utilisateur branche sa propre clé Chariow. Une invitation déclenche l’envoi immédiat d’un e-mail par
          Chariow : n’invitez que des personnes qui ont accepté d’être contactées.
        </p>
      </Section>
      <Section title="Usages interdits">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>produire ou diffuser des contenus illicites, trompeurs ou qui portent atteinte aux droits d’autrui ;</li>
          <li>tenter d’accéder au compte d’un autre utilisateur ou aux parties non publiques du site ;</li>
          <li>contourner les limites de points, de débit ou de sécurité, ou automatiser l’usage du site ;</li>
          <li>revendre ou partager l’accès à un compte.</li>
        </ul>
        <p>Un compte qui enfreint ces règles peut être bloqué par l’administration.</p>
      </Section>
      <Section title="Disponibilité">
        <p>
          Le site évolue régulièrement. Plusieurs fonctions dépendent de services tiers ; quand l’un d’eux n’est pas
          disponible ou pas configuré, l’écran l’indique.
        </p>
      </Section>
      <Section title="Fin d’utilisation">
        <p>Vous pouvez supprimer votre compte à tout moment depuis Mon compte.</p>
      </Section>
      <Section title="Droit applicable">
        <p>
          <ToComplete>droit applicable et juridiction compétente</ToComplete>
        </p>
      </Section>
      <Section title="Contact">
        <p>
          Par le <ContactLink>formulaire de contact</ContactLink>.
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
  useTrackVisit(`/${kind}`);
  usePublicPageMeta(`/${kind}`);
  const title = TITLES[kind];
  const Content = CONTENT[kind];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [kind]);

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
          <Link to="/contact" className="hover:text-foreground">
            Contact
          </Link>
        </nav>
      </footer>
    </div>
  );
}
