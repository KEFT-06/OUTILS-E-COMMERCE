import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { PlanId, UserProfile } from '@/shared/types/auth';
import { planOf } from '@/shared/lib/plans';

/**
 * Session locale.
 *
 * Il n'existe pas encore d'authentification serveur : le profil vit dans ce
 * navigateur et aucun mot de passe n'est vérifié. L'écran de connexion le dit.
 *
 * Plus aucun profil n'est ouvert par défaut. L'ancienne version connectait tout
 * visiteur au nom et à l'adresse e-mail du fondateur, avec la photo d'une autre
 * personne. La démonstration utilise désormais un compte fictif, nommé comme tel.
 */

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  login: (email: string) => void;
  signup: (name: string, email: string) => void;
  loginDemo: () => void;
  logout: () => void;
  updateProfile: (updates: Partial<Pick<UserProfile, 'name' | 'savedNiches'>>) => void;
  /**
   * Débite des points de recherche. Passe par une mise à jour fonctionnelle :
   * deux débits rapprochés calculés depuis une même lecture du solde en
   * perdraient un.
   */
  consumeCredits: (points: number) => void;
}

const STORAGE_KEY = 'smartcreator_user';

const PLAN_IDS: readonly PlanId[] = ['Gratuit', 'Plus', 'Pro', 'Max', 'Elite Enterprise'];

function isUserProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.email === 'string' &&
    typeof v.role === 'string' &&
    typeof v.plan === 'string' &&
    PLAN_IDS.includes(v.plan as PlanId) &&
    typeof v.isDemo === 'boolean' &&
    typeof v.joinedAt === 'string' &&
    typeof v.apiSearchesUsed === 'number' &&
    typeof v.apiSearchesLimit === 'number' &&
    Array.isArray(v.savedNiches) &&
    v.savedNiches.every((niche) => typeof niche === 'string')
  );
}

function readStoredUser(): UserProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isUserProfile(parsed)) return parsed;
    // Profil d'une ancienne version ou corrompu : on repart d'une session vide.
    localStorage.removeItem(STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `usr_${Date.now().toString(36)}`;
}

function createProfile(name: string, email: string, plan: PlanId, isDemo: boolean): UserProfile {
  return {
    id: newId(),
    name,
    email,
    role: 'Créateur digital',
    plan,
    isDemo,
    joinedAt: new Date().toISOString(),
    apiSearchesUsed: 0,
    apiSearchesLimit: planOf(plan).monthlyPoints ?? 0,
    savedNiches: [],
  };
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(readStoredUser);

  useEffect(() => {
    try {
      if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Stockage indisponible (navigation privée) : la session reste en mémoire.
    }
  }, [user]);

  const login = useCallback((email: string) => {
    const clean = email.trim().toLowerCase();
    setUser(createProfile(clean.split('@')[0] || 'Créateur', clean, 'Gratuit', false));
  }, []);

  const signup = useCallback((name: string, email: string) => {
    setUser(createProfile(name.trim() || 'Créateur', email.trim().toLowerCase(), 'Gratuit', false));
  }, []);

  const loginDemo = useCallback(() => {
    setUser({
      ...createProfile('Compte démo', '', 'Pro', true),
      apiSearchesUsed: 22,
      savedNiches: [
        'Templates Notion productivité pour solopreneurs',
        'Packs de prompts IA pour designers',
        'Automatisation no-code pour agences',
      ],
    });
  }, []);

  const logout = useCallback(() => setUser(null), []);

  const updateProfile = useCallback((updates: Partial<Pick<UserProfile, 'name' | 'savedNiches'>>) => {
    setUser((current) => (current ? { ...current, ...updates } : current));
  }, []);

  const consumeCredits = useCallback((points: number) => {
    if (points <= 0) return;
    setUser((current) =>
      current
        ? { ...current, apiSearchesUsed: Math.min(current.apiSearchesLimit, current.apiSearchesUsed + points) }
        : current,
    );
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: user !== null,
        login,
        signup,
        loginDemo,
        logout,
        updateProfile,
        consumeCredits,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth doit être utilisé dans un AuthProvider');
  }
  return context;
};

/** Initiales affichées à la place d'une photo de profil. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'SC';
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}
