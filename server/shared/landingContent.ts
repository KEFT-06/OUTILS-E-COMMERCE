/**
 * Texte de la page d'accueil — commun au navigateur (la page elle-même) et au serveur (ce que
 * lisent les moteurs de recherche, qui n'exécutent pas tous le JavaScript, et les données
 * structurées). Une seule source : ce qu'un moteur indexe est ce qu'un visiteur lit.
 */

export const LANDING_HERO = {
  badge: 'Pour les créateurs de produits digitaux, partout dans le monde',
  title: 'Sachez quoi vendre avant de le produire.',
  intro:
    'Smart Creator relie la lecture du marché, la création de vos produits digitaux et leur mise en vente. Avec une règle : aucun chiffre affiché sans sa source.',
  reassurance: 'Gratuit pour commencer, sans carte bancaire. Prix affichés dans la devise de votre pays.',
};

/** Les trois temps de l'outil, avec ce que chacun contient. */
export const LANDING_GROUPS = [
  {
    id: 'voir',
    title: 'Voir',
    pitch: 'Lire la demande, la concurrence et les prix pratiqués.',
    features: [
      'Analyse de niche à partir de pages web citées une à une',
      'Radar : ventes, prix et nouveautés des boutiques concurrentes, relevés chaque jour',
      'Espionnage : les publicités en cours, leur ancienneté et la boutique où elles mènent',
      'Alertes : produit qui décolle, tendance de niche, publicité installée qui s’arrête',
    ],
  },
  {
    id: 'creer',
    title: 'Créer',
    pitch: 'Structurer le produit, ses visuels, ses scripts et sa page de vente.',
    features: [
      'Studio de création : ebooks, modèles, formations et offres groupées',
      'Créatifs publicitaires : visuels et vidéos aux formats des réseaux sociaux',
      'Storybook illustré : contes pour enfants avec le même personnage à chaque page',
      'Pages produits et guides multilingues',
    ],
  },
  {
    id: 'vendre',
    title: 'Vendre',
    pitch: 'Préparer la campagne, suivre les ventes et animer vos affiliés.',
    features: ['Kit de lancement et scripts publicitaires', 'Structures de campagnes Meta et TikTok', 'Distribution, suivi des ventes et affiliation'],
  },
] as const;

export const LANDING_COMMITMENTS = [
  {
    title: 'Chaque chiffre porte sa source',
    body: 'Concurrents, prix et niveaux de marché ne s’affichent que s’ils viennent d’une page web citée dans le rapport. Sans source, le taux reste « non évalué » plutôt que deviné.',
  },
  {
    title: 'La conformité a un droit de veto',
    body: 'Promesses de gains chiffrées, avant/après trompeurs, témoignages non étayés : repérés avec une reformulation proposée. Fiche produit, guide, page de vente, kit de lancement et dossier PDF ne se téléchargent pas sans ce contrôle.',
  },
  {
    title: 'Le coût est annoncé avant',
    body: 'Chaque action affiche son coût en points, son équivalent en monnaie locale et votre solde après l’opération, avant que vous ne validiez.',
  },
] as const;

export interface LandingQuestion {
  question: string;
  answer: string;
  link?: { to: string; label: string };
}

export const LANDING_FAQ: readonly LandingQuestion[] = [
  {
    question: 'Smart Creator publie-t-il mes produits sur les marketplaces ?',
    answer: 'Non. Vous publiez sur la marketplace à partir de l’export du studio, puis Smart Creator suit vos ventes.',
  },
  {
    question: 'Les analyses de marché sont-elles en temps réel ?',
    answer: 'Oui : chaque analyse est faite au moment où vous la demandez, à partir de pages web citées une à une.',
  },
  {
    question: 'Mes publicités seront-elles acceptées par Meta ou TikTok ?',
    answer:
      'Personne ne peut le garantir. Le vérificateur signale les formulations à risque avant l’export ; la décision finale revient toujours à la plateforme.',
  },
  {
    question: 'Où sont stockées mes données ?',
    answer: 'Sur votre compte, dans une base protégée. Vous pouvez en télécharger une copie ou tout supprimer depuis Mon compte.',
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
      'Oui : l’outil est international. Choisissez votre pays à l’inscription : tous les montants s’affichent ensuite dans la devise de votre pays, et dans aucune autre.',
  },
];
