import React, { useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import {
  Lock,
  Mail,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Zap,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login, signup, setViewMode } = useAuth();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState('karlfoko01@gmail.com');
  const [password, setPassword] = useState('••••••••••••');
  const [name, setName] = useState('Karl Foko');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!email.trim()) {
      setErrorMsg('Veuillez renseigner votre adresse email.');
      return;
    }
    setIsLoading(true);
    try {
      if (isRegisterMode) {
        await signup(name, email, password);
      } else {
        await login(email, password);
      }
    } catch {
      setErrorMsg('Une erreur est survenue lors de l\'authentification.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDemoLogin = async () => {
    setIsLoading(true);
    await login('karlfoko01@gmail.com', 'demo123456');
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-between relative overflow-hidden font-sans selection:bg-indigo-500 selection:text-white">
      {/* Background Decorative Glows */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 -right-40 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 left-1/2 -translate-x-1/2 w-full max-w-4xl h-80 bg-slate-800/40 rounded-full blur-3xl pointer-events-none" />

      {/* Top Bar: Return to Landing */}
      <header className="relative z-10 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 flex items-center justify-between">
        <button
          onClick={() => setViewMode('landing')}
          className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors bg-slate-800/60 hover:bg-slate-800 px-3.5 py-2 rounded-xl border border-slate-700/60 backdrop-blur-xs"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Retour à l'accueil</span>
        </button>

        <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="hidden sm:inline">Espace sécurisé & chiffré SSL 256-bit</span>
        </div>
      </header>

      {/* Main Authentication Card */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-slate-850/95 border border-slate-750/80 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          
          {/* Logo & Headline */}
          <div className="text-center space-y-3 mb-8">
            <div className="flex justify-center">
              <BrandLogo size="lg" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black font-display text-white tracking-tight">
                {isRegisterMode ? 'Créer un compte Smart Creator' : 'Connexion à votre espace'}
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                {isRegisterMode
                  ? 'Rejoignez les créateurs qui détectent les niches à 95% de marge'
                  : 'Accédez à votre radar web, vos veilles stratégiques et vos scripts'}
              </p>
            </div>
          </div>

          {/* Tab Switcher (Connexion / Inscription) */}
          <div className="grid grid-cols-2 p-1 bg-slate-900/80 rounded-xl border border-slate-750 mb-6">
            <button
              type="button"
              onClick={() => {
                setIsRegisterMode(false);
                setErrorMsg('');
              }}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                !isRegisterMode
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Se connecter
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRegisterMode(true);
                setErrorMsg('');
              }}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                isRegisterMode
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Créer un compte
            </button>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 font-medium">
              {errorMsg}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegisterMode && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 block">Nom complet</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Karl Foko"
                    required
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 block">Adresse email professionnelle</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="votre.email@exemple.com"
                  required
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300 block">Mot de passe</label>
                {!isRegisterMode && (
                  <button
                    type="button"
                    onClick={() => alert('Lien de réinitialisation envoyé à votre adresse.')}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                  >
                    Mot de passe oublié ?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl pl-10 pr-10 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl text-xs sm:text-sm transition-all shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 mt-2"
            >
              <span>{isRegisterMode ? 'Finaliser l\'inscription' : 'Ouvrir mon espace de travail'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-750" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-wider">
              <span className="bg-slate-850 px-3 text-slate-400">Ou accès immédiat</span>
            </div>
          </div>

          {/* Quick Demo Access Button */}
          <button
            type="button"
            onClick={handleQuickDemoLogin}
            disabled={isLoading}
            className="w-full bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all border border-slate-700/80 flex items-center justify-center gap-2"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Connexion instantanée (Session Démo)</span>
          </button>

          {/* Features Highlights underneath */}
          <div className="mt-6 pt-5 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Radar Web en direct</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>5 Taux prédictifs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Scripts Meta Ads AIDA</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Export PDF HD</span>
            </div>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 max-w-6xl w-full mx-auto px-4 py-4 text-center text-xs text-slate-500">
        Smart Creator © 2025 · Plateforme Stratégique de Veille & Produits Digitaux · Tous droits réservés
      </footer>
    </div>
  );
};
