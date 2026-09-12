import { WebsiteTemplate } from '../types';

export const TEMPLATES: WebsiteTemplate[] = [
  {
    id: 'restaurant',
    name: "L'Atelier Bistronomique",
    category: 'Restaurant & Gastronomie',
    subtitle: 'Cuisine de saison, saveurs authentiques et ambiance feutrée',
    badge: 'Vitrine Gourmande',
    description: 'Site complet pour restaurant avec menu interactif à la carte, réservation de table en direct et galerie d’ambiance.',
    features: ['Menu interactif par catégorie', 'Module de réservation en direct', 'Horaires & coordonnées claires', 'Design chaleureux & élégant'],
    themeColor: 'from-amber-600 to-orange-700'
  },
  {
    id: 'portfolio',
    name: 'Studio Lumina',
    category: 'Portfolio & Créatif',
    subtitle: 'Direction artistique, photographie contemporaine et identités visuelles',
    badge: 'Portfolio Moderne',
    description: 'Une mise en valeur épurée de vos réalisations avec filtrage dynamique par discipline, fiches de projet détaillées et formulaire de contact.',
    features: ['Filtres de projets dynamiques', 'Modale d’aperçu de projet', 'Statistiques de réalisations', 'Optimisation visuelle fluide'],
    themeColor: 'from-zinc-800 to-zinc-950'
  },
  {
    id: 'saas',
    name: 'Nexus Cloud',
    category: 'SaaS & Application Tech',
    subtitle: 'La plateforme unifiée pour automatiser vos flux d’équipe',
    badge: 'Landing Page SaaS',
    description: 'Page d’atterrissage à fort taux de conversion avec sélecteur de tarification mensuel/annuel, fonctionnalités clés et accordéon FAQ interactif.',
    features: ['Sélecteur mensuel / annuel (-20%)', 'Cartes de fonctionnalités immersives', 'FAQ interactive dépliable', 'Preuve sociale et métriques'],
    themeColor: 'from-indigo-600 to-blue-700'
  },
  {
    id: 'boutique',
    name: 'Maison Terre & Lin',
    category: 'E-commerce & Artisanat',
    subtitle: 'Créations céramiques et linge naturel fait-main en France',
    badge: 'Boutique en Ligne',
    description: 'Boutique élégante avec catalogue d’articles, panier d’achat fonctionnel en temps réel, calcul du montant et processus de commande.',
    features: ['Panier d’achat en direct', 'Fiches produits avec zoom', 'Filtres de collections', 'Gestion du stock et totaux'],
    themeColor: 'from-emerald-700 to-teal-800'
  }
];

export const RESTAURANT_MENU = [
  {
    category: 'Entrées',
    items: [
      { name: 'Carpaccio de Saint-Jacques', price: '18 €', desc: 'Agrumes de saison, huile de noisette grillée et fleur de sel de Guérande.' },
      { name: 'Velouté de Butternut rôti', price: '14 €', desc: 'Éclats de châtaignes caramélisées, crème crue fermière et graines torréfiées.' },
      { name: 'Pâté en Croûte Maison', price: '16 €', desc: 'Canard fermier, pistaches fraîches et pickles de légumes du potager.' }
    ]
  },
  {
    category: 'Plats',
    items: [
      { name: 'Filet de Bar de Ligne', price: '29 €', desc: 'Mousseline de panais à la vanille bourbon, émulsion coquillages et salicorne.' },
      { name: 'Paleron de Bœuf Confit 12h', price: '28 €', desc: 'Jus corsé au romarin, purée grand-mère au beurre noisette et carottes glacées.' },
      { name: 'Risotto aux Morilles & Truffe', price: '26 €', desc: 'Riz Carnaroli crémeux, parmesan 24 mois affiné et copeaux de truffe fraîche.' }
    ]
  },
  {
    category: 'Desserts',
    items: [
      { name: 'Tartelette Croustillante au Chocolat', price: '12 €', desc: 'Cacao grand cru 70%, caramel au beurre salé et sorbet cacao amer.' },
      { name: 'Pavlova aux Fruits Rouges', price: '13 €', desc: 'Meringue vaporeuse, chantilly vanillée de Madagascar et coulis acidulé.' },
      { name: 'Poire Confite aux Épices Douces', price: '11 €', desc: 'Sablé breton pur beurre, glace au miel d’acacia des forêts vosgiennes.' }
    ]
  }
];

export const PORTFOLIO_PROJECTS = [
  {
    id: 1,
    title: 'Élixir Botanique',
    category: 'Branding',
    year: '2025',
    image: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=700&auto=format&fit=crop&q=80',
    desc: 'Identité visuelle complète et packaging éco-conçu pour une marque de soins bio.'
  },
  {
    id: 2,
    title: 'Minimal Architecture',
    category: 'Photographie',
    year: '2025',
    image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=700&auto=format&fit=crop&q=80',
    desc: 'Série photographique explorant les lignes géométriques du modernisme scandinave.'
  },
  {
    id: 3,
    title: 'Aura Sound System',
    category: 'Web Design',
    year: '2024',
    image: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=700&auto=format&fit=crop&q=80',
    desc: 'Expérience web immersive en 3D audio pour le lancement d’enceintes haut de gamme.'
  },
  {
    id: 4,
    title: 'Château Margaux Privé',
    category: 'Branding',
    year: '2024',
    image: 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=700&auto=format&fit=crop&q=80',
    desc: 'Refonte typographique et direction artistique des cuvées d’exception.'
  },
  {
    id: 5,
    title: 'Lumières Urbaines Tokyo',
    category: 'Photographie',
    year: '2024',
    image: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=700&auto=format&fit=crop&q=80',
    desc: 'Reportage nocturne haute sensibilité dans les ruelles de Shinjuku.'
  },
  {
    id: 6,
    title: 'Kinetix Studio',
    category: 'Web Design',
    year: '2024',
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=700&auto=format&fit=crop&q=80',
    desc: 'Plateforme interactive avec animations véloces pour agence de motion design.'
  }
];

export const BOUTIQUE_PRODUCTS = [
  {
    id: 'p1',
    name: 'Vase Amphore Terrecuite',
    price: 68,
    category: 'Céramique',
    rating: 4.9,
    image: 'https://images.unsplash.com/photo-1612196808214-b8e1d6145a8c?w=600&auto=format&fit=crop&q=80',
    desc: 'Pièce tournée à la main dans notre atelier, émaillée d’un blanc poudré mat.'
  },
  {
    id: 'p2',
    name: 'Nappe en Pur Lin Lavé',
    price: 94,
    category: 'Textile',
    rating: 5.0,
    image: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=600&auto=format&fit=crop&q=80',
    desc: 'Lin normand tissé serré (180g/m²), souple et naturellement respirant (140x250 cm).'
  },
  {
    id: 'p3',
    name: 'Ensemble Tasses Espresso (x4)',
    price: 48,
    category: 'Céramique',
    rating: 4.8,
    image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600&auto=format&fit=crop&q=80',
    desc: 'Grès pyrité robuste au toucher brut et intérieur vitrifié soyeux.'
  },
  {
    id: 'p4',
    name: 'Bougie Végétale Cèdre & Sauge',
    price: 34,
    category: 'Ambiance',
    rating: 4.9,
    image: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=600&auto=format&fit=crop&q=80',
    desc: 'Cire de soja 100% naturelle, mèche en bois crépitante et essences de Grasse.'
  }
];
