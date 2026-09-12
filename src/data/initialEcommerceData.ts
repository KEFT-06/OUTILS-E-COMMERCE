import { Product, Order, Customer, Coupon, StoreSettings } from '../types/ecommerce';

export const INITIAL_SETTINGS: StoreSettings = {
  storeName: 'Atelier Marchand',
  currency: 'EUR',
  currencySymbol: '€',
  freeShippingThreshold: 65,
  standardShippingFee: 4.90,
  expressShippingFee: 9.90,
  taxRate: 0.20,
  emailNotification: true,
};

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod-1',
    name: 'Casque Audio Sans Fil "Aura Pure"',
    description: 'Casque circum-aural haute fidélité avec réduction active du bruit (ANC) hybride, coussinets en cuir végétal et autonomie record de 42 heures.',
    price: 189.00,
    compareAtPrice: 229.00,
    costPrice: 62.00,
    sku: 'AUDIO-AUR-01',
    category: 'High-Tech & Son',
    images: [
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800&auto=format&fit=crop&q=80'
    ],
    stock: 18,
    lowStockThreshold: 5,
    status: 'active',
    tags: ['Best-seller', 'Réduction de bruit', 'Hi-Res'],
    rating: 4.9,
    reviewsCount: 84,
    featured: true,
    variants: [
      { name: 'Couleur', options: ['Noir Minéral', 'Gris Titane', 'Sable Doré'] }
    ]
  },
  {
    id: 'prod-2',
    name: 'Sac Weekend en Cuir Tanné Végétal',
    description: 'Confectionné artisanalement dans un cuir pleine fleur certifié. Compartiment chaussures étanche, bandoulière matelassée et finitions laiton brossé.',
    price: 249.00,
    compareAtPrice: 290.00,
    costPrice: 85.00,
    sku: 'MAROQ-WKD-02',
    category: 'Maroquinerie & Voyage',
    images: [
      'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800&auto=format&fit=crop&q=80'
    ],
    stock: 7,
    lowStockThreshold: 4,
    status: 'active',
    tags: ['Artisanal', 'Cuir Véritable'],
    rating: 4.8,
    reviewsCount: 42,
    featured: true,
    variants: [
      { name: 'Teinte', options: ['Cognac Sauvage', 'Châtaigne Foncé', 'Noir Onyx'] }
    ]
  },
  {
    id: 'prod-3',
    name: 'Lampe de Table Minimaliste "Lumina"',
    description: 'Lampe d’ambiance en céramique striée et diffuseur en verre opalin satiné. Éclairage LED dimmable tactile 3 intensités (lumière chaude 2700K).',
    price: 89.00,
    costPrice: 28.00,
    sku: 'DECO-LUM-03',
    category: 'Maison & Décoration',
    images: [
      'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&auto=format&fit=crop&q=80'
    ],
    stock: 3, // Low stock trigger!
    lowStockThreshold: 5,
    status: 'active',
    tags: ['Design', 'LED Chaude', 'Céramique'],
    rating: 4.7,
    reviewsCount: 31,
    featured: true,
  },
  {
    id: 'prod-4',
    name: 'Montre Automatique Édition Chrono',
    description: 'Boîtier en acier inoxydable 316L de 40mm, verre saphir inrayable anti-reflet, mouvement mécanique automatique réserve de marche 48h.',
    price: 340.00,
    compareAtPrice: 395.00,
    costPrice: 110.00,
    sku: 'HORL-AUTO-04',
    category: 'Horlogerie & Accessoires',
    images: [
      'https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=800&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=800&auto=format&fit=crop&q=80'
    ],
    stock: 12,
    lowStockThreshold: 3,
    status: 'active',
    tags: ['Automatique', 'Saphir', 'Luxe'],
    rating: 5.0,
    reviewsCount: 67,
    featured: true,
    variants: [
      { name: 'Cadran', options: ['Bleu Nuit', 'Noir Anthracite', 'Blanc Craie'] }
    ]
  },
  {
    id: 'prod-5',
    name: 'Sérum Botanique Éclat & Anti-Oxydant',
    description: 'Complexe puissant d’huile de figue de barbarie bio, vitamine C stabilisée et acide hyaluronique végétal. Fabriqué en Provence, flacon pipette 30ml.',
    price: 46.00,
    costPrice: 9.50,
    sku: 'BEAUTE-SRM-05',
    category: 'Soins & Bien-être',
    images: [
      'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&auto=format&fit=crop&q=80'
    ],
    stock: 34,
    lowStockThreshold: 10,
    status: 'active',
    tags: ['Bio', 'Made in France', 'Vegan'],
    rating: 4.9,
    reviewsCount: 112,
  },
  {
    id: 'prod-6',
    name: 'Cafetière Manuelle à Piston en Inox & Noyer',
    description: 'Presse française isolée à double paroi pour maintenir le café chaud pendant 2 heures sans amertume. Poignée ergonomique en noyer massif certifié FSC.',
    price: 64.00,
    costPrice: 19.00,
    sku: 'CAFE-PRS-06',
    category: 'Maison & Décoration',
    images: [
      'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=800&auto=format&fit=crop&q=80'
    ],
    stock: 22,
    lowStockThreshold: 6,
    status: 'active',
    tags: ['Café d’exception', 'Inox'],
    rating: 4.6,
    reviewsCount: 29,
  },
  {
    id: 'prod-7',
    name: 'Sweat à Capuche Coton Lourd 450g',
    description: 'Tricoté en molleton de coton biologique non brossé très dense. Coupe décontractée intemporelle, teint en pièce à Porto.',
    price: 95.00,
    costPrice: 26.00,
    sku: 'MOD-SWT-07',
    category: 'Mode & Vêtements',
    images: [
      'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&auto=format&fit=crop&q=80'
    ],
    stock: 2, // Low stock!
    lowStockThreshold: 5,
    status: 'active',
    tags: ['Coton Bio', 'Heavyweight'],
    rating: 4.8,
    reviewsCount: 53,
    variants: [
      { name: 'Taille', options: ['S', 'M', 'L', 'XL'] },
      { name: 'Couleur', options: ['Vert Forêt', 'Gris Chiné', 'Noir Profond'] }
    ]
  },
  {
    id: 'prod-8',
    name: 'Bougie Parfumée Cire de Soja "Bois de Cèdre"',
    description: 'Coulée à la main avec mèche en bois de cerisier crépitante. Pyramide olfactive : aiguilles de pin, ambre chaud et bois de cèdre fumé. 55 heures de combustion.',
    price: 34.00,
    costPrice: 7.20,
    sku: 'DECO-BG-08',
    category: 'Maison & Décoration',
    images: [
      'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=800&auto=format&fit=crop&q=80'
    ],
    stock: 45,
    lowStockThreshold: 8,
    status: 'active',
    tags: ['Artisanal', 'Cire Végétale'],
    rating: 4.9,
    reviewsCount: 78,
  }
];

export const INITIAL_ORDERS: Order[] = [
  {
    id: 'ord-1042',
    orderNumber: 'CMD-2026-1042',
    createdAt: '2026-09-11T14:32:00Z',
    customer: {
      name: 'Claire Dumont',
      email: 'claire.dumont@gmail.com',
      phone: '06 23 45 67 89',
      address: '14 rue de Rivoli',
      city: 'Paris',
      zipCode: '75004',
      country: 'France'
    },
    items: [
      {
        productId: 'prod-1',
        productName: 'Casque Audio Sans Fil "Aura Pure"',
        price: 189.00,
        costPrice: 62.00,
        quantity: 1,
        variant: 'Noir Minéral',
        image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80'
      }
    ],
    subtotal: 189.00,
    discount: 18.90,
    couponCode: 'BIENVENUE10',
    shippingFee: 0,
    tax: 34.02,
    total: 170.10,
    status: 'processing',
    paymentMethod: 'apple_pay',
    shippingMethod: 'Colissimo Domicile (48h)',
    trackingNumber: '6A184920394FR'
  },
  {
    id: 'ord-1041',
    orderNumber: 'CMD-2026-1041',
    createdAt: '2026-09-10T18:15:00Z',
    customer: {
      name: 'Marc Lefebvre',
      email: 'm.lefebvre@outlook.fr',
      phone: '06 87 65 43 21',
      address: '8 boulevard de la Liberté',
      city: 'Lille',
      zipCode: '59000',
      country: 'France'
    },
    items: [
      {
        productId: 'prod-2',
        productName: 'Sac Weekend en Cuir Tanné Végétal',
        price: 249.00,
        costPrice: 85.00,
        quantity: 1,
        variant: 'Cognac Sauvage',
        image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&auto=format&fit=crop&q=80'
      },
      {
        productId: 'prod-8',
        productName: 'Bougie Parfumée Cire de Soja',
        price: 34.00,
        costPrice: 7.20,
        quantity: 1,
        image: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=800&auto=format&fit=crop&q=80'
      }
    ],
    subtotal: 283.00,
    discount: 0,
    shippingFee: 0,
    tax: 56.60,
    total: 283.00,
    status: 'shipped',
    paymentMethod: 'credit_card',
    shippingMethod: 'DHL Express (24h)',
    trackingNumber: 'DHL928401928'
  },
  {
    id: 'ord-1040',
    orderNumber: 'CMD-2026-1040',
    createdAt: '2026-09-09T09:44:00Z',
    customer: {
      name: 'Sophie Bertrand',
      email: 'sophie.b@gmail.com',
      phone: '07 12 34 56 78',
      address: '27 allée des Érables',
      city: 'Lyon',
      zipCode: '69006',
      country: 'France'
    },
    items: [
      {
        productId: 'prod-5',
        productName: 'Sérum Botanique Éclat',
        price: 46.00,
        costPrice: 9.50,
        quantity: 2,
        image: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&auto=format&fit=crop&q=80'
      }
    ],
    subtotal: 92.00,
    discount: 0,
    shippingFee: 0,
    tax: 18.40,
    total: 92.00,
    status: 'delivered',
    paymentMethod: 'paypal',
    shippingMethod: 'Mondial Relay Point Relais',
    trackingNumber: 'MR81739210'
  },
  {
    id: 'ord-1039',
    orderNumber: 'CMD-2026-1039',
    createdAt: '2026-09-08T11:20:00Z',
    customer: {
      name: 'Guillaume Vasseur',
      email: 'guillaume.v@protonmail.com',
      phone: '06 44 55 66 77',
      address: '3 place de la Bourse',
      city: 'Bordeaux',
      zipCode: '33000',
      country: 'France'
    },
    items: [
      {
        productId: 'prod-4',
        productName: 'Montre Automatique Édition Chrono',
        price: 340.00,
        costPrice: 110.00,
        quantity: 1,
        variant: 'Cadran Bleu Nuit',
        image: 'https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=800&auto=format&fit=crop&q=80'
      }
    ],
    subtotal: 340.00,
    discount: 34.00,
    couponCode: 'BIENVENUE10',
    shippingFee: 0,
    tax: 61.20,
    total: 306.00,
    status: 'delivered',
    paymentMethod: 'credit_card',
    shippingMethod: 'Colissimo Recommandé'
  }
];

export const INITIAL_CUSTOMERS: Customer[] = [
  {
    id: 'cust-1',
    name: 'Claire Dumont',
    email: 'claire.dumont@gmail.com',
    phone: '06 23 45 67 89',
    city: 'Paris',
    ordersCount: 3,
    totalSpent: 485.10,
    lastOrderDate: '2026-09-11',
    status: 'vip'
  },
  {
    id: 'cust-2',
    name: 'Marc Lefebvre',
    email: 'm.lefebvre@outlook.fr',
    phone: '06 87 65 43 21',
    city: 'Lille',
    ordersCount: 2,
    totalSpent: 398.00,
    lastOrderDate: '2026-09-10',
    status: 'regular'
  },
  {
    id: 'cust-3',
    name: 'Sophie Bertrand',
    email: 'sophie.b@gmail.com',
    phone: '07 12 34 56 78',
    city: 'Lyon',
    ordersCount: 1,
    totalSpent: 92.00,
    lastOrderDate: '2026-09-09',
    status: 'regular'
  },
  {
    id: 'cust-4',
    name: 'Guillaume Vasseur',
    email: 'guillaume.v@protonmail.com',
    phone: '06 44 55 66 77',
    city: 'Bordeaux',
    ordersCount: 4,
    totalSpent: 870.00,
    lastOrderDate: '2026-09-08',
    status: 'vip'
  },
  {
    id: 'cust-5',
    name: 'Émilie Roux',
    email: 'emilie.roux@yahoo.fr',
    phone: '06 33 22 11 00',
    city: 'Nantes',
    ordersCount: 0,
    totalSpent: 0,
    lastOrderDate: 'Inscrite',
    status: 'lead'
  }
];

export const INITIAL_COUPONS: Coupon[] = [
  {
    id: 'coup-1',
    code: 'BIENVENUE10',
    discountType: 'percent',
    value: 10,
    minOrderAmount: 50,
    usageLimit: 100,
    usedCount: 24,
    isActive: true,
    expiresAt: '2026-12-31'
  },
  {
    id: 'coup-2',
    code: 'ETE20',
    discountType: 'percent',
    value: 20,
    minOrderAmount: 100,
    usageLimit: 50,
    usedCount: 18,
    isActive: true,
    expiresAt: '2026-10-31'
  },
  {
    id: 'coup-3',
    code: 'PRIVILEGE15',
    discountType: 'fixed',
    value: 15,
    minOrderAmount: 80,
    usageLimit: 30,
    usedCount: 7,
    isActive: true,
    expiresAt: '2026-11-15'
  }
];
