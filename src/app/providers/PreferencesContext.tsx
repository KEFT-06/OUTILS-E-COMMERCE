import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark';
type Language = 'FR' | 'EN';

interface PreferencesContextType {
  theme: Theme;
  toggleTheme: () => void;
  language: Language;
  toggleLanguage: () => void;
  t: (frStr: string, enStr: string) => string;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('smartcreator_theme') as Theme) || 'light';
  });
  
  const [language, setLanguage] = useState<Language>(() => {
    return (localStorage.getItem('smartcreator_lang') as Language) || 'FR';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('smartcreator_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('smartcreator_lang', language);
  }, [language]);

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');
  const toggleLanguage = () => setLanguage(l => l === 'FR' ? 'EN' : 'FR');

  const t = (frStr: string, enStr: string) => {
    return language === 'EN' ? enStr : frStr;
  };

  return (
    <PreferencesContext.Provider value={{ theme, toggleTheme, language, toggleLanguage, t }}>
      {children}
    </PreferencesContext.Provider>
  );
};

export const usePreferences = () => {
  const context = useContext(PreferencesContext);
  if (context === undefined) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
};
