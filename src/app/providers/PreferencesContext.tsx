import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/**
 * Préférences d'affichage.
 *
 * L'interface est en français. Le bouton FR/EN a été retiré : il ne traduisait
 * qu'une partie des écrans et laissait l'essentiel des modules en français.
 * `t()` reste en place pour la traduction complète à venir.
 */
interface PreferencesContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  language: 'FR';
  t: (frStr: string, enStr: string) => string;
}

const THEME_KEY = 'smartcreator_theme';

function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Stockage indisponible : le choix vaut pour la session.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((current) => (current === 'light' ? 'dark' : 'light')), []);
  const t = useCallback((frStr: string, _enStr: string) => frStr, []);

  return (
    <PreferencesContext.Provider value={{ theme, setTheme, toggleTheme, language: 'FR', t }}>
      {children}
    </PreferencesContext.Provider>
  );
};

export const usePreferences = () => {
  const context = useContext(PreferencesContext);
  if (context === undefined) {
    throw new Error('usePreferences doit être utilisé dans un PreferencesProvider');
  }
  return context;
};
