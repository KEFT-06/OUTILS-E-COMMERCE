import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile, AppViewMode } from '@/shared/types/auth';

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  viewMode: AppViewMode;
  setViewMode: (mode: AppViewMode) => void;
  login: (email: string, password?: string) => Promise<boolean>;
  signup: (name: string, email: string, password?: string) => Promise<boolean>;
  logout: () => void;
  updateProfile: (updates: Partial<UserProfile>) => void;
}

const DEFAULT_USER: UserProfile = {
  id: 'usr_smartcreator_8892',
  name: 'Karl Foko',
  email: 'karlfoko01@gmail.com',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
  role: 'Stratège E-Commerce & Créateur',
  plan: 'Pro',
  joinedDate: 'Février 2025',
  apiSearchesUsed: 38,
  apiSearchesLimit: 100,
  savedNiches: [
    'Templates Notion Productivité pour Solopreneurs',
    'Packs de Prompts IA & Midjourney pour Designers',
    'Automatisation No-Code & N8N pour Agences',
  ],
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem('smartcreator_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return DEFAULT_USER;
      }
    }
    return DEFAULT_USER; // Logged in by default with Karl's profile for instant utility
  });

  const [viewMode, setViewMode] = useState<AppViewMode>(() => {
    const savedView = localStorage.getItem('smartcreator_viewmode') as AppViewMode;
    return savedView || 'app';
  });

  useEffect(() => {
    if (user) {
      localStorage.setItem('smartcreator_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('smartcreator_user');
    }
  }, [user]);

  useEffect(() => {
    localStorage.setItem('smartcreator_viewmode', viewMode);
  }, [viewMode]);

  const login = async (email: string, _password?: string): Promise<boolean> => {
    // Simulate authentication
    const loggedUser: UserProfile = {
      ...DEFAULT_USER,
      email: email || DEFAULT_USER.email,
      name: email ? email.split('@')[0] : DEFAULT_USER.name,
    };
    setUser(loggedUser);
    setViewMode('app');
    return true;
  };

  const signup = async (name: string, email: string, _password?: string): Promise<boolean> => {
    const newUser: UserProfile = {
      id: `usr_${Date.now()}`,
      name: name || 'Nouveau Membre',
      email: email || 'user@smartcreator.io',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=256&q=80',
      role: 'Créateur Digital',
      plan: 'Pro',
      joinedDate: new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
      apiSearchesUsed: 1,
      apiSearchesLimit: 100,
      savedNiches: ['Templates Notion Productivité'],
    };
    setUser(newUser);
    setViewMode('app');
    return true;
  };

  const logout = () => {
    setUser(null);
    setViewMode('landing');
  };

  const updateProfile = (updates: Partial<UserProfile>) => {
    if (!user) return;
    setUser((prev) => (prev ? { ...prev, ...updates } : null));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        viewMode,
        setViewMode,
        login,
        signup,
        logout,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
