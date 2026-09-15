/** Miroir client des comptes servis par `server/services/accounts/view.ts`. */

export type PlanId = 'free' | 'plus' | 'pro' | 'max' | 'elite';

export type FeatureId =
  | 'niche_analysis'
  | 'radar_scan'
  | 'ad_gallery_scan'
  | 'image_generation'
  | 'video_generation'
  | 'storybook_generation'
  | 'affiliate_invitations';

export type Permission =
  | 'admin.dashboard.read'
  | 'admin.users.read'
  | 'admin.users.manage'
  | 'admin.credits.grant'
  | 'admin.revenue.read'
  | 'admin.payments.record'
  | 'admin.security.read';

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

export interface Account {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  plan: { id: PlanId; label: string };
  planExpiresAt: string | null;
  createdAt: string;
  credits: CreditBalance;
  features: Record<FeatureId, boolean>;
  permissions: Permission[];
  /** Détient au moins un privilège d'administration. */
  isStaff: boolean;
  twoFactor: {
    enabled: boolean;
    /** Obligatoire pour les comptes qui détiennent des privilèges. */
    required: boolean;
    /** La session courante a été ouverte avec le code. */
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

export interface PlanDefinition {
  id: PlanId;
  label: string;
  monthlyCredits: number | null;
  /** null : prix pas encore fixé. */
  priceMonthlyFcfa: number | null;
  highlight?: boolean;
  features: Partial<Record<FeatureId, boolean>>;
}

export interface PlanCatalog {
  version: string;
  updatedAt: string;
  currency: string;
  features: Record<FeatureId, string>;
  plans: PlanDefinition[];
}
