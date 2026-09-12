export type TemplateId = 'restaurant' | 'portfolio' | 'saas' | 'boutique';

export type ViewportMode = 'desktop' | 'tablet' | 'mobile';

export type ActiveTab = 'showcase' | 'builder' | 'features';

export interface WebsiteTemplate {
  id: TemplateId;
  name: string;
  category: string;
  subtitle: string;
  badge: string;
  description: string;
  features: string[];
  themeColor: string;
}

export type PresetKey = 'artisan' | 'restaurant' | 'conseil' | 'coach' | 'agence' | 'boutique' | 'immo' | 'tech';

export interface ServiceItem {
  title: string;
  description: string;
  price?: string;
  duration?: string;
}

export interface TestimonialItem {
  author: string;
  role: string;
  comment: string;
  rating: number;
}

export interface GalleryItem {
  title: string;
  category: string;
  imageUrl: string;
}

export interface PricingPlan {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  highlight?: boolean;
}

export interface CustomSiteConfig {
  siteName: string;
  category: string;
  tagline: string;
  description: string;
  colorScheme: 'indigo' | 'emerald' | 'amber' | 'rose' | 'slate' | 'violet';
  styleMood: 'moderne' | 'minimaliste' | 'chaleureux' | 'prestige';
  sections: {
    hero: boolean;
    services: boolean;
    gallery: boolean;
    pricing: boolean;
    testimonials: boolean;
    contact: boolean;
  };
  phone?: string;
  email?: string;
  address?: string;
  ctaText: string;
  servicesList: ServiceItem[];
  testimonialsList: TestimonialItem[];
  galleryList: GalleryItem[];
  pricingList: PricingPlan[];
}

