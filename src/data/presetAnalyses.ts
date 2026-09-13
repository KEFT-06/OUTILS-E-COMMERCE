import { MarketAnalysisReport } from '@/shared/types/analysis';

export const PRESET_ANALYSES: MarketAnalysisReport[] = [
  {
    id: 'report-notion-ai',
    query: 'Templates Notion IA & Systèmes de Gestion pour Solopreneurs',
    nicheName: 'Productivité & Systèmes IA pour Solopreneurs',
    dateCreated: 'Aujourd\'hui',
    overallVerdict: 'Opportunité Exceptionnelle',
    executiveSummary: 'Le marché des solopreneurs et indépendants connaît une explosion de la demande pour des espaces de travail prêts à l\'emploi intégrant l\'IA. Les acheteurs cherchent à réduire leur charge mentale et à automatiser leurs opérations quotidiennes. La rentabilité nette dépasse 94% avec un cycle de vente très court via Instagram Reels et TikTok.',
    rates: {
      demand: {
        key: 'demand',
        label: 'Taux de Demande Marché',
        level: 'Très élevé',
        score: 92,
        description: '+184% de requêtes cumulées sur les systèmes Notion, prompts d\'automatisation et dashboards freelance.',
        trend: 'up'
      },
      saturation: {
        key: 'saturation',
        label: 'Taux de Saturation Concurrentielle',
        level: 'Moyen',
        score: 48,
        description: 'Beaucoup de templates basiques gratuits, mais une pénurie marquée de systèmes avancés avec automatisation IA clé en main.',
        trend: 'stable',
        // Trace produite par `computeCompetitiveScore` (server/services/scoring) sur
        // des signaux de démonstration, puis figée ici. Elle n'est pas recalculée à
        // l'affichage : c'est ce qui la rend vérifiable.
        trace: {
          score: 48,
          level: 'Moyen',
          methodologyVersion: '1.0.0',
          measuredAt: '2026-09-08T09:30:00.000Z',
          sampleSize: 120,
          source: 'demonstration',
          breakdown: [
            {
              key: 'uniqueAdvertisers',
              label: 'Annonceurs uniques',
              weight: 30,
              rawValue: 34,
              highThreshold: 50,
              normalized: 51,
              contribution: 15,
              unit: '',
              explanation: '34 mesuré pour un seuil « élevé » de 50. Normalisé à 51/100, pondéré à 30 % → 15 points sur le score final.'
            },
            {
              key: 'activeAds',
              label: 'Publicités actives',
              weight: 25,
              rawValue: 120,
              highThreshold: 200,
              normalized: 45,
              contribution: 11,
              unit: '',
              explanation: '120 mesuré pour un seuil « élevé » de 200. Normalisé à 45/100, pondéré à 25 % → 11 points sur le score final.'
            },
            {
              key: 'averageLifetimeDays',
              label: 'Durée de vie moyenne',
              weight: 25,
              rawValue: 12,
              highThreshold: 21,
              normalized: 43,
              contribution: 11,
              unit: '',
              explanation: '12 mesuré pour un seuil « élevé » de 21. Normalisé à 43/100, pondéré à 25 % → 11 points sur le score final.'
            },
            {
              key: 'establishedAds',
              label: 'Publicités établies (> 14 j)',
              weight: 20,
              rawValue: 29.2,
              highThreshold: 40,
              normalized: 55,
              contribution: 11,
              unit: ' %',
              explanation: '29.2 % mesuré pour un seuil « élevé » de 40 %. Normalisé à 55/100, pondéré à 20 % → 11 points sur le score final.'
            }
          ]
        }
      },
      profitability: {
        key: 'profitability',
        label: 'Taux de Rentabilité & Marge',
        level: 'Très élevé',
        score: 96,
        description: 'Coût de revient nul après création initiale. Marge opérationnelle brute de 95% à 98% sur chaque vente.',
        trend: 'up'
      },
      opportunity: {
        key: 'opportunity',
        label: 'Taux d\'Opportunité Stratégique',
        level: 'Très élevé',
        score: 91,
        description: 'Feu vert d\'investissement : convergence idéale entre forte demande, barrière à l\'entrée technologique moyenne et prix panier de 29€ à 97€.',
        trend: 'up'
      },
      virality: {
        key: 'virality',
        label: 'Taux de Potentiel Viral / Ads',
        level: 'Élevé',
        score: 85,
        description: 'Format visuel ultra adapté aux démonstrations "avant/après" d\'écrans sur Meta Ads et Reels verticaux.',
        trend: 'up'
      }
    },
    searchTrends: [
      { keyword: 'template notion freelance', volume: '49 500 / mois', growthRate: '+142%', growthType: 'explosive', intent: 'commercial' },
      { keyword: 'notion ia automatisation', volume: '27 800 / mois', growthRate: '+215%', growthType: 'explosive', intent: 'transactional' },
      { keyword: 'dashboard gestion solopreneur', volume: '18 200 / mois', growthRate: '+78%', growthType: 'steady', intent: 'commercial' },
      { keyword: 'systeme second brain francais', volume: '12 600 / mois', growthRate: '+95%', growthType: 'steady', intent: 'informational' }
    ],
    competitors: [
      {
        id: 'comp-1',
        name: 'Easlo (Créateur Notion & Solopreneur)',
        urlOrHandle: 'https://www.easlo.co',
        priceRange: '39$ - 99$',
        positioning: 'Templates Notion minimalistes pour indépendants ($500k+ de ventes Gumroad)',
        strengths: ['Design esthétique et minimaliste reconnu', 'Grosse audience Twitter/X de 400k+ abonnés', 'Simplicité d\'utilisation'],
        weaknesses: ['Peu d\'intégrations IA automatiques', 'Manque d\'accompagnement vidéo personnalisé en français'],
        exploitableGaps: ['Créer une version francophone intégrant des prompts ChatGPT/Claude prêts à l\'emploi', 'Fournir 3 vidéos Loom d\'installation guidée en 15 minutes']
      },
      {
        id: 'comp-2',
        name: 'Thomas Frank (Ultimate Brain Notion)',
        urlOrHandle: 'https://thomasjfrank.com',
        priceRange: '97$ - 149$',
        positioning: 'Système complet de productivité et Second Brain pour professionnels',
        strengths: ['Chaîne YouTube avec millions de vues', 'Documentation technique ultra complète', 'Crédibilité maximale'],
        weaknesses: ['Prix élevé pour les débutants', 'Structure parfois dense et intimidante pour un indépendant seul'],
        exploitableGaps: ['Proposer une alternative plus légère, rapide à prendre en main et positionnée à 49€']
      },
      {
        id: 'comp-3',
        name: 'Marie Poulin (Notion Mastery)',
        urlOrHandle: 'https://notionmastery.com',
        priceRange: '99$ - 299$',
        positioning: 'Formations premium et workspaces pour consultants et agences',
        strengths: ['Expertise reconnue par Notion officiel', 'Approche pédagogique poussée'],
        weaknesses: ['Offres orientées formation longue plutôt que template clé en main instantané'],
        exploitableGaps: ['Template Plug & Play immédiat sans obligation de suivre 20 heures de cours']
      }
    ],
    digitalProducts: [
      {
        id: 'prod-1',
        title: 'Solopreneur OS 2026 : Le Cerveau IA Tout-en-Un',
        subtitle: 'L\'espace Notion complet pour piloter clients, finances, projets et création de contenu en 1 clic grâce à l\'IA.',
        type: 'template',
        typeName: 'Système Notion + Base IA',
        recommendedPrice: 49,
        currency: 'EUR',
        estimatedProductionDays: 3,
        estimatedMarginPercent: 97,
        targetAudience: 'Freelances, créateurs de contenu, consultants débordés par la dispersion d\'outils.',
        transformationPromise: 'Passez du chaos de 8 onglets ouverts à un tableau de bord unique et gagnez 6h de charge mentale par semaine.',
        tableOfContents: [
          { moduleNumber: 1, title: 'Cockpit Stratégique & KPIs Hebdomadaires', details: 'Vue synthétique du CA, pipeline commercial et priorités du jour.' },
          { moduleNumber: 2, title: 'CRM Client & Suivi Facturation', details: 'Historique des échanges, relances automatisées et modèle de devis.' },
          { moduleNumber: 3, title: 'Moteur de Contenu & Prompts IA Embarqués', details: 'Calendrier éditorial multi-plateforme avec bibliothèque de 50 prompts.' },
          { moduleNumber: 4, title: 'Centre de Connaissances & Second Brain', details: 'Notes intelligentes, ressources et fiches projets instantanées.' }
        ],
        leadMagnet: {
          title: 'Mini-Template CRM Express + 15 Prompts de Prospection',
          format: 'Lien Notion 1-Click gratuit',
          hook: 'Doublez vos réponses clients en automatisant vos emails types.'
        },
        imageUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80'
      },
      {
        id: 'prod-2',
        title: 'Guide Pratique : Automatiser son Business Solo avec l\'IA',
        subtitle: 'Le plan d\'action étape par étape pour automatiser 70% de son administratif sans savoir coder.',
        type: 'ebook',
        typeName: 'E-Book Stratégique & Worksheets',
        recommendedPrice: 27,
        currency: 'EUR',
        estimatedProductionDays: 2,
        estimatedMarginPercent: 98,
        targetAudience: 'Indépendants et prestataires de services désireux de déléguer à l\'IA.',
        transformationPromise: 'Mettre en place 4 automatisations concrètes dès ce week-end pour libérer 1 journée complète par semaine.',
        tableOfContents: [
          { moduleNumber: 1, title: 'L\'Audit du Temps Perdu : Identifier vos 3 goulots d\'étranglement', details: 'Méthode d\'analyse 80/20 de votre emploi du temps.' },
          { moduleNumber: 2, title: 'La Stack IA Gratuite : Les 3 outils indispensables', details: 'Configuration pas à pas de Make, ChatGPT et Notion.' },
          { moduleNumber: 3, title: 'Les 5 Workflows Rentables Clés en Main', details: 'Tri des leads, génération de propositions commerciales, synthèses de réunions.' },
          { moduleNumber: 4, title: 'Sécurité, Confidentialité & Pérennité', details: 'Protéger les données sensibles de vos clients.' }
        ],
        leadMagnet: {
          title: 'La Checklist des 12 Tâches Chronophages à Déléguer à l\'IA',
          format: 'PDF synthétique 3 pages',
          hook: 'Identifiez exactement où s\'évaporent vos heures de travail.'
        },
        imageUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80'
      },
      {
        id: 'prod-3',
        title: 'Pack Ultime : Système Solopreneur OS + Masterclass Vidéo 2h',
        subtitle: 'L\'accès complet au template Notion, aux workflows d\'automatisation et à 10 vidéos explicatives.',
        type: 'bundle',
        typeName: 'Bundle Premium + Masterclass',
        recommendedPrice: 97,
        currency: 'EUR',
        estimatedProductionDays: 5,
        estimatedMarginPercent: 95,
        targetAudience: 'Solopreneurs prêts à investir pour structurer durablement leur croissance.',
        transformationPromise: 'Un système d\'exploitation d\'entreprise clé en main opérationnel en moins d\'un après-midi.',
        tableOfContents: [
          { moduleNumber: 1, title: 'Template Notion Solopreneur OS Version Illimitée', details: 'Comprend toutes les mises à jour à vie et bases relationnelles.' },
          { moduleNumber: 2, title: 'Masterclass Vidéo : Duplicater & Personnaliser en 25 min', details: 'Vidéo HD étape par étape sans jargon technique.' },
          { moduleNumber: 3, title: 'Bibliothèque de 100 Prompts IA Business Validés', details: 'Catégorisés par cas d\'usage : closing, copywriting, stratégie.' },
          { moduleNumber: 4, title: 'Accès au canal privé de questions/réponses', details: 'Réponses écrites garanties sous 48h pendant 30 jours.' }
        ],
        leadMagnet: {
          title: 'Accès Masterclass Vidéo : "L\'Architecture d\'un Business Solo à 10K€/mois"',
          format: 'Webinar vidéo privé de 18 minutes',
          hook: 'Découvrez l\'envers du décor d\'un système qui tourne sans friction.'
        },
        imageUrl: 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=1200&q=80'
      }
    ],
    adCampaigns: [
      {
        id: 'ad-aida-1',
        framework: 'AIDA',
        frameworkFullName: 'Attention — Intérêt — Désir — Action',
        targetProductTitle: 'Solopreneur OS 2026',
        hookHeadline: 'Arrêtez d\'ouvrir 12 onglets chaque matin pour gérer vos clients.',
        metaPrimaryText: 'Vous passez plus de temps à chercher vos fichiers qu\'à facturer ? 🤯\n\nDécouvrez le système tout-en-un sous Notion spécialement pensé pour les solopreneurs qui veulent se concentrer sur l\'essentiel.\n\n✅ Cockpit centralisé : clients, projets, trésorerie et to-do du jour\n✅ Intégration IA pour générer vos devis et e-mails en 30 secondes\n✅ Prêt à l\'emploi : dupliquez en 1 clic, sans compétences techniques\n\nRejoignez plus de 1 200 indépendants qui ont simplifié leur quotidien.',
        metaHeadline: 'Solopreneur OS : Votre business complet sur un écran',
        callToAction: 'Télécharger maintenant',
        aspectRatio: '9:16',
        durationSeconds: 18,
        scenes: [
          {
            sceneNumber: 1,
            timing: '0:00 - 0:03',
            phase: 'Attention',
            visualDescription: 'Plan serré sur un écran encombré avec 25 onglets ouverts et une personne qui soupire, zoom rapide.',
            onScreenText: 'POV : Ton business freelance ressemble à ça 🤯',
            spokenVoiceover: 'Si chaque matin tu ouvres 20 onglets différents sans savoir par quoi commencer...',
            soundAndVibe: 'Effet sonore de pop-up d\'alerte + beat lo-fi dynamique qui démarre.'
          },
          {
            sceneNumber: 2,
            timing: '0:03 - 0:08',
            phase: 'Intérêt',
            visualDescription: 'Transition fluide par swipe : l\'écran devient instantanément un dashboard Notion propre et épuré avec mode sombre.',
            onScreenText: 'Et si TOUT était réuni au même endroit ? ✨',
            spokenVoiceover: 'Regarde ça : tes clients, tes devis, tes projets et ton calendrier en un seul coup d\'œil.',
            soundAndVibe: 'Swoosh propre, musique entraînante et chaleureuse.'
          },
          {
            sceneNumber: 3,
            timing: '0:08 - 0:14',
            phase: 'Désir',
            visualDescription: 'Démonstration en temps réel : un clic sur un bouton génère un email de relance client grâce à l\'IA intégrée.',
            onScreenText: 'Gagne 6 heures par semaine dès aujourd\'hui ⚡️',
            spokenVoiceover: 'Grâce à l\'IA intégrée, tu rédiges tes propositions et tu suis ta trésorerie sans effort.',
            soundAndVibe: 'Bruit de typing clavier agréable et satisfaction visuelle.'
          },
          {
            sceneNumber: 4,
            timing: '0:14 - 0:18',
            phase: 'Action',
            visualDescription: 'Affichage de la page de commande sur mobile avec le bouton de téléchargement immédiat et garantie 30 jours.',
            onScreenText: 'Offre Spéciale Lancement (-50%) 👇',
            spokenVoiceover: 'Clique sur le lien sous la vidéo pour dupliquer ton espace en 1 clic.',
            soundAndVibe: 'Cloche de notification positive, fin du beat musical.'
          }
        ],
        complianceCheck: [
          { rule: 'Pas d\'allégations de gains financiers garantis', compliant: true, explanation: 'Met l\'accent sur le gain de temps et l\'organisation, sans fausse promesse de richesse.' },
          { rule: 'Texte lisible en mode son coupé (Sound-off friendly)', compliant: true, explanation: 'Tous les hooks et messages clés disposent de titrages à fort contraste.' },
          { rule: 'Respect des marges de sécurité 9:16 (Safe zones)', compliant: true, explanation: 'Textes centrés entre 15% et 80% de la hauteur de l\'écran pour éviter l\'interface Reels.' },
          { rule: 'Pas d\'attributs personnels discriminatoires', compliant: true, explanation: 'Cible des situations de travail professionnelles objectives.' }
        ],
        metaTargeting: {
          interests: ['Notion (logiciel)', 'Travailleur indépendant', 'Productivité', 'Entrepreneuriat'],
          demographics: 'Hommes et Femmes, 24 - 45 ans, France / Belgique / Suisse / Canada',
          placements: ['Instagram Reels', 'Facebook Feed Mobile', 'Instagram Stories']
        }
      },
      {
        id: 'ad-pas-1',
        framework: 'PAS',
        frameworkFullName: 'Problème — Agitation — Solution',
        targetProductTitle: 'Solopreneur OS 2026',
        hookHeadline: 'Le plus gros danger quand on est freelance ? Se noyer dans l\'administratif.',
        metaPrimaryText: 'Factures oubliées, relances clients en retard, notes dispersées dans 4 carnets... 📉\n\nQuand votre système est bancal, c\'est votre chiffre d\'affaires qui en pâtit directement.\n\nVoici comment reprendre le contrôle de votre activité dès ce soir sans passer des semaines à tout configurer.',
        metaHeadline: 'Le système d\'organisation qui fait gagner 1 jour par semaine',
        callToAction: 'En savoir plus',
        aspectRatio: '9:16',
        durationSeconds: 19,
        scenes: [
          {
            sceneNumber: 1,
            timing: '0:00 - 0:04',
            phase: 'Problème',
            visualDescription: 'Plan face caméra d\'un créateur parlant franchement avec sous-titres animés au centre.',
            onScreenText: 'Tu perds des clients parce que ton organisation est chaotique ? 📉',
            spokenVoiceover: 'Soyons honnêtes : le problème numéro un des freelances, ce n\'est pas le manque de compétences, c\'est le bordel dans leur organisation.',
            soundAndVibe: 'Tension légère en fond sonore, voix claire et rythmée.'
          },
          {
            sceneNumber: 2,
            timing: '0:04 - 0:10',
            phase: 'Agitation',
            visualDescription: 'Graphique stylisé animé montrant du temps perdu et un tableau Excel rouge avec des cases vides.',
            onScreenText: 'Chaque heure passée à chercher un doc = de l\'argent perdu 💸',
            spokenVoiceover: 'Une facture non relancée, un brief client égaré... Et au final, tu travailles 50 heures par semaine en te sentant débordé.',
            soundAndVibe: 'Effet sonore de papier froissé, basse sourde.'
          },
          {
            sceneNumber: 3,
            timing: '0:10 - 0:16',
            phase: 'Solution',
            visualDescription: 'Capture vidéo de l\'espace Notion avec navigation rapide entre le CRM, les projets et les automatisations.',
            onScreenText: 'La Solution : Solopreneur OS ⚡️ Tout est automatique.',
            spokenVoiceover: 'C\'est exactement pour ça qu\'on a créé Solopreneur OS. Un système pré-construit où chaque tâche, chaque client et chaque euro est à sa place.',
            soundAndVibe: 'Beat résolu et inspirant, effet d\'accomplissement.'
          },
          {
            sceneNumber: 4,
            timing: '0:16 - 0:19',
            phase: 'Action',
            visualDescription: 'Animation du smartphone montrant la duplication instantanée et le CTA animé.',
            onScreenText: 'Duplique-le en 1 clic 👇 Offre limitée',
            spokenVoiceover: 'Télécharge-le maintenant et commence à organiser ton activité dès aujourd\'hui.',
            soundAndVibe: 'Ding de confirmation.'
          }
        ],
        complianceCheck: [
          { rule: 'Conformité aux règles de transparence des offres', compliant: true, explanation: 'Prix et conditions clairs, pas de période d\'essai piégée.' },
          { rule: 'Absence de techniques de peur exagérées', compliant: true, explanation: 'Met l\'accent sur une saine gestion d\'entreprise.' },
          { rule: 'Format natif vidéo 9:16 respecté', compliant: true, explanation: 'Conforme aux standards de distribution publicitaire Meta Ads.' }
        ],
        metaTargeting: {
          interests: ['Micro-entrepreneur', 'Gestion du temps', 'Télétravail', 'Logiciel en tant que service'],
          demographics: '22 - 50 ans, francophone',
          placements: ['Instagram Reels', 'Facebook Reels']
        }
      }
    ],
    illustrativeImages: [
      {
        title: 'Interface Notion Solopreneur OS',
        url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
        caption: 'Tableau de bord centralisé regroupant KPIs financiers, pipeline de projets et calendrier éditorial.'
      },
      {
        title: 'Espace de Travail Minimaliste & Productif',
        url: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80',
        caption: 'Environnement de travail serein optimisé pour le travail asynchrone et la réduction de la charge mentale.'
      },
      {
        title: 'Visualisation de Données & Métriques Clés',
        url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80',
        caption: 'Graphiques de performance commerciale et suivi de trésorerie en temps réel.'
      }
    ],
    strategicActionPlan: [
      {
        phase: 'Phase 1 : Lancement Lead Magnet (Jours 1 à 3)',
        title: 'Capture de prospects qualifiés',
        steps: [
          'Publier le mini-template CRM gratuit sur Gumroad / Lemon Squeezy.',
          'Diffuser 2 Reels organiques et lancer la campagne Meta Ads AIDA à 10€/jour.',
          'Mettre en place la séquence email de bienvenue en 3 étapes.'
        ]
      },
      {
        phase: 'Phase 2 : Vente Principale (Jours 4 à 10)',
        title: 'Conversion vers le produit à 49€',
        steps: [
          'Proposer le Solopreneur OS à 49€ dès la page de confirmation du Lead Magnet (Order Bump).',
          'Activer la campagne Meta Ads de retargeting avec le framework PAS.',
          'Récolter les 5 premiers avis clients certifiés.'
        ]
      },
      {
        phase: 'Phase 3 : Montée en gamme & Bundle (Jours 11 à 30)',
        title: 'Maximisation de la valeur vie client',
        steps: [
          'Lancer le Bundle Masterclass à 97€ pour les acheteurs du produit initial.',
          'Optimiser les créatives publicitaires en testant de nouveaux hooks vidéo 0-3s.'
        ]
      }
    ],
    // Provenance affichée sous chaque graphique (feuille de route, 2.6).
    // Ce rapport est un jeu de démonstration : le dire explicitement est la
    // seule façon d'éviter qu'il soit lu comme une mesure de marché.
    dataProvenance: {
      rates: {
        source: 'Jeu de démonstration Smart Creator',
        collectedAt: '2026-09-08T09:30:00.000Z',
        sampleSize: 120,
        sampleUnit: 'publicités',
        isDemonstration: true
      },
      searchTrends: {
        source: 'Jeu de démonstration Smart Creator',
        collectedAt: '2026-09-08T09:30:00.000Z',
        sampleSize: 4,
        sampleUnit: 'requêtes suivies',
        isDemonstration: true
      },
      adCampaigns: {
        source: 'Jeu de démonstration Smart Creator',
        collectedAt: '2026-09-08T09:30:00.000Z',
        sampleSize: 2,
        sampleUnit: 'campagnes',
        isDemonstration: true
      }
    }
  },
  {
    id: 'report-nutrition-anti-inflammatoire',
    query: 'Guide & Recettes Nutrition Anti-Inflammatoire & Énergie',
    nicheName: 'Santé Holistique & Nutrition Anti-Inflammatoire',
    dateCreated: 'Aujourd\'hui',
    overallVerdict: 'Opportunité Forte',
    executiveSummary: 'Une tendance de fond portée par la prise de conscience des troubles digestifs, de la fatigue chronique et du bien-être global. Très fort engagement communautaire, panier moyen accessible (19€ à 39€) avec une fidélité élevée et un taux de recommandation naturel sur les réseaux sociaux.',
    rates: {
      demand: {
        key: 'demand',
        label: 'Taux de Demande Marché',
        level: 'Très élevé',
        score: 95,
        description: '+210% d\'intérêt sur Google Trends et Pinterest pour l\'alimentation anti-inflammatoire et les menus prêts à cuisiner.',
        trend: 'up'
      },
      saturation: {
        key: 'saturation',
        label: 'Taux de Saturation Concurrentielle',
        level: 'Élevé',
        score: 68,
        description: 'Nombreux blogs et comptes Instagram, mais rareté des programmes structurés avec listes de courses exactes et batch cooking.',
        trend: 'up',
        trace: {
          score: 68,
          level: 'Élevé',
          methodologyVersion: '1.0.0',
          measuredAt: '2026-09-10T07:15:00.000Z',
          sampleSize: 240,
          source: 'demonstration',
          breakdown: [
            {
              key: 'uniqueAdvertisers',
              label: 'Annonceurs uniques',
              weight: 30,
              rawValue: 62,
              highThreshold: 50,
              normalized: 81,
              contribution: 24,
              unit: '',
              explanation: '62 mesuré pour un seuil « élevé » de 50. Normalisé à 81/100, pondéré à 30 % → 24 points sur le score final.'
            },
            {
              key: 'activeAds',
              label: 'Publicités actives',
              weight: 25,
              rawValue: 240,
              highThreshold: 200,
              normalized: 80,
              contribution: 20,
              unit: '',
              explanation: '240 mesuré pour un seuil « élevé » de 200. Normalisé à 80/100, pondéré à 25 % → 20 points sur le score final.'
            },
            {
              key: 'averageLifetimeDays',
              label: 'Durée de vie moyenne',
              weight: 25,
              rawValue: 16,
              highThreshold: 21,
              normalized: 57,
              contribution: 14,
              unit: '',
              explanation: '16 mesuré pour un seuil « élevé » de 21. Normalisé à 57/100, pondéré à 25 % → 14 points sur le score final.'
            },
            {
              key: 'establishedAds',
              label: 'Publicités établies (> 14 j)',
              weight: 20,
              rawValue: 26.7,
              highThreshold: 40,
              normalized: 50,
              contribution: 10,
              unit: ' %',
              explanation: '26.7 % mesuré pour un seuil « élevé » de 40 %. Normalisé à 50/100, pondéré à 20 % → 10 points sur le score final.'
            }
          ]
        }
      },
      profitability: {
        key: 'profitability',
        label: 'Taux de Rentabilité & Marge',
        level: 'Très élevé',
        score: 97,
        description: 'Livraison 100% numérique (PDF interactif + application mobile de recettes). Marge nette exceptionnelle.',
        trend: 'up'
      },
      opportunity: {
        key: 'opportunity',
        label: 'Taux d\'Opportunité Stratégique',
        level: 'Élevé',
        score: 84,
        description: 'Opportunité forte sous réserve de créer un angle différenciant (ex: 20 minutes chrono, budget serré, sans ingrédients rares).',
        trend: 'up'
      },
      virality: {
        key: 'virality',
        label: 'Taux de Potentiel Viral / Ads',
        level: 'Très élevé',
        score: 94,
        description: 'Photos culinaires très appétissantes, avant/après énergie, recettes simples en vidéo courte sur TikTok et Reels.',
        trend: 'up'
      }
    },
    searchTrends: [
      { keyword: 'menu anti inflammatoire semaine', volume: '60 500 / mois', growthRate: '+175%', growthType: 'explosive', intent: 'commercial' },
      { keyword: 'liste aliments anti inflammatoires pdf', volume: '33 100 / mois', growthRate: '+110%', growthType: 'steady', intent: 'transactional' },
      { keyword: 'recette diner anti inflammatoire facile', volume: '22 400 / mois', growthRate: '+190%', growthType: 'explosive', intent: 'informational' }
    ],
    competitors: [
      {
        id: 'comp-nutri-1',
        name: 'Jessie Inchauspé (Glucose Goddess)',
        urlOrHandle: 'https://www.glucosegoddess.com',
        priceRange: '25€ - 39€',
        positioning: 'Méthodes de régulation de la glycémie et vulgarisation scientifique (4M+ abonnés)',
        strengths: ['Graphiques visuels avant/après percutants', 'Preuve scientifique solide', 'Communauté mondiale active'],
        weaknesses: ['Livres physiques généralistes plutôt que plannings hebdomadaires prêts à l\'emploi avec liste de courses'],
        exploitableGaps: ['Proposer un protocole 100% digital avec fiches courses supermarché et recettes en moins de 15 minutes']
      },
      {
        id: 'comp-nutri-2',
        name: 'Dr. William Li (Eat to Beat Disease)',
        urlOrHandle: 'https://drwilliamli.com',
        priceRange: '35€ - 97€',
        positioning: 'Protocoles nutritionnels médicaux pour l\'immunité et l\'anti-inflammation',
        strengths: ['Autorité médicale incontestable', 'Recherches cliniques approfondies'],
        weaknesses: ['Approche très académique, parfois complexe pour un néophyte en cuisine'],
        exploitableGaps: ['Vulgarisation ultra-visuelle et menus prêts à cuisiner pour personnes débordées']
      }
    ],
    digitalProducts: [
      {
        id: 'prod-nutri-1',
        title: 'Le Protocole 28 Jours Anti-Inflammatoire Express',
        subtitle: '4 semaines de menus gourmands, listes de courses automatiques et recettes en moins de 20 minutes.',
        type: 'ebook',
        typeName: 'Guide Interactif + Plannings PDF',
        recommendedPrice: 34,
        currency: 'EUR',
        estimatedProductionDays: 4,
        estimatedMarginPercent: 98,
        targetAudience: 'Femmes et hommes 30-55 ans souffrant de fatigue, ballonnements ou douleurs articulaires.',
        transformationPromise: 'Retrouver son énergie et un ventre plat sans régime restrictif ni frustration culinaire.',
        tableOfContents: [
          { moduleNumber: 1, title: 'Comprendre l\'Inflammation Silencieuse', details: 'Guide vulgarisé et bienveillant des mécanismes du corps.' },
          { moduleNumber: 2, title: 'Le Placard Idéal & La Liste des Substituts Simples', details: 'Remplacer sans perdre le goût avec des produits trouvables partout.' },
          { moduleNumber: 3, title: 'Les 28 Jours de Menus & Recettes Détaillées', details: 'Petit-déjeuner, déjeuner, collation et dîner avec macros équilibrées.' },
          { moduleNumber: 4, title: 'Guide du Batch Cooking du Dimanche en 1h', details: 'Préparer sa semaine sereinement sans passer ses soirées en cuisine.' }
        ],
        leadMagnet: {
          title: 'Le Guide des 7 Épices & Aliments Anti-Inflammatoires Quotidiens',
          format: 'Fiche aide-mémoire PDF 1 page pour frigo',
          hook: 'La liste simple à aimanter sur votre réfrigérateur.'
        },
        imageUrl: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=1200&q=80'
      }
    ],
    adCampaigns: [
      {
        id: 'ad-nutri-pas',
        framework: 'PAS',
        frameworkFullName: 'Problème — Agitation — Solution',
        targetProductTitle: 'Le Protocole 28 Jours Anti-Inflammatoire',
        hookHeadline: 'Tu te réveilles déjà fatigué(e) avec le ventre gonflé ?',
        metaPrimaryText: 'Ballonnements constants après chaque repas, coup de barre de 14h, douleurs diffuses... 😔\n\nCe n\'est pas "l\'âge" ou "la fatigue normale". C\'est souvent le signal d\'une inflammation digestive chronique.\n\nLa bonne nouvelle ? Nul besoin de suivre un régime draconien ou de boire du jus de céleri amer tous les matins.\n\nDécouvrez comment 28 jours de repas gourmands, simples et cuisinés en 20 minutes peuvent transformer votre énergie.',
        metaHeadline: 'Le Protocole Anti-Inflammatoire 28 Jours',
        callToAction: 'Télécharger le Guide',
        aspectRatio: '9:16',
        durationSeconds: 19,
        scenes: [
          {
            sceneNumber: 1,
            timing: '0:00 - 0:04',
            phase: 'Problème',
            visualDescription: 'Une personne qui se lève le matin en se frottant les yeux, l\'air épuisée, puis regarde son ventre ballonné devant le miroir.',
            onScreenText: 'Fatigue au réveil ? Ventre ballonné à 14h ? 🛑',
            spokenVoiceover: 'Si tu te réveilles fatigué et que ton ventre gonfle dès que tu manges, ce n\'est pas dans ta tête.',
            soundAndVibe: 'Tonalité intime, son doux et attentif.'
          },
          {
            sceneNumber: 2,
            timing: '0:04 - 0:09',
            phase: 'Agitation',
            visualDescription: 'Coupe rapide sur un chariot de supermarché plein de produits ultra-transformés et un sentiment de désarroi.',
            onScreenText: 'L\'erreur : Tester des régimes drastiques qui frustrent ❌',
            spokenVoiceover: 'Le piège, c\'est d\'essayer des régimes ultra-privatifs qu\'on abandonne au bout de quatre jours.',
            soundAndVibe: 'Effet sonore de buzzer discret.'
          },
          {
            sceneNumber: 3,
            timing: '0:09 - 0:15',
            phase: 'Solution',
            visualDescription: 'Plans magnifiques de plats chauds, colorés, saumon croustillant, légumes rôtis au curcuma, assiette gourmande.',
            onScreenText: 'La Solution : Des repas gourmands en 20 min chrono 🥑',
            spokenVoiceover: 'Avec le Protocole 28 Jours, tu découvres des recettes saines, hyper savoureuses et prêtes en 20 minutes.',
            soundAndVibe: 'Musique réconfortante et lumineuse.'
          },
          {
            sceneNumber: 4,
            timing: '0:15 - 0:19',
            phase: 'Action',
            visualDescription: 'Mockup 3D du livre numérique sur tablette et smartphone avec les fiches de courses.',
            onScreenText: 'Téléchargement instantané (-40% aujourd\'hui) 👇',
            spokenVoiceover: 'Télécharge ton guide dès maintenant et retrouve ta vitalité.',
            soundAndVibe: 'Bouton animé et carillon positif.'
          }
        ],
        complianceCheck: [
          { rule: 'Conformité aux règles Santé & Bien-être Meta Ads', compliant: true, explanation: 'Aucune promesse de guérison médicale ou de perte de poids en X jours.' },
          { rule: 'Pas de photos avant/après corporelles extrêmes', compliant: true, explanation: 'Respecte scrupuleusement l\'interdiction Meta des gros plans sur le corps.' },
          { rule: 'Positionnement bienveillant et positif', compliant: true, explanation: 'Encourage des habitudes saines sans culpabilisation.' }
        ],
        metaTargeting: {
          interests: ['Alimentation saine', 'Recette de cuisine', 'Bien-être', 'Cuisine rapide'],
          demographics: 'Femmes et Hommes 28-60 ans',
          placements: ['Instagram Feed & Reels', 'Facebook Feed']
        }
      }
    ],
    illustrativeImages: [
      {
        title: 'Assiette Santé Anti-Inflammatoire',
        url: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=1200&q=80',
        caption: 'Composition équilibrée riche en antioxydants, oméga-3 et légumes de saison.'
      },
      {
        title: 'Ingrédients Bruts & Épices Bienfaisantes',
        url: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=1200&q=80',
        caption: 'Curcuma, gingembre, baies et graines favorisant la réduction de l\'inflammation.'
      }
    ],
    strategicActionPlan: [
      {
        phase: 'Phase 1 : Contenu Visuel & Lead Magnet',
        title: 'Acquisition de contacts ciblés',
        steps: ['Diffuser des vidéos courtes de recettes en 30 secondes', 'Offrir la fiche des 7 épices en échange de l\'adresse email']
      },
      {
        phase: 'Phase 2 : Vente du Guide 28 Jours',
        title: 'Conversion à 34€',
        steps: ['Proposer le guide à prix spécial de lancement pendant 72 heures', 'Ajouter un bonus exclusif : le carnet de desserts sans sucre raffiné']
      }
    ],
    dataProvenance: {
      rates: {
        source: 'Jeu de démonstration Smart Creator',
        collectedAt: '2026-09-10T07:15:00.000Z',
        sampleSize: 240,
        sampleUnit: 'publicités',
        isDemonstration: true
      },
      searchTrends: {
        source: 'Jeu de démonstration Smart Creator',
        collectedAt: '2026-09-10T07:15:00.000Z',
        sampleSize: 3,
        sampleUnit: 'requêtes suivies',
        isDemonstration: true
      },
      adCampaigns: {
        source: 'Jeu de démonstration Smart Creator',
        collectedAt: '2026-09-10T07:15:00.000Z',
        sampleSize: 1,
        sampleUnit: 'campagne',
        isDemonstration: true
      }
    }
  }
];
