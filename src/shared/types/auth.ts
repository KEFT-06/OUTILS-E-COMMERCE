/** Miroir client des comptes servis par `server/services/accounts/view.ts`. */

export type PlanId = 'free' | 'plus' | 'pro' | 'max' | 'elite';

export type FeatureId =
  | 'niche_analysis'
  | 'radar_scan'
  | 'ad_gallery_scan'
  | 'image_generation'
  | 'video_generation'
  | 'storybook_generation'
  | 'affiliate_invitations'
  | 'guide_translation'
  | 'native_review';

export type Permission =
  | 'admin.dashboard.read'
  | 'admin.users.read'
  | 'admin.users.manage'
  | 'admin.credits.grant'
  | 'admin.revenue.read'
  | 'admin.payments.record'
  | 'admin.security.read'
  | 'guides.review';

export interface CreditBalance {
  /** Points du quota mensuel du palier. */
  plan: number;
  /** Points ajoutés par un administrateur ou rendus : ils n'expirent pas. */
  bonus: number;
  total: number;
  /** Quota mensuel ; null pour un palier illimité. */
  allowance: number | null;
  unlimited: boolean;
  cycleEndsAt: string;
}

export interface PlanLimits {
  /** Niches qu'un compte peut enregistrer ; null : illimité. */
  savedNiches: number | null;
  /** Méthodes publicitaires ouvertes ; null : toutes. */
  adFrameworks: number | null;
  /** Langues de traduction par guide ; null : illimité. */
  guideLanguages: number | null;
}

export interface SecondFactorMethods {
  /** Application d'authentification (code à 6 chiffres). */
  app: boolean;
  /** Code de sécurité personnel. */
  code: boolean;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  /** Code ISO du pays ; null tant qu'il n'est pas choisi. */
  country: string | null;
  /** Devise d'affichage des prix (ISO 4217). */
  currency: string;
  plan: { id: PlanId; label: string };
  planExpiresAt: string | null;
  createdAt: string;
  credits: CreditBalance;
  features: Record<FeatureId, boolean>;
  limits: PlanLimits;
  permissions: Permission[];
  /** Détient au moins un privilège d'administration. */
  isStaff: boolean;
  twoFactor: {
    enabled: boolean;
    methods: SecondFactorMethods;
    /** Obligatoire pour les comptes qui détiennent des privilèges. */
    required: boolean;
    /** La session courante a été ouverte avec le second facteur. */
    sessionVerified: boolean;
  };
  integrations: {
    chariow: {
      connected: boolean;
      /** « own » : clé de l'utilisateur ; « admin » : clé du serveur, réservée aux administrateurs. */
      source: 'own' | 'admin' | null;
      hint: string | null;
      verifiedAt: string | null;
    };
  };
  savedNiches: string[];
}

export interface PlanPrice {
  currency: string;
  monthly: number;
  /** Un an payé d'avance. */
  yearly: number;
  /** Converti depuis la devise de base au taux du jour. */
  converted: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  label: string;
  tagline: string | null;
  monthlyCredits: number | null;
  highlight: boolean;
  limits: PlanLimits;
  features: Partial<Record<FeatureId, boolean>>;
  /** null : prix pas encore fixé. */
  price: PlanPrice | null;
}

export interface PlanCatalog {
  version: string;
  updatedAt: string;
  currency: string;
  pricing: {
    status: string | null;
    yearlyMonthsCharged: number;
    ratesUpdatedAt: string;
    ratesSource: 'live' | 'fallback';
  };
  features: Record<FeatureId, string>;
  adFrameworksTotal: number;
  plans: PlanDefinition[];
}
