import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SESSION_EXPIRED_EVENT, apiRequest } from '@/shared/lib/api';
import { bindAccountStores, flushAccountStores } from '@/shared/lib/persistentStore';
import type { Account, SecondFactorMethods } from '@/shared/types/auth';

/**
 * Compte connecté.
 *
 * Tout est vérifié par le serveur : mot de passe, double authentification,
 * solde, palier et privilèges. Le navigateur ne garde aucune copie du compte
 * entre deux visites et ne voit jamais la session, qui vit dans un cookie
 * httpOnly. Le contexte relit le compte toutes les deux minutes quand l'onglet
 * est visible : le solde reste à jour et l'administration sait qui est en ligne.
 */

type AuthStatus = 'loading' | 'ready';

interface AuthContextType {
  account: Account | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  signup: (input: { name: string; email: string; password: string; country: string }) => Promise<void>;
  /** `mfaRequired` : le mot de passe est bon, le second facteur est attendu (`methods` dit lequel). */
  login: (input: { email: string; password: string }) => Promise<{ mfaRequired: boolean; methods: SecondFactorMethods | null }>;
  verifyMfa: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutEverywhere: () => Promise<void>;
  /** Relit le compte (solde, palier, privilèges) depuis le serveur. */
  refresh: () => Promise<Account | null>;
  setAccount: (account: Account | null) => void;
  updateProfile: (updates: { name?: string; country?: string }) => Promise<void>;
  /** Enregistre une niche, dans la limite du palier (le serveur refuse au-delà). */
  saveNiche: (name: string) => Promise<void>;
  removeNiche: (name: string) => Promise<void>;
}

const HEARTBEAT_MS = 2 * 60_000;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [account, setAccount] = useState<Account | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const refresh = useCallback(async () => {
    try {
      const { account: current } = await apiRequest<{ account: Account | null }>('/api/auth/me');
      setAccount(current);
      return current;
    } catch {
      // Serveur momentanément injoignable : on garde l'état connu plutôt que de déconnecter.
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setStatus('ready'));
  }, [refresh]);

  const accountId = account?.id;

  // Brouillons de l'espace de travail : ceux du compte connecté, et de lui seul.
  useEffect(() => {
    bindAccountStores(accountId ?? null);
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(refreshIfVisible, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [accountId, refresh]);

  useEffect(() => {
    const onExpired = () => setAccount(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const signup = useCallback(async (input: { name: string; email: string; password: string; country: string }) => {
    const { account: created } = await apiRequest<{ account: Account }>('/api/auth/signup', { method: 'POST', body: input });
    setAccount(created);
  }, []);

  const login = useCallback(async (input: { email: string; password: string }) => {
    const result = await apiRequest<{ account?: Account; mfaRequired?: boolean; methods?: SecondFactorMethods }>('/api/auth/login', {
      method: 'POST',
      body: input,
    });
    if (result.mfaRequired) return { mfaRequired: true, methods: result.methods ?? null };
    setAccount(result.account ?? null);
    return { mfaRequired: false, methods: null };
  }, []);

  const verifyMfa = useCallback(async (code: string) => {
    const { account: verified } = await apiRequest<{ account: Account }>('/api/auth/login/mfa', {
      method: 'POST',
      body: { code },
    });
    setAccount(verified);
  }, []);

  const logout = useCallback(async () => {
    try {
      await flushAccountStores().catch(() => undefined);
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      setAccount(null);
    }
  }, []);

  const logoutEverywhere = useCallback(async () => {
    try {
      await flushAccountStores().catch(() => undefined);
      await apiRequest('/api/auth/logout-all', { method: 'POST' });
    } finally {
      setAccount(null);
    }
  }, []);

  const updateProfile = useCallback(async (updates: { name?: string; country?: string }) => {
    const { account: updated } = await apiRequest<{ account: Account }>('/api/account/profile', {
      method: 'PATCH',
      body: updates,
    });
    setAccount(updated);
  }, []);

  const saveNiche = useCallback(async (name: string) => {
    const { account: updated } = await apiRequest<{ account: Account }>('/api/account/niches', { method: 'POST', body: { name } });
    setAccount(updated);
  }, []);

  const removeNiche = useCallback(async (name: string) => {
    const { account: updated } = await apiRequest<{ account: Account }>('/api/account/niches/remove', {
      method: 'POST',
      body: { name },
    });
    setAccount(updated);
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      account,
      status,
      isAuthenticated: account !== null,
      signup,
      login,
      verifyMfa,
      logout,
      logoutEverywhere,
      refresh,
      setAccount,
      updateProfile,
      saveNiche,
      removeNiche,
    }),
    [account, status, signup, login, verifyMfa, logout, logoutEverywhere, refresh, updateProfile, saveNiche, removeNiche],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
