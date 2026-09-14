export type PlanId = 'Gratuit' | 'Plus' | 'Pro' | 'Max' | 'Elite Enterprise';

export interface UserProfile {
  id: string;
  name: string;
  /** Vide pour le compte de démonstration. */
  email: string;
  role: string;
  plan: PlanId;
  /** Compte fictif, présenté comme tel à l'écran. */
  isDemo: boolean;
  /** Date ISO de création du profil. */
  joinedAt: string;
  apiSearchesUsed: number;
  apiSearchesLimit: number;
  savedNiches: string[];
}
