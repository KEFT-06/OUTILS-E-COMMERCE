export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: string;
  plan: 'Starter' | 'Pro' | 'Elite Enterprise';
  joinedDate: string;
  apiSearchesUsed: number;
  apiSearchesLimit: number;
  savedNiches: string[];
}

export type AppViewMode = 'landing' | 'app' | 'login' | 'account';
