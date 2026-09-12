import { CustomSiteConfig, PresetKey } from '../types';

export interface PresetInfo {
  key: PresetKey;
  label: string;
  icon: string;
  config: CustomSiteConfig;
}

export const PRESETS: Record<PresetKey, PresetInfo> = {
  artisan: {
    key: 'artisan',
    label: 'Artisan & Rénovation BTP',
    icon: 'Hammer',
    config: {
      siteName: 'Atelier Rénov & Bâtiment',
      category: 'Rénovation intérieure & Artisanat',
      tagline: 'Donnez vie à vos projets de rénovation avec exigence et savoir-faire',
      description: 'Entreprise artisanale certifiée RGE. Rénovation complète d’appartements, plomberie, électricité et aménagement sur-mesure en Île-de-France.',
      colorScheme: 'amber',
      styleMood: 'chaleureux',
      phone: '01 42 68 90 12',
      email: 'contact@atelier-renov.fr',
      address: '14 rue des Artisans, 75011 Paris',
      ctaText: 'Demander un devis gratuit',
      sections: {
        hero: true,
        services: true,
        gallery: true,
        pricing: true,
        testimonials: true,
        contact: true,
      },
      servicesList: [
        {
          title: 'Rénovation Complète Clé en Main',
          description: 'Coordination intégrale de votre chantier : démolition, maçonnerie, placo, peinture et finitions haut de gamme.',
          price: 'Sur devis',
          duration: '3 à 8 semaines'
        },
        {
          title: 'Salles de Bain & Plomberie',
          description: 'Création de douches à l’italienne, pose de carrelage grand format, sanitaires et robinetterie design encastrée.',
          price: 'Dès 3 500 €',
          duration: '1 à 2 semaines'
        },
        {
          title: 'Cuisines Équipées & Agencements',
          description: 'Conception et pose de cuisines modernes, plans de travail sur-mesure, menuiserie et rangements optimisés.',
          price: 'Dès 2 800 €',
          duration: '3 à 5 jours'
        },
        {
          title: 'Électricité & Mise aux Normes',
          description: 'Tableaux électriques NF C 15-100, éclairage LED domotique et diagnostic de conformité complet.',
          price: 'Dès 850 €',
          duration: '2 à 4 jours'
        }
      ],
      testimonialsList: [
        {
          author: 'Alexandre & Sophie M.',
          role: 'Propriétaires à Boulogne',
          comment: 'Une équipe ponctuelle, méticuleuse et d’une transparence absolue sur les délais. Notre appartement a été métamorphosé en 6 semaines chrono !',
          rating: 5
        },
        {
          author: 'Valérie D.',
          role: 'Rénovation salle de bain à Paris',
          comment: 'Très bons conseils sur les matériaux. Le résultat est encore plus beau que nos plans 3D. Merci pour votre professionnalisme.',
          rating: 5
        },
        {
          author: 'Julien T.',
          role: 'Architecte d’intérieur',
          comment: 'Je recommande Atelier Rénov à tous mes clients. Finitions impeccables et respect rigoureux des normes du bâtiment.',
          rating: 5
        }
      ],
      galleryList: [
        {
          title: 'Rénovation Haussmannienne',
          category: 'Appartement complet',
          imageUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&auto=format&fit=crop&q=80'
        },
        {
          title: 'Suite parentale & Douche Italienne',
          category: 'Salle de bain',
          imageUrl: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800&auto=format&fit=crop&q=80'
        },
        {
          title: 'Cuisine Ouverte & Verrière Noire',
          category: 'Cuisine',
          imageUrl: 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=800&auto=format&fit=crop&q=80'
        }
      ],
      pricingList: [
        {
          name: 'Visite Conseil & Étude',
          price: 'Offert',
          period: 'sans engagement',
          description: 'Déplacement d’un conducteur de travaux pour analyser vos besoins et mesurer les surfaces.',
          features: ['Prise de côtes sur place', 'Diagnostic technique préalable', 'Chiffrage détaillé sous 48h', 'Conseils d’optimisation']
        },
        {
          name: 'Rénovation Essentielle',
          price: '550 €',
          period: '/ m²',
          description: 'Remise à neuf rapide des murs, sols, peintures et mise en conformité des prises.',
          features: ['Préparation des supports', 'Peinture dépolluante satinée', 'Pose de parquet ou sol vinyle', 'Garantie décennale incluse'],
          highlight: true
        },
        {
          name: 'Rénovation Prestige & Structure',
          price: '1 100 €',
          period: '/ m²',
          description: 'Restructuration totale des volumes, ouverture de murs porteurs et menuiserie intégrée.',
          features: ['Plans d’architecte & suivi', 'Ouverture IPN avec BET', 'Réseaux encastrés à neuf', 'Matériaux premium sur-mesure']
        }
      ]
    }
  },

  restaurant: {
    key: 'restaurant',
    label: 'Restaurant & Bistronomie',
    icon: 'Utensils',
    config: {
      siteName: 'La Table du Marais',
      category: 'Restaurant Bistronomique & Vins Naturels',
      tagline: 'Cuisine créative du marché, produits de terroir & accords raffinés',
      description: 'Une expérience gustative singulière au cœur de Paris. Menu changeant chaque semaine selon les récoltes de nos producteurs partenaires.',
      colorScheme: 'amber',
      styleMood: 'chaleureux',
      phone: '01 48 04 33 22',
      email: 'reservation@table-marais.fr',
      address: '28 rue des Rosiers, 75004 Paris',
      ctaText: 'Réserver une table',
      sections: {
        hero: true,
        services: true,
        gallery: true,
        pricing: true,
        testimonials: true,
        contact: true,
      },
      servicesList: [
        {
          title: 'Menu Dégustation 5 Temps',
          description: 'Voyage culinaire complet imaginé chaque soir par notre chef Julien Barret et son équipe.',
          price: '68 € / pers',
          duration: 'Dîner'
        },
        {
          title: 'Formule Déjeuner du Marché',
          description: 'Entrée + Plat + Dessert de saison, préparés minute avec fraîcheur et vivacité.',
          price: '28 €',
          duration: 'Midi (Mar - Ven)'
        },
        {
          title: 'Privatisation & Événements',
          description: 'Salon privatisable jusqu’à 30 convives pour vos déjeuners d’affaires, anniversaires ou mariages intimistes.',
          price: 'Sur devis',
          duration: 'Midi ou Soir'
        },
        {
          title: 'Accord Mets & Vins Vivants',
          description: 'Sélection pointue de vignerons indépendants, biodynamie et cuvées rares commentées par notre sommelière.',
          price: '36 €',
          duration: '4 verres'
        }
      ],
      testimonialsList: [
        {
          author: 'Guide Épicurien Paris',
          role: 'Chroniqueur Gastronomique',
          comment: 'Une des tables les plus séduisantes du quartier. La cuisson du bar de ligne et les émulsions d’herbes sont d’une précision magistrale.',
          rating: 5
        },
        {
          author: 'Camille B.',
          role: 'Dîner d’anniversaire',
          comment: 'Accueil chaleureux, service attentif sans être guindé, et des saveurs inoubliables. Pensez à réserver quelques jours à l’avance !',
          rating: 5
        }
      ],
      galleryList: [
        {
          title: 'Plat Signature du Chef',
          category: 'Cuisine',
          imageUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=800&auto=format&fit=crop&q=80'
        },
        {
          title: 'Salle Contemporaine & Verrière',
          category: 'Ambiance',
          imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&auto=format&fit=crop&q=80'
        },
        {
          title: 'Cave à Vins Naturels',
          category: 'Sommellerie',
          imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&auto=format&fit=crop&q=80'
        }
      ],
      pricingList: [
        {
          name: 'Menu Découverte',
          price: '45 €',
          period: '/ personne',
          description: 'Entrée, Plat et Dessert au choix sur l’ardoise du jour.',
          features: ['Pain au levain maison', 'Beurre fermier baratté', 'Mignardises avec le café', 'Options végétariennes disponibles']
        },
        {
          name: 'Menu Signature & Vins',
          price: '89 €',
          period: '/ personne',
          description: '5 créations gastronomiques avec accord 3 verres de grands crus.',
          features: ['Accueil champagne de bienvenue', 'Produits nobles (truffe, homard)', 'Accord mets & vins guidé', 'Digestif de notre sélection'],
          highlight: true
        }
      ]
    }
  },

  conseil: {
    key: 'conseil',
    label: 'Cabinet Conseil & Juridique',
    icon: 'Briefcase',
    config: {
      siteName: 'Vanguard Conseil & Stratégie',
      category: 'Conseil en Gestion & Stratégie d’Entreprise',
      tagline: 'Accélérez votre croissance et sécurisez vos décisions stratégiques',
      description: 'Cabinet de conseil indépendant accompagnant dirigeants, PME et scale-ups dans leur structuration financière, juridique et organisationnelle.',
      colorScheme: 'slate',
      styleMood: 'prestige',
      phone: '01 53 80 40 00',
      email: 'contact@vanguard-conseil.fr',
      address: '45 avenue Montaigne, 75008 Paris',
      ctaText: 'Programmer un échange confidentiel',
      sections: {
        hero: true,
        services: true,
        gallery: false,
        pricing: true,
        testimonials: true,
        contact: true,
      },
      servicesList: [
        {
          title: 'Audit & Diagnostic 360°',
          description: 'Analyse approfondie des performances financières, processus opérationnels et risques réglementaires.',
          price: 'À partir de 3 200 €',
          duration: '2 semaines'
        },
        {
          title: 'Levée de Fonds & M&A',
          description: 'Préparation du pitch deck, valorisation d’entreprise, due diligence et négociations avec les investisseurs.',
          price: 'Mandat dédié',
          duration: '3 à 6 mois'
        },
        {
          title: 'Transformation Digitale & IA',
          description: 'Modernisation des outils de gestion, automatisation des processus métiers et intégration de l’IA générative.',
          price: 'Sur-mesure',
          duration: 'Accompagnement continu'
        },
        {
          title: 'Direction Financière Externalisée',
          description: 'Un CFO senior à temps partagé pour piloter votre trésorerie, vos budgets et vos reportings investisseurs.',
          price: 'Dès 1 500 € / mois',
          duration: 'Abonnement flexible'
        }
      ],
      testimonialsList: [
        {
          author: 'Édouard de Courcy',
          role: 'CEO, FinTech Horizon',
          comment: 'Le cabinet Vanguard nous a permis de clore notre Série A de 4,5M€ dans des conditions idéales grâce à une modélisation financière sans faille.',
          rating: 5
        },
        {
          author: 'Claire Lemaître',
          role: 'Directrice Générale, Groupe Novis',
          comment: 'Une rigueur d’analyse exceptionnelle couplée à un sens pratique rare chez les consultants traditionnels.',
          rating: 5
        }
      ],
      galleryList: [],
      pricingList: [
        {
          name: 'Session Stratégique',
          price: '750 €',
          period: '/ demi-journée',
          description: 'Session intensive de cadrage stratégique avec un associé pour débloquer une problématique clé.',
          features: ['Pré-analyse de vos documents', '3h d’atelier de travail direct', 'Plan d’action opérationnel 90j', 'Synthèse exécutive sous 24h']
        },
        {
          name: 'Accompagnement Mensuel',
          price: '2 800 €',
          period: '/ mois',
          description: 'Pilotage régulier et support stratégique continu pour le comité de direction.',
          features: ['Comités de direction bimensuels', 'Accès prioritaire direct aux associés', 'Revue financière mensuelle', 'Assistance aux négociations'],
          highlight: true
        }
      ]
    }
  },

  coach: {
    key: 'coach',
    label: 'Coach Sportif & Bien-être',
    icon: 'Activity',
    config: {
      siteName: 'Pulse Coaching & Performance',
      category: 'Coaching Personnalisé & Remise en Forme',
      tagline: 'Transformez votre énergie, votre corps et votre mental',
      description: 'Coach sportif diplômé d’État. Programmes sur-mesure de renforcement, perte de poids, préparation physique et nutrition personnalisée.',
      colorScheme: 'emerald',
      styleMood: 'moderne',
      phone: '06 12 34 56 78',
      email: 'hello@pulse-coaching.fr',
      address: 'Studio Privé & À Domicile (Paris & Ouest Parisien)',
      ctaText: 'Réserver mon bilan forme offert',
      sections: {
        hero: true,
        services: true,
        gallery: true,
        pricing: true,
        testimonials: true,
        contact: true,
      },
      servicesList: [
        {
          title: 'Coaching Individuel 1-to-1',
          description: 'Séance sur-mesure au studio ou à domicile avec matériel professionnel et correction posturale continue.',
          price: '70 € / séance',
          duration: '60 min'
        },
        {
          title: 'Suivi Nutrition & Métabolisme',
          description: 'Plan alimentaire adapté à vos goûts, sans privation toxique, calcul des macros et recettes simples au quotidien.',
          price: '120 € / mois',
          duration: 'Suivi continu'
        },
        {
          title: 'Préparation Physique Ciblée',
          description: 'Marathon, triathlon, sports collectifs : optimisation du cardio, puissance explosive et prévention des blessures.',
          price: 'Dès 80 €',
          duration: 'Cycles 12 semaines'
        }
      ],
      testimonialsList: [
        {
          author: 'Thomas R.',
          role: 'Cadre Dirigeant, -12kg en 5 mois',
          comment: 'Je n’avais pas fait de sport depuis 8 ans. L’approche bienveillante mais stimulante a complètement changé mon rapport à l’effort.',
          rating: 5
        },
        {
          author: 'Sarah K.',
          role: 'Finisher Marathon de Paris',
          comment: 'Programme au millimètre, zéro blessure et un mental d’acier le jour J. Meilleur investissement santé de ma vie !',
          rating: 5
        }
      ],
      galleryList: [
        {
          title: 'Séances en Studio Privé',
          category: 'Entraînement',
          imageUrl: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80'
        },
        {
          title: 'Renforcement Fonctionnel',
          category: 'Force & Mobilité',
          imageUrl: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=800&auto=format&fit=crop&q=80'
        }
      ],
      pricingList: [
        {
          name: 'Pack 10 Séances',
          price: '650 €',
          period: 'valable 3 mois',
          description: 'Idéal pour enclencher une routine durable et corriger ses mouvements.',
          features: ['Bilan postural complet initial', 'Séances privées 60 min', 'Accès à l’application de suivi', 'Conseils hydratation & sommeil']
        },
        {
          name: 'Programme Métamorphose 3 Mois',
          price: '490 €',
          period: '/ mois',
          description: 'La solution complète tout-en-un pour des résultats visibles et durables.',
          features: ['2 séances par semaine (24 au total)', 'Plan nutritionnel révisé chaque quinzaine', 'Support WhatsApp 7j/7 avec le coach', 'Garantie progression mesurée'],
          highlight: true
        }
      ]
    }
  },

  agence: {
    key: 'agence',
    label: 'Agence Web & Digitale',
    icon: 'Sparkles',
    config: {
      siteName: 'Studio Nova Digital',
      category: 'Agence Webdesign, Branding & Développement',
      tagline: 'Nous concevons des sites web remarquables qui convertissent vos visiteurs',
      description: 'Agence créative spécialisée dans la création de sites internet sur-mesure, applications web React et identités de marque percutantes.',
      colorScheme: 'indigo',
      styleMood: 'moderne',
      phone: '01 70 80 90 00',
      email: 'contact@nova-studio.fr',
      address: '10 rue de Paradis, 75010 Paris',
      ctaText: 'Lancer mon projet de site',
      sections: {
        hero: true,
        services: true,
        gallery: true,
        pricing: true,
        testimonials: true,
        contact: true,
      },
      servicesList: [
        {
          title: 'Création de Site Vitrine Sur-Mesure',
          description: 'Design unique, 100% responsive, optimisé SEO et ultra-rapide au chargement avec React & Tailwind.',
          price: 'Dès 1 800 €',
          duration: '2 à 3 semaines'
        },
        {
          title: 'E-commerce & Boutiques en Ligne',
          description: 'Paiements Stripe sécurisés, gestion de catalogue produit, paniers fluides et suivi logistique automatisé.',
          price: 'Dès 3 400 €',
          duration: '4 à 6 semaines'
        },
        {
          title: 'Identité Visuelle & Charte Graphique',
          description: 'Logo vectoriel, typographies, palette de couleurs et guide de style pour affirmer votre singularité.',
          price: 'Dès 950 €',
          duration: '1 à 2 semaines'
        }
      ],
      testimonialsList: [
        {
          author: 'Maxime Guérin',
          role: 'Fondateur, Solarix Tech',
          comment: 'Notre nouveau site web a multiplié nos demandes de devis par 3 dès le premier mois. Design soigné et code propre.',
          rating: 5
        },
        {
          author: 'Léa Fontaine',
          role: 'Directrice Marketing, Art & Matière',
          comment: 'Une équipe réactive, à l’écoute et force de proposition. Le résultat dépasse toutes nos attentes !',
          rating: 5
        }
      ],
      galleryList: [
        {
          title: 'Plateforme FinTech Nova',
          category: 'Web App & Dashboard',
          imageUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&auto=format&fit=crop&q=80'
        },
        {
          title: 'E-commerce Cosmétiques Naturels',
          category: 'Boutique en ligne',
          imageUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&auto=format&fit=crop&q=80'
        }
      ],
      pricingList: [
        {
          name: 'Site Vitrine Express',
          price: '1 890 €',
          period: 'clé en main',
          description: 'Idéal pour artisans, indépendants et TPE souhaitant une présence en ligne impeccable.',
          features: ['Site one-page moderne 5 sections', 'Design responsive mobile & PC', 'Formulaire de devis connecté', 'Hébergement & nom de domaine 1 an']
        },
        {
          name: 'Site Multi-Pages Pro',
          price: '3 200 €',
          period: 'clé en main',
          description: 'Pour les entreprises établies visant le leadership sur leur secteur d’activité.',
          features: ['Jusqu’à 8 pages sur-mesure', 'Optimisation SEO Google poussée', 'Animations fluides & interactives', 'Formation à la prise en main'],
          highlight: true
        }
      ]
    }
  },

  boutique: {
    key: 'boutique',
    label: 'Boutique Mode & Créateur',
    icon: 'ShoppingBag',
    config: {
      siteName: 'Maison Éléonore',
      category: 'Mode Éthique & Prêt-à-Porter Féminin',
      tagline: 'L’élégance intemporelle tissée en matières naturelles et durables',
      description: 'Pièces confectionnées en petites séries dans des ateliers familiaux en France et au Portugal. Soie sauvage, lin biologique et coupes parfaites.',
      colorScheme: 'rose',
      styleMood: 'minimaliste',
      phone: '01 40 20 10 30',
      email: 'service-client@maison-eleonore.fr',
      address: '18 rue de Grenelle, 75007 Paris',
      ctaText: 'Découvrir la nouvelle collection',
      sections: {
        hero: true,
        services: true,
        gallery: true,
        pricing: false,
        testimonials: true,
        contact: true,
      },
      servicesList: [
        {
          title: 'Livraison Express & Soignée',
          description: 'Expédition sous 24h dans un coffret recyclable parfumé avec retours offerts sous 30 jours.',
          price: 'Offerte dès 120 €',
          duration: '24-48h'
        },
        {
          title: 'Service Retouches en Boutique',
          description: 'Ajustement personnalisé de vos vestes et robes par notre couturière au sein de notre boutique parisienne.',
          price: 'Inclus',
          duration: '48h'
        },
        {
          title: 'Conseil Style Privé',
          description: 'Rendez-vous privatif de 45 minutes pour composer votre dressing idéal selon votre morphologie.',
          price: 'Gratuit',
          duration: 'Sur rendez-vous'
        }
      ],
      testimonialsList: [
        {
          author: 'Chloé V.',
          role: 'Cliente fidèle',
          comment: 'La qualité du lin et la coupe de la veste Palma sont exceptionnelles. Enfin une vraie marque responsable qui ne sacrifie rien au chic !',
          rating: 5
        }
      ],
      galleryList: [
        {
          title: 'Robe en Lin Écru "Palma"',
          category: 'Collection Été',
          imageUrl: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&auto=format&fit=crop&q=80'
        },
        {
          title: 'Tailleur Soie & Laine',
          category: 'Intemporels',
          imageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&auto=format&fit=crop&q=80'
        }
      ],
      pricingList: []
    }
  },

  immo: {
    key: 'immo',
    label: 'Immobilier & Architecture',
    icon: 'Building2',
    config: {
      siteName: 'Prestige & Territoires',
      category: 'Immobilier de Caractère & Propriétés d’Exception',
      tagline: 'L’art de vivre les plus beaux lieux de résidence en France',
      description: 'Agence immobilière spécialisée dans les biens remarquables : hôtels particuliers, mas provençaux, lofts d’architecte et domaines viticoles.',
      colorScheme: 'slate',
      styleMood: 'prestige',
      phone: '01 45 00 12 34',
      email: 'contact@prestige-territoires.fr',
      address: '3 place Vendôme, 75001 Paris',
      ctaText: 'Estimer confidentiellement mon bien',
      sections: {
        hero: true,
        services: true,
        gallery: true,
        pricing: false,
        testimonials: true,
        contact: true,
      },
      servicesList: [
        {
          title: 'Vente & Mandat Exclusif',
          description: 'Valorisation par reportage photo & vidéo drone, diffusion ciblée auprès d’une clientèle qualifiée internationale.',
          price: 'Honoraires adaptés',
          duration: 'Accompagnement complet'
        },
        {
          title: 'Chasse Immobilière Privée',
          description: 'Recherche sur-mesure de biens "off-market" non publiés pour acquéreurs exigeants.',
          price: 'Sur mandat',
          duration: 'Accès exclusif'
        }
      ],
      testimonialsList: [
        {
          author: 'Comte & Comtesse de V.',
          role: 'Vente Domaine en Sologne',
          comment: 'Une discrétion exemplaire et une vente conclue en moins de 3 mois au prix souhaité.',
          rating: 5
        }
      ],
      galleryList: [
        {
          title: 'Manoir Historique & Parc arboré',
          category: 'Propriété de charme',
          imageUrl: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&auto=format&fit=crop&q=80'
        },
        {
          title: 'Loft Contemporain avec Terrasse',
          category: 'Penthouse Paris',
          imageUrl: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&auto=format&fit=crop&q=80'
        }
      ],
      pricingList: []
    }
  },

  tech: {
    key: 'tech',
    label: 'Freelance Développeur / Tech',
    icon: 'Code2',
    config: {
      siteName: 'Thomas Martin — Ingénieur Web',
      category: 'Développeur Full-Stack React & Node.js',
      tagline: 'Je conçois des applications web rapides, évolutives et robustes',
      description: '8 ans d’expérience en ingénierie logicielle. J’aide startups et grands comptes à concevoir, déployer et moderniser leurs plateformes numériques.',
      colorScheme: 'violet',
      styleMood: 'moderne',
      phone: '06 99 88 77 66',
      email: 'thomas@martin-dev.io',
      address: 'Paris & Remote (France & Europe)',
      ctaText: 'Discuter de votre projet technique',
      sections: {
        hero: true,
        services: true,
        gallery: true,
        pricing: true,
        testimonials: true,
        contact: true,
      },
      servicesList: [
        {
          title: 'Développement Web Full-Stack',
          description: 'Applications React, TypeScript, Next.js / Vite avec API REST sécurisées et base de données haute performance.',
          price: '650 € / jour',
          duration: 'Régie ou Forfait'
        },
        {
          title: 'Audit de Performance & Sécurité',
          description: 'Diagnostic Lighthouse 100/100, revue de code, sécurisation OWASP et optimisation des temps de chargement.',
          price: '1 400 €',
          duration: '2 jours'
        },
        {
          title: 'Architecture Cloud & DevOps',
          description: 'Mise en place de CI/CD GitHub Actions, conteneurisation Docker et déploiement Cloud Run / AWS.',
          price: 'Sur devis',
          duration: 'Selon périmètre'
        }
      ],
      testimonialsList: [
        {
          author: 'Sébastien B.',
          role: 'CTO, DataWave',
          comment: 'Thomas est intervenu sur notre refonte d’API critique. Livraison en avance, code testé et communication exemplaire.',
          rating: 5
        }
      ],
      galleryList: [
        {
          title: 'Dashboard Analytics SaaS',
          category: 'React & Tailwind',
          imageUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&auto=format&fit=crop&q=80'
        }
      ],
      pricingList: [
        {
          name: 'Forfait MVP 2 Semaines',
          price: '4 800 €',
          period: 'livré prêt à tester',
          description: 'Un premier prototype fonctionnel pour valider votre produit auprès de vrais utilisateurs.',
          features: ['Interface utilisateur soignée', 'Base de données & Auth configurées', 'Déploiement en ligne direct', 'Code source cédé à 100%']
        },
        {
          name: 'Sprint Technique 1 Semaine',
          price: '2 900 €',
          period: '5 jours ouvrés',
          description: 'Intégration d’une fonctionnalité complexe ou refonte d’un module existant.',
          features: ['Focus exclusif sur votre sprint', 'Points quotidiens 15 min', 'Tests automatisés', 'Documentation technique complète'],
          highlight: true
        }
      ]
    }
  }
};
